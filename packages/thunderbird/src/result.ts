/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Small result window for "Update ThunderNotes tags" (folder pane menu), also used for the
// notice when the carrier folder went missing and was restored (D20).

const q = new URLSearchParams(location.search);
const text = document.getElementById("text")!;
const n = (key: string) => Number(q.get(key) ?? 0);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

if (q.get("notice") === "folderRestored") {
  document.title = "ThunderNotes folder restored";
  const folder = `"${q.get("folder")}"`;
  const why = {
    moved:
      `The folder ${folder} in ${q.get("account")} was renamed or moved: it is now "${q.get("path")}". ` +
      `ThunderNotes needs it under exactly that name at the top of the account, so it has created it again ` +
      `from the notes on this computer. "${q.get("path")}" is no longer used; you can delete it. `,
    trash: `The folder ${folder} in ${q.get("account")} was deleted. ThunderNotes has restored it from the notes on this computer. `,
    unknown:
      `The folder ${folder} in ${q.get("account")} is missing: it was deleted, renamed or moved, perhaps on another device ` +
      `or in webmail. ThunderNotes has created it again from the notes on this computer. If a renamed or moved copy ` +
      `is left over, it is no longer used and you can delete it. `,
  }[q.get("lost") ?? "unknown"] ?? "";
  text.textContent =
    why +
    `ThunderNotes keeps your highlights and notes in this folder so they appear on all your devices. ` +
    `To remove ThunderNotes for good, uninstall the add-on first, then delete the folder.`;
} else if (q.get("notice") === "folderResubscribed") {
  document.title = "ThunderNotes folder subscribed again";
  text.textContent =
    `The folder "${q.get("folder")}" in ${q.get("account")} was unsubscribed. ThunderNotes keeps your highlights and notes ` +
    `there so they appear on all your devices, and can't reach an unsubscribed folder, so it has subscribed it again. ` +
    `To remove ThunderNotes for good, uninstall the add-on first, then delete the folder.`;
} else if (q.get("notice") === "emailNotFound") {
  document.title = "Email not found";
  text.textContent =
    `The linked email isn't in Thunderbird on this device (Message-ID ${q.get("id")}). It may be in an account ` +
    `that isn't set up here, in a local folder of another computer, or deleted.`;
} else if (q.has("error")) {
  text.className = "error";
  text.textContent = `Updating tags failed: ${q.get("error")}`;
} else {
  const changes = [n("tagged") && `tagged ${plural(n("tagged"), "email")}`, n("untagged") && `removed the tag from ${plural(n("untagged"), "email")}`].filter(Boolean);
  text.textContent =
    `${q.get("folders")}: checked ${plural(n("checked"), "email")}, ` +
    (changes.length ? `${changes.join(" and ")}.` : "all tags were already correct.");
}
document.getElementById("close")!.addEventListener("click", () => window.close());
