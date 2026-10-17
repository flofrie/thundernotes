/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Popup of the message header button: the email's notes in reading order, including
// those not found in the current view. Clicking an entry jumps to it in the margin;
// editing always happens there.

import { colourOf, darker, effective, hasConflict, renderMarkdown, senderName } from "@thundernotes/core";
import { exportDue, formatDate } from "./backup.js";
import type { ListItem, ListState, ToContent } from "./protocol.js";

const $ = (id: string) => document.getElementById(id)!;

/** Plain-text start of a note, for the list. */
function excerpt(md: string): string {
  const html = renderMarkdown(md);
  return (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The last entry's note was changed on two devices and still holds a conflict box (D32). */
function markConflict(list: HTMLElement, md: string): void {
  if (!hasConflict(md)) return;
  const s = document.createElement("div");
  s.className = "status";
  s.textContent = "Changed on two devices: open it to keep one version";
  list.lastElementChild!.append(s);
}

function entry(
  className: string,
  quote: string,
  text: string,
  status: ListItem["status"] | null,
  onClick: () => void,
  colour?: string
): HTMLElement {
  const li = document.createElement("li");
  li.className = className;
  const q = document.createElement("div");
  q.className = "quote";
  q.textContent = quote;
  const t = document.createElement("div");
  t.className = text ? "text" : "text none";
  t.textContent = text || "Highlight, no note";
  li.append(q, t);
  if (colour) {
    const c = colourOf(colour);
    li.style.borderLeft = `4px solid ${effective(c)}`;
    li.style.boxShadow = `inset 1px 0 0 ${darker(c)}`;
  }
  if (status === "orphan" || status === "partial") {
    const s = document.createElement("div");
    s.className = "status";
    s.textContent = status === "orphan" ? "Not found in this view" : "Partly shown in this view";
    li.append(s);
  }
  li.addEventListener("click", onClick);
  return li;
}

async function main(): Promise<void> {
  const [tab] = await messenger.tabs.query({ active: true, currentWindow: true });
  const send = (message: ToContent) => messenger.tabs.sendMessage(tab!.id!, message);
  const state = tab?.id !== undefined ? await send({ type: "listState" }).catch(() => null) as ListState | null : null;
  const list = $("list");
  if (!state) {
    list.innerHTML = `<div class="empty">Open an email to see its notes.</div>`;
    return;
  }
  const go = (message: ToContent) => () => {
    send(message).finally(() => window.close());
  };
  // All notes of this email as Markdown (D38's conventions), when it has any.
  const copyAll = $("copyAll");
  copyAll.hidden = !state.emailNoteMd && !state.items.some((i) => i.bodyMd);
  copyAll.addEventListener("click", go({ type: "copyAllNotes" }));

  // Notes = highlights with text, plus the whole-email note; highlights = those without text.
  const notes = state.items.filter((i) => i.bodyMd).length + (state.emailNoteMd ? 1 : 0);
  const highlights = state.items.filter((i) => !i.bodyMd).length;
  $("count").textContent = notes || highlights ? `notes / highlights  ${notes} / ${highlights}` : "";
  $("count").title = `${notes} note${notes === 1 ? "" : "s"}, ${highlights} plain highlight${highlights === 1 ? "" : "s"}`;
  list.append(
    entry("email", "Note on this email", state.emailNoteMd ? excerpt(state.emailNoteMd) : "", null, go({ type: "editEmailNote" }), state.emailNoteColour)
  );
  if (!state.emailNoteMd) list.lastElementChild!.querySelector(".text")!.textContent = "Add a note on the whole email…";
  markConflict(list, state.emailNoteMd);
  for (const item of state.items) {
    list.append(
      entry("", `“${item.quote}”`, item.bodyMd ? excerpt(item.bodyMd) : "", item.status, go({ type: "focus", id: item.id }), item.colour)
    );
    markConflict(list, item.bodyMd);
  }
  // Emails whose notes link here (D37): "Linked from", each opens that email.
  let last: Element = list;
  if (state.backlinks?.length) {
    const head = document.createElement("div");
    head.className = "linked-head";
    head.textContent = "Linked from";
    list.after(head);
    const links = document.createElement("ul");
    links.className = "linked";
    for (const b of state.backlinks) {
      const li = document.createElement("li");
      const subject = document.createElement("div");
      subject.className = "linked-subject";
      subject.textContent = b.subject || "(no subject)";
      const meta = document.createElement("div");
      meta.className = "text none";
      const date = b.date ? new Date(b.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
      const where = b.quotes.map((q) => (q ? `“${q.length > 40 ? `${q.slice(0, 39)}…` : q}”` : "note on the whole email")).join(", ");
      meta.textContent = [senderName(b.from), date, where && `in ${where}`].filter(Boolean).join(" · ");
      li.append(subject, meta);
      li.title = "Open this email";
      li.addEventListener("click", () => {
        messenger.runtime.sendMessage({ type: "openEmail", messageId: b.messageId }).finally(() => window.close());
      });
      links.append(li);
    }
    head.after(links);
    last = links;
  }
  // Deleted in the last 30 days (D33): one line to bring it all back.
  if (state.restorable) {
    const restore = document.createElement("button");
    restore.className = "restore";
    restore.textContent = `↺ Restore ${state.restorable} deleted in the last 30 days`;
    restore.title = "Brings back the notes and highlights deleted on this email (not older versions of notes)";
    restore.addEventListener("click", go({ type: "restoreDeleted" }));
    // Or gone for good (on all devices): a second click confirms, it can't be undone.
    const purge = document.createElement("a");
    purge.className = "purge";
    purge.textContent = "Delete for good";
    purge.title = "Deletes these copies for good, on all your devices; they can't be restored afterwards";
    let armed = false;
    purge.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        purge.textContent = `Click again to delete ${state.restorable} for good`;
        purge.classList.add("armed");
        return;
      }
      go({ type: "purgeDeleted" })();
    });
    const bar = document.createElement("div");
    bar.className = "restore-bar";
    bar.append(restore, purge);
    last.after(bar);
  }
  if (!state.items.length) {
    const hint = document.createElement("div");
    hint.className = "empty";
    hint.textContent = "Select text in the email to highlight it.";
    list.append(hint);
  }
}

// The task view (D38): all checklist items in all notes, in their own tab.
$("tasks").addEventListener("click", () => {
  void messenger.runtime.sendMessage({ type: "openTasks" }).finally(() => window.close());
});

for (const id of ["options", "exportNow"]) {
  $(id).addEventListener("click", () => {
    messenger.runtime.openOptionsPage();
    window.close();
  });
}

exportDue()
  .then(({ due, lastExport }) => {
    $("lastExport").textContent = formatDate(lastExport);
    $("backup").hidden = !due;
  })
  .catch(() => {});
main().catch((e) => {
  $("list").textContent = `Could not load notes: ${e.message}`;
});

// Sync isn't working (D35): at the top, since when; a click shows what is wrong and what helps.
// Connection problems never get here (Thunderbird reports those itself).
const EXPLAIN: Record<string, string> = {
  folder:
    "ThunderNotes can't find its folder \"ThunderNotes\" in this account and can't create it again. " +
    "Check the account's folders (right-click the account → Subscribe…): the folder may be unsubscribed or renamed, " +
    "or the server may not allow creating folders.",
  upload:
    "The mail server refused to store the message in which ThunderNotes keeps an email's notes, " +
    "for example because the mailbox is full or the folder is read-only.",
  read:
    "A message in the ThunderNotes folder can't be read: another program may have changed or damaged it. " +
    "The notes in it aren't shown on this device. A damaged message is of no use: you can delete it from the server " +
    "below, and the warning goes away.",
  cleanup:
    "ThunderNotes can't remove old versions of its messages from the ThunderNotes folder, so they pile up there.",
  other: "Something unexpected went wrong while ThunderNotes was syncing its notes.",
};

/** Draws the sync warning (again: after a delete it may be gone). */
function showSyncWarning(open = false): void {
  messenger.runtime
    .sendMessage<
      { accountId: string; accountName: string; since: string; kind: string; message: string; items?: { id: string; subject: string }[] }[]
    >({ type: "syncProblems" })
    .then((problems) => {
      const box = $("syncWarning");
      box.replaceChildren();
      box.hidden = !problems?.length;
      if (!problems?.length) return;
      for (const p of problems) {
        const since = new Date(p.since).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        const line = document.createElement("a");
        line.className = "sync-line";
        line.textContent = `⚠ ThunderNotes can't sync its notes with ${p.accountName} since ${since}. ${open ? "Hide details" : "Details…"}`;
        const details = document.createElement("div");
        details.className = "sync-details";
        details.hidden = !open;
        const lead = document.createElement("p");
        lead.textContent = "Thunderbird is connected to the mail server, but syncing ThunderNotes' notes with it isn't working.";
        const what = document.createElement("p");
        what.textContent = EXPLAIN[p.kind] ?? EXPLAIN.other!;
        const safe = document.createElement("p");
        safe.textContent = "Your notes are safe on this computer, and ThunderNotes keeps trying. Your other devices don't get changes made here until it works again.";
        const tech = document.createElement("p");
        tech.className = "sync-tech";
        tech.textContent = `Details: ${p.message}`;
        details.append(lead, what);
        // Unreadable messages: each with a button to delete it from the server (two clicks).
        for (const item of p.items ?? []) {
          const row = document.createElement("div");
          row.className = "sync-item";
          const name = document.createElement("span");
          name.textContent = `“${item.subject}”`;
          const del = document.createElement("button");
          del.textContent = "Delete from the server";
          del.addEventListener("click", () => {
            if (!del.dataset.armed) {
              del.dataset.armed = "1";
              del.textContent = "Click again to delete";
              return;
            }
            del.disabled = true;
            messenger.runtime
              .sendMessage({ type: "deleteUnreadable", accountId: p.accountId, id: item.id })
              .then(() => showSyncWarning(true)) // gone when nothing is left
              .catch((e) => {
                del.disabled = false;
                del.textContent = `Couldn't delete (${e?.message ?? e})`;
              });
          });
          row.append(name, del);
          details.append(row);
        }
        details.append(safe, tech);
        line.addEventListener("click", () => {
          details.hidden = !details.hidden;
          line.textContent = line.textContent!.replace(/Details…$|Hide details$/, details.hidden ? "Details…" : "Hide details");
        });
        box.append(line, details);
      }
    })
    .catch(() => {});
}
showSyncWarning();

