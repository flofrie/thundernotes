# Submitting ThunderNotes to addons.thunderbird.net (ATN)

What the review needs, ready to paste. Checked against the ATN review policy
(https://thunderbird.github.io/atn-review-policy/), the reviewer guide
(https://addons-reviewer-guide.thunderbird.net/add-on-review-guide) and the Thunderbird guides on
source code submission and vendoring (https://webextension-api.thunderbird.net/en/mv3/), as of
2026-10-18.

## 1. The owner's steps

1. **Account:** sign in at https://addons.thunderbird.net (Developer Hub → Submit a New Add-on), with
   two-factor authentication.
2. **Build:** `npm ci && npm run package` on a clean `main`. It writes
   `build/thundernotes-<version>.xpi` and `build/thundernotes-<version>-source.zip` and prints the
   `.xpi`'s sha256; CI prints the same checksum (it's reproducible).
3. **Upload** the `.xpi`. Choose "On this site" (listed). Platforms: all.
4. **Source code:** answer "Yes" to "Do you need to submit source code?" and upload the
   `-source.zip`. Its `README.md` is the build instructions for the reviewers.
5. **Listing:** paste the texts from section 2, add screenshots (section 3), set the licence to
   *Mozilla Public License 2.0*, and paste the privacy policy (section 4) into its field: as text,
   not a link.
6. **Notes to reviewer:** paste section 5.
7. Answer reviewers' questions **within 10 days** (the policy's limit; after 7 days without an
   answer some requests are rejected).

Each later version: the same steps 2–4 and 6; the listing stays.

## 2. Listing

**Name:** ThunderNotes

**Summary** (at most 250 characters):

> Highlight passages in emails and attach Markdown notes in a margin beside the message. Checklist items become tasks with dates and labels in a task view. Notes sync between your computers through your own IMAP account.

**Description:**

> ThunderNotes lets you highlight text in any email and write notes about it, in a margin next to the message, like comments in a word processor. The email itself is never changed.
>
> **Notes:** select text to highlight it, in one of eight colours; write a note in Markdown with a live preview; notes on the whole email; fold notes to one line; lines connect each note to its passage; print an email with its notes.
>
> **Tasks:** every checklist item (`- [ ] …`) in a note is a task. Add due dates (`@friday`, `@2026-10-24`) and labels (`#project`); the task view collects the tasks from all your emails, grouped by date, label or email, with filters, sub-tasks and an overdue count.
>
> **Links:** link notes to other emails and see which notes link to an email.
>
> **Sync:** notes travel between your computers through your own mail account (IMAP), with no separate login, server or service. Edits made on two computers are combined; where both changed the same line, both versions are kept for you to choose.
>
> **Your data, in plain files:** export all notes as Markdown files and import them again.
>
> **What ThunderNotes changes in Thunderbird** (all to make its features work):
> - In each IMAP account where you write notes, it creates a folder named **ThunderNotes**. It holds one message per email you annotated, containing that email's notes, and replaces it when the notes change. The folder is kept out of Thunderbird's global search and checked for new mail like the Inbox. If you delete the folder, ThunderNotes recreates it from the notes on your computer and explains how to remove it for good (uninstall first).
> - Emails with notes get the **ThunderNotes** tag (keyword `$annotated`), shown in a ThunderNotes column in the message list.
> - It adds a ThunderNotes Tasks button and space, menu entries ("Highlight", "Print with Notes…", "Copy ThunderNotes link"), and a button in the message header.
>
> **Privacy:** no data goes to the developer or any third party. Notes are stored in your Thunderbird profile and, for IMAP accounts, in that account's ThunderNotes folder on your own mail server, as plain text: they are not encrypted, also when you annotate an encrypted email. Emails in Local Folders and POP accounts aren't synced; export is their backup. Details: privacy policy.
>
> Open source (MPL 2.0): https://github.com/flofrie/thundernotes

**Categories:** pick the closest ones the form offers (message reading, organisation or productivity).

**Support:** https://github.com/flofrie/thundernotes/issues · **Homepage:** https://github.com/flofrie/thundernotes

## 3. Screenshots (the owner takes them)

PNG, the Thunderbird window at a common size (for example 1280 × 800), with test emails only, no
real addresses:
1. An email with three or four highlights in different colours and their notes in the margin, with
   the connecting lines.
2. A note being edited (live preview with a checklist, a date and a label).
3. The task view grouped by due date, with labels and an overdue task.
4. The toolbar list of an email's notes, or the settings page.

## 4. Privacy policy (paste as text)

> **ThunderNotes privacy policy**
>
> ThunderNotes does not collect, send or share any data with the developer or any third party. It has no analytics, no tracking, no advertising and no cookies, and it contacts no server of its own.
>
> **What it stores, and where.** Your highlights and notes (the quoted passage, some text around it, your note, colours, dates and labels, and the email's Message-ID, subject, sender and date to find the email again) are stored:
> - in your Thunderbird profile, in the add-on's local database;
> - for emails in an IMAP account: as messages in a folder named "ThunderNotes" in that same account on your mail server, so they appear on your other computers. ThunderNotes uses Thunderbird's own connection to your mail server; it never sees or stores your password;
> - in export files, only when you export them, wherever you save them.
>
> The settings page also stores a device name (by default your computer's name), written into the notes you change, so that a version made on another computer can be told apart; you can change it.
>
> **Not encrypted.** Notes are stored as plain text, in your profile and on your mail server. If you highlight a passage of an encrypted (S/MIME or OpenPGP) email, the quoted passage is stored unencrypted too. Don't annotate an email whose decrypted text must not be stored that way.
>
> **Clipboard.** ThunderNotes reads or writes the clipboard only when you ask it to (paste into a note, copy a note or task).
>
> **Removing your data.** Deleting a note removes it everywhere (it can be restored for 30 days). Uninstalling ThunderNotes deletes its local database; the ThunderNotes folders on your mail server remain until you delete them in Thunderbird.

## 5. Notes to reviewer (paste)

> **Source code.** The add-on's TypeScript is bundled and minified with esbuild, so the source archive is attached. Its README.md gives the OS, exact Node.js/npm versions and commands (`npm ci && npm run package`). The build is reproducible: it produces a byte-identical .xpi, whose sha256 is printed and stated in the README, checked on Ubuntu 24.04 (Node 22 and 26) and macOS. Third-party code (CodeMirror, Lezer, markdown-it, DOMPurify, yaml, approx-string-match, node-diff3, fflate) comes from npm release versions, unmodified, pinned exactly and resolved in package-lock.json. No remote code is loaded; the editor is a bundled module loaded from the package on demand.
>
> **Experiment API** (`experiments/thundernotes/`, plain JavaScript, not built). Each function covers something the MailExtension APIs don't offer; we checked the Thunderbird MV3 API reference (folders, mailTabs, messages, menus):
> - `prepareCarrierFolder`: exclude the add-on's IMAP folder from global search and tick "check this folder for new messages" (no folder-property API; `folders.update` sets only `isFavorite`);
> - `subscribeCarrierFolder`: subscribe that folder again if the user unsubscribed it (unsubscribed folders are invisible to MailExtensions; no subscription API);
> - `refreshFolder`: fetch that folder's new messages promptly (no fetch API);
> - `expungeFolder`: remove replaced messages from the server (no expunge or compact API);
> - `refreshColumn` and the column itself: a message-list column showing which emails have notes (no column API in `mailTabs`), and the same icon on the cards view's cards, which show no custom columns (the cards' fill function is wrapped while the add-on runs and restored when it stops), and `setCardPreviews`: one line of the user's own note on the whole email shown on that email's card, handed over by the add-on;
> - "Print with Notes…" in the File menu and the message context menu (menus can't add to the File menu or the print dialog);
> - `focusMessagePane`, `focusCurrentTab`: move the keyboard focus after opening an email from the task view (no focus API);
> - `deviceName`: the computer's name as the default device name (no API).
> Each failure is handled: the add-on keeps working, and a failed folder setup is shown in its settings.
>
> **Permissions.** messagesRead (the shown email, the add-on's own folder), messagesImport and messagesDelete (write and replace the add-on's messages in its own folder only), messagesUpdate, messagesTags and messagesTagsList (the ThunderNotes tag on annotated emails), accountsRead and accountsFolders (find or create the add-on's folder per account), scripting (the highlight and margin script in the message pane), menus, storage, alarms (periodic sync), clipboardRead and clipboardWrite (only on user action: paste into a note, copy a note or task).
>
> **innerHTML.** Every assignment is either a static template or Markdown rendered in the background and sanitised with DOMPurify (`packages/core/src/markdown.ts`, `renderMarkdown`).
>
> **Validator warnings** (all expected):
> - *Invalid permissions* (messagesRead, accountsRead, messagesUpdate, messagesTags, messagesTagsList, accountsFolders, messagesImport, messagesDelete): these are Thunderbird MailExtension permissions that the Firefox-based linter doesn't know.
> - *contentDocument.documentElement / ownerDocument.defaultView not supported* (experiments/thundernotes/implementation.js): Experiment code runs with Thunderbird's privileges, where these exist.
> - *Unsafe assignment to innerHTML*: in the source, `card.ts` (the card's fixed template; note and conflict text rendered and sanitised with DOMPurify in the background), `content.ts` (the fixed cover over the add-on's own messages), `tasks.ts` (task text and note preview through `renderMarkdown`, DOMPurify). The three warnings at line 19 of popup.js, tasks.js and background.js are inside the bundled DOMPurify library itself.
>
> **Testing.** No account or credentials of ours are needed. With any IMAP account: open an email, select text, choose "Highlight" from the context menu or the floating button, and write a note. The ThunderNotes folder appears in that account; a second Thunderbird profile on the same account shows the note. The task view opens from the "ThunderNotes Tasks" toolbar button.

## 6. Open points to watch

- **Maximum version.** ATN's upload check requires `strict_max_version` for add-ons with an Experiment (it refused the first upload without it). The manifest sets the highest tested version (`158.*`, D41). With each new Thunderbird release: test, then raise the maximum on ATN for the listed version (Developer Hub → the version's compatibility) and in the manifest for the next one.

- **The name.** The policy asks Thunderbird-branded names to read "… for Thunderbird". "ThunderNotes" doesn't contain the trademark, but a reviewer may comment; fallback: "ThunderNotes – notes and tasks for Thunderbird".
- **Data-collection declaration.** Firefox now asks extensions to declare data collection in the manifest (`data_collection_permissions`). We found no source saying ATN requires it yet. If the upload check asks, add `"data_collection_permissions": { "required": ["none"] }` under `browser_specific_settings.gecko`.
- **Review time.** Source submissions and Experiments get a manual, admin-level review: expect it to take a while.
