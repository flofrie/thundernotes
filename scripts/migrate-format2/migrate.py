# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Rewrites an account's ThunderNotes carriers from file format 1 to format 2 (D25).

Dry run by default: the folder is opened read-only (EXAMINE), every carrier is converted in
memory and checked, and nothing is written. With --apply, each original is first saved to
--backup-dir, then the converted carrier is uploaded (same revision, fresh Message-ID, \\Seen)
and only after that the original is deleted and expunged. Interrupted half-way, the folder holds
both versions of some emails; the add-on (format 2) reads the new ones and removes the old.

    python3 -I migrate.py --host mail.example.com --user me@example.com            # dry run
    python3 -I migrate.py --host mail.example.com --user me@example.com --apply

The password comes from THUNDERNOTES_IMAP_PASSWORD, else it is asked for. Needs Node and
packages/core built (npm run build -w @thundernotes/core). Settings carriers (JSON) and other
messages are left alone. Update the add-on on every device right after: an older one can't
read format 2 and lists those carriers as unreadable until it is updated (D35).
"""

import argparse
import email
import email.policy
import getpass
import imaplib
import json
import os
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent


def parse_args():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--host", required=True)
    p.add_argument("--port", type=int, default=993)
    p.add_argument("--user", required=True)
    p.add_argument("--folder", default="ThunderNotes")
    p.add_argument("--apply", action="store_true", help="write: back up, upload converted carriers, delete the originals")
    p.add_argument("--backup-dir", default=f"thundernotes-backup-{time.strftime('%Y%m%d-%H%M%S')}")
    return p.parse_args()


def carriers(conn):
    """(uid, raw message, markdown text, client) of every format-carrying message in the folder."""
    typ, data = conn.uid("SEARCH", None, "ALL")
    assert typ == "OK", data
    uids = data[0].split()
    found, skipped = [], 0
    for uid in uids:
        typ, data = conn.uid("FETCH", uid, "(BODY.PEEK[])")  # PEEK: flags untouched
        assert typ == "OK", data
        raw = next(part[1] for part in data if isinstance(part, tuple))
        msg = email.message_from_bytes(raw, policy=email.policy.default)
        if not msg["X-Annot-Ref"]:
            skipped += 1
            continue
        md_part = next((p for p in msg.walk() if p.get_content_type() == "text/markdown"), None)
        if md_part is None:  # the settings carrier (JSON), or something else
            skipped += 1
            continue
        found.append({
            "uid": uid.decode(),
            "raw": raw,
            "subject": str(msg["Subject"] or ""),
            "markdown": md_part.get_payload(decode=True).decode("utf-8"),
            "client": str(msg["X-Annot-Client"] or "migration"),
        })
    return found, skipped


def convert(found):
    request = [{"id": c["uid"], "markdown": c["markdown"], "client": c["client"]} for c in found]
    run = subprocess.run(["node", str(HERE / "convert.ts"), "carriers"], input=json.dumps(request), capture_output=True, text=True, cwd=HERE)
    if run.returncode != 0:
        sys.exit(f"convert.ts failed:\n{run.stderr}")
    return {r["id"]: r for r in json.loads(run.stdout)}


def main():
    args = parse_args()
    password = os.environ.get("THUNDERNOTES_IMAP_PASSWORD") or getpass.getpass(f"IMAP password for {args.user}: ")
    conn = imaplib.IMAP4_SSL(args.host, args.port)
    conn.login(args.user, password)
    try:
        # Read-only unless writing was asked for.
        typ, data = conn.select(f'"{args.folder}"', readonly=not args.apply)
        if typ != "OK":
            sys.exit(f"can't open {args.folder}: {data}")
        found, skipped = carriers(conn)
        results = convert(found) if found else {}
        todo = []
        for c in found:
            r = results[c["uid"]]
            note = r.get("error", "") if r["status"] == "failed" else ""
            print(f"{r['status']:9} uid {c['uid']:>6}  {c['subject'][:60]}{'  — ' + note if note else ''}")
            if r["status"] == "converted":
                todo.append((c, r))
        failed = sum(1 for r in results.values() if r["status"] == "failed")
        print(f"\n{len(found)} carriers: {len(todo)} to convert, {len(found) - len(todo) - failed} already current, {failed} failed; {skipped} other messages left alone.")
        if failed:
            print("Failed carriers are left as they are (the add-on lists them as unreadable; delete them there if they don't matter).")
        if not args.apply:
            print("Dry run: nothing written. Run again with --apply to convert.")
            return
        if not todo:
            return

        backup = pathlib.Path(args.backup_dir)
        backup.mkdir(parents=True, exist_ok=False)
        for c, _ in todo:
            (backup / f"{c['uid']}.eml").write_bytes(c["raw"])
        print(f"Originals saved in {backup}/")

        for c, r in todo:
            eml = r["eml"].encode("utf-8")
            typ, data = conn.append(f'"{args.folder}"', r"(\Seen)", imaplib.Time2Internaldate(time.time()), eml)
            if typ != "OK":
                sys.exit(f"upload of uid {c['uid']} failed ({data}); stopped. Nothing of it was deleted.")
            typ, data = conn.uid("STORE", c["uid"], "+FLAGS.SILENT", r"(\Deleted)")
            if typ != "OK":
                sys.exit(f"marking uid {c['uid']} deleted failed ({data}); stopped. Its new version is uploaded.")
            print(f"converted uid {c['uid']} -> <{r['messageId']}>")

        # Only what was marked here: UID EXPUNGE where the server has UIDPLUS.
        if "UIDPLUS" in conn.capabilities:
            conn.uid("EXPUNGE", ",".join(c["uid"] for c, _ in todo))
        else:
            conn.expunge()
        print(f"Done: {len(todo)} carriers in format 2. Update the add-on on every device now.")
    finally:
        try:
            conn.close()
        except imaplib.IMAP4.error:
            pass
        conn.logout()


if __name__ == "__main__":
    main()
