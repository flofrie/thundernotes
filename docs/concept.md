> Snapshot of the living concept doc as of 2026-10-17; where they differ, `docs/DECISIONS.md` takes precedence.

# ThunderNotes — Concept

As of 2026-10-17 · Florian

ThunderNotes 0.41.0 lets you highlight text in any email, attach Markdown notes in a Word-style margin, work through the tasks in those notes in a task view, and find everything again on every device through a `ThunderNotes` folder in each IMAP account. This doc describes the product as designed and built through decisions D1–D41; where it and `docs/DECISIONS.md` in the repo differ, the decision log wins.

## Goals and principles

ThunderNotes must install and work like any other add-on, keep notes as plain portable Markdown, and never change the original email.

- **Zero extra setup (D16).** No separate login, software or configuration for the core features; sync uses the accounts already set up in Thunderbird. Anything that needs more, such as the native helper for a Markdown folder with Git, is an opt-in power feature.
- **Never touch the original email.** Notes live beside the message, keyed by its Message-ID (D2). The only mark on the original is the `$annotated` keyword behind the tag and the column.
- **Plain, portable Markdown (D25).** One readable Markdown file per email is the canonical format: the same for export, IMAP carriers and the future Git folder. Every other store is a sync target or a cache that can be rebuilt.
- **Standard IMAP only (D7, D14).** Carriers are ordinary messages in an ordinary folder, so any server works. On Gmail they stay visible as clearly named messages (D8).
- **Local-first.** Everything works offline; sync catches up later.
- **Nothing is lost silently.** Notes whose passage can't be found stay listed, clashing edits become conflict boxes, deletions can be restored for 30 days, and unsaved text survives a crash.
- **No encryption by default (D9).** Formats stay plain so sharing notes remains possible later.

| Fixed fact | Value |
| --- | --- |
| Add-on ID | `thundernotes@webterminate.com`, never to change: updates and local storage are tied to it (D17) |
| Licence | MPL-2.0, the header in every source file (D18) |
| Platform | Thunderbird ≥ 153 (the current ESR), MailExtension Manifest V3 (D41); tested on 158 |
| Repositories | Public `flofrie/thundernotes`, one commit per release; development in the private `flofrie/thundernotes-dev` (D12) |
| Distribution | An `.xpi` from `npm run package`, attached to each public release (`docs/RELEASE.md`) |
| Current version | 0.41.0 |

## Architecture

ThunderNotes is one TypeScript monorepo (D13): a client-independent core, a Thunderbird add-on that does everything a user needs including IMAP sync (D14), and an optional native helper.

| Package | What it holds | Status |
| --- | --- | --- |
| `core` | Data model, W3C anchoring, Markdown + YAML format, carrier messages, three-way merge and conflict boxes, colours. No Thunderbird, Outlook or Node APIs. | Built, unit-tested (`npm test`) |
| `thunderbird` | MailExtension: message display script (highlights, margin cards, editor loader), background script (IndexedDB store, Markdown rendering, sync), toolbar popup, task view, options page, one Experiment | 0.41.0 |
| `helper` | Optional native messaging host: live Markdown folder with Git (D6) | Not started (phase 3) |
| `outlook` | Modern add-in for Microsoft 365/Exchange, storage via Microsoft Graph (D15) | Later |

The display script runs inside every shown email, so it stays small (D22): rendering, sync and other heavy code live in the background, and the editor is loaded only when editing starts (D28).

```text
Views:         message display script  |  toolbar popup  |  task view  |  options page  |  Notes space tab (phase 3)
                                       ⇅
Background:    the annotation store — IndexedDB · Markdown rendering · IMAP sync engine · merge
                                       ⇅
Sync targets:  Markdown folder (helper, phase 3)  |  IMAP ThunderNotes folder  |  Notion (later)
```

Two-headed arrows sync both ways; parts marked with a phase or "later" are not built yet. All views talk to one store in the background script, so a new sync target never touches the UI.

**The Experiment API.** One small Experiment (`packages/thunderbird/experiments/thundernotes/`) does what no MailExtension API can. It is the only privileged code and is checked on every Thunderbird ESR, since it uses internal modules (D19, D26).

| Job | Why an Experiment | Decision |
| --- | --- | --- |
| Keep the carrier folder out of global search | The per-folder "include in global search" option has no API | D19 |
| ThunderNotes column in the message list | No column API; uses Thunderbird's `ThreadPaneColumns` | D26 |
| Tick "check this folder for new messages" and fetch the folder | No API fetches a folder from the server | D27 |
| Expunge the carrier folder | Removes replaced revisions from the server promptly | D7, D27 |
| Read the computer's name for the device name | No API exposes it | D32 |
| Subscribe an unsubscribed carrier folder again | Unsubscribed folders are invisible to add-ons; uses `nsISubscribableServer` | D36 |
| Keyboard focus into the message pane or a tab | A page's own request for the focus is ignored there | D37, D38 |
| "Print with Notes…" in the File and right-click menus | Add-ons can add only to their own right-click submenu, never to the File menu or the print dialog | D23 |

**Platform choice.** Only a MailExtension can draw highlights inside the message pane, so a standalone app or an IMAP proxy was rejected. IMAP in the helper was rejected because it would need extra software and credentials (D16, D19). Outlook comes later as a modern add-in for Microsoft 365/Exchange mailboxes; Microsoft doesn't load add-ins for IMAP accounts or classic Outlook (D15).

## Email identity and anchoring

An email is identified by its Message-ID (D2), and each highlight is anchored by W3C Web Annotation selectors matched against the visible text of the view currently shown (D3, D21).

**Identity**

- The `Message-ID` header is the only key; folder and UID change on every move and are never used. Without a Message-ID, a fingerprint hash of Date + From + Subject + the first 1 KB stands in.
- The same Message-ID in several folders (Sent and Inbox, copies) is one email: its notes show on every copy.
- One annotation set per email, not per thread, because threads change (D4): one file and one carrier message per email.
- Links to emails will use `mid:` URIs (RFC 2392).

**Selectors.** Each highlight stores a `TextQuoteSelector` (the exact text plus about 32 characters of prefix and suffix) and a `TextPositionSelector` (start and end offsets), both on normalised text: whitespace and block boundaries become one space; `>` quote markers at line start, soft hyphens and zero-width characters are dropped; invisible elements are skipped; bracketed URLs like `<https://…>` are dropped because Plain view prints links that way. Anchoring against the raw MIME source was rejected: the highlight must be found in the displayed text anyway.

**Matching order** (spike `spikes/highlight-anchor`, across Original, Simple and Plain views):

1. Position, verified against the quote
2. Exact quote
3. Quote with prefix/suffix context
4. Loose: letters and digits only, case-insensitive
5. Fuzzy, with `approx-string-match` (Myers' algorithm, as in Hypothesis). Required, because Plain view rewrites HTML (`*` bullets, `/emphasis/`, links as `text <url>`).
6. Partial: text that exists in only one view (Simple view shows `display:none` content) highlights what survives, and the note is marked "partly shown".
7. Orphan: no match at all. The note is never dropped.

**Orphans** sit in the margin right after the whole-email note, before the anchored cards, with a warning line: "This note belongs to a passage of this email that can't be found at the moment" (tooltip: it may show in another view; if it keeps happening, tell the author). They are also listed in the toolbar list. There is no repair tool (D23).

## Highlights, notes and cards

A highlight is a note with empty text (D24): you select and pick a colour, and click the highlight whenever you want to write something about it. Notes sit in cards in a Word-style right margin that never covers the email (D23).

**Highlighting and editing (D24)**

- Selecting text shows a bar of eight colour dots, marked as ThunderNotes' by a small post-it; a click highlights in that colour (D29). Ctrl/Cmd+Shift+H highlights in the ringed colour; Ctrl/Cmd+Shift+N highlights and opens the note.
- Clicking a highlight, or a note's text, opens its card straight in edit mode; links in a note still open in the default browser.
- Leaving the card saves: clicking elsewhere, switching message or window. Esc discards only this editing session's changes; Ctrl/Cmd+Enter saves and stops editing. There are no Edit, Save or Cancel buttons. Switching to another app is not leaving: editing goes on with the cursor where it was.
- A note left empty is a plain highlight and leaves the margin, so marking text doesn't make the email narrow and widen again. Highlights with a note are framed.
- 🗑 on a card deletes the note and its highlight, as deleting a Word comment does. Right-click offers **Remove highlight** on a plain highlight and **Remove note** on one with a note.
- The note on the whole email is a card pinned at the top of the margin.

**Margin cards (D23)**

- Each card sits at the height of its highlight; overlapping cards are pushed apart and the active card stays level with its text. Cards of highlights on the same line follow the text order.
- While an email has notes it is narrowed to make room (30 % of the pane, 200–320 px); emails without notes keep their full width. Fixed-width emails wider than the space left get the column after their content.
- A toggle hides the column; the width can be dragged at a card's left edge (180 px to 60 % of the pane, remembered; double-click returns to automatic).
- Hovering a highlight or card emphasises the other. A card opened from its highlight or the toolbar list is scrolled into view.
- Order in the margin: whole-email note, then notes whose passage can't be found (with their warning line), then the anchored cards.
- Lines from cards to their highlights (optional): a straight stroke, like a slightly translucent felt-tip pen, from the middle of each card's left edge to the middle of its underlined passage, across the text if need be. It is in the highlight's darker shade, a little stronger for the active note. Right-angled Word-style lines were tried first and were hard to follow. Off by default on screen; on by default when printing with notes. The two settings are independent.
- Printing: an email prints without ThunderNotes. "Print with Notes…" and "Print with Notes, All Expanded…" sit right after "Print…" in the File menu and the right-click menus (added by the Experiment).

**Colours (D29).** Eight named colours work as categories: yellow (default and fallback), green, blue, pink, orange, red, purple, grey. They are stored by name, so other clients map names to their own shades. All are light, like sticky notes; highlight and card share the colour.

| Where | How |
| --- | --- |
| Text colour | White on orange, red, purple and grey; on the others black or white by the WCAG contrast ratio. Always on cards; in highlights by a setting (on by default). |
| New highlights | The last colour chosen (setting, on by default; off = always yellow) |
| Choosing | Colour bar after selecting; colour dot on each card; a row of colours in the right-click menus; Colour submenu in Thunderbird's menu on a highlight; Cmd+Option+1…8 (Ctrl+Alt+1…8) for the active card |
| Whole-email note | Starts yellow, can be recoloured like any card (`email_note_colour`) |

**Folding (D30).** A chevron tab on a card's top edge (shown on hover) or a click on the quote line folds the card to that line, keeping its colour button and bin; clicking again opens it. A folded card still opens its editor when its highlight is clicked and folds back afterwards. Folding is a viewing choice: remembered per note on this device only, unless the setting "Sync collapsed and expanded notes to your other devices" is on. Then it travels in a separate `folded` map with its own timestamps, so a fold can never override a note edited elsewhere.

**Highlighted links (D31).** A click on the highlighted part of a link opens a small popup: the destination (host in bold, then the shortened path), **Add note** / **Edit note**, and **Open link**. Cmd/Ctrl+click opens the link directly. Thunderbird's right-click menu on any highlight also offers Add note / Edit note. Showing the destination also helps spot links whose text says something else.

**Toolbar button and list.** The message toolbar button shows the count of notes as a badge. Its list shows the whole-email note and every highlight in reading order, including those that can't be placed; a click goes to the card and stays there (in edit mode when the email has the keyboard focus). The list also carries:

- notes changed on two devices (D32), also named in the button's tooltip;
- "Restore N deleted in the last 30 days", set apart below a line in the accent colour (D33);
- a red line when sync has a problem, which opens an explanation (D35); unreadable carriers listed by subject, each with "Delete from the server".

**In the message list.** Annotated emails carry the `$annotated` keyword, shown as a Thunderbird tag: set with the first note, removed with the last, stale tags cleaned up when an email is shown, and "Update ThunderNotes tags" per folder in the folder pane. A sortable ThunderNotes column shows a post-it on those emails; it reads only the keyword, never the note store (D26). Carrier messages opened in Thunderbird show a dismissable cover saying they are internal to ThunderNotes, with no highlight UI (D27).

**Safety nets**

| Situation | What you see | Decision |
| --- | --- | --- |
| Same lines edited differently on two devices | Card with an orange stripe and "2 versions" on its quote line (also folded); each conflict box shows both versions (device, local time) with **Keep this** / **Keep both** | D32 |
| Thunderbird closed while typing | "Unsaved text from \<time>: Thunderbird closed while you were writing" on the card, with **Restore** and **Discard**; drafts are saved 1.5 s after the last change, on this device only | D34 |
| Deleted something by mistake | "Restore N deleted in the last 30 days" in the toolbar list brings back all deletions on that email; Cmd+Z covers a wrong edit right away | D33 |
| Sync has a ThunderNotes-specific problem | The post-it icon turns red and unhappy; tooltip names the account; the list explains the kind of problem and that the notes are safe on this computer | D35 |
| Carrier folder deleted, renamed, moved or unsubscribed | Folder restored or subscribed again, with a notice that explains how to remove ThunderNotes for good | D20, D36 |

## Note editor

Notes are edited in an Obsidian-style live preview on a slim CodeMirror 6, loaded only when editing starts, so viewing emails costs nothing extra (D28).

- **Loading.** The 297 KB bundle (core + `@lezer/markdown`, no HTML/JS languages) is loaded with `import()` of a file in `web_accessible_resources` (about 43 ms, spike `spikes/lazy-editor`). Until then a card shows the note rendered in the background: a markdown-it subset with linkify and DOMPurify, only http(s) and mailto links (D22). A textarea editor remains as the fallback.
- **Live preview.** Markdown shows formatted; the markup is visible only on the line being edited. Covered: bold, italic, inline code, headings, lists, task checkboxes (clickable in both views), links (destination as tooltip), quotes and code. The editor has its own right-click menu (Cut, Copy, Paste, Select All), as Thunderbird's message-pane menu has no Paste.
- **Code.** Fenced code blocks are a shaded box in the editor and the shown note; the \`\`\` fences show only while the cursor is in the block, so nothing jumps when editing starts. No blank lines are needed around a block (CommonMark). Indented (4-space) code gets the same box.
- **Quotes.** Nested quotes (`> >`) have one bar that moves in with the text, 1.2em per level, in both views.
- **Lists.** Every list marker (bullet, number or checkbox) has one fixed width, 1.4em, in both views, and that is the indentation step; an item's continuation lines start where its text starts. Off the cursor line the editor draws nesting as these steps and hides the 1–3 meaningless leading spaces of plain lines.
- **Numbered sub-lists may start at any number**, for example sub-points numbered on across items. This is a deliberate departure from CommonMark, which requires 1 there, so other Markdown tools show such sub-lists as text. After ordinary text, a number other than 1 still doesn't start a list.
- **Renumbering.** Numbered lists renumber themselves after an edit, from the first item's number (all Markdown keeps). It is its own undo step, so Cmd/Ctrl+Z right after restores the typed numbers. A setting turns it off.
- **Pasted URLs** are written as Markdown links (`[example.com/page](https://example.com/page)`, or with the selected text as label), so the file says what the card shows. Bare URLs typed by hand stay as typed (valid GFM, linked when shown).

| Key | In the editor |
| --- | --- |
| Tab / Shift+Tab in a list | Nests the item and its sub-items under the item above, at that item's text column (2 spaces under `-`, 3 under `1.`) / returns it to its parent's level. A nested numbered item gets 1 when it starts a sub-list, else the next number. |
| Tab in code | Inserts 4 spaces at the cursor or before each selected line |
| Tab elsewhere | Adds a quote level (` >  `); Shift+Tab removes one. Each selected line by its own kind; Tab never leaves the editor. |
| Ctrl+Shift+7 / Ctrl+Shift+8 | Numbered / bulleted list on the line or all selected lines, checkboxes kept; again: plain text. Ctrl on macOS too, because Cmd+Shift+7 is the system Help search on German keyboards. |
| Cmd/Ctrl+L | Text → `- [ ]` → `- [x]` → `- [ ]` (setting: ticked goes back to text) |
| Cmd/Ctrl+Shift+L | Lines become a checklist, or a checklist goes back to text |
| `[]` or `[ ]` + space at line start | Becomes ` - [ ]  ` |
| Cmd/Ctrl+K | On a URL: turns it into a Markdown link (also in the right-click menu). On other text: `[text](url)` with the clipboard's URL, or the cursor where the URL goes. |
| Delete at an item's end / Backspace at the next item's start | Joins the items: only the lower item's text comes up, its marker goes. Backspace on a first item with nothing above only removes its marker. |
| Ctrl/Cmd+Enter / Esc | Save and stop / discard this session's changes |

## File format

Each email's notes are one Markdown file: all machine data in YAML front matter, the notes for people in the body (D25, `packages/core/src/format.ts`). The same file is the export, the IMAP carrier attachment and, later, the Git folder.

```markdown
---
thundernotes: 1
message_id: CAF3xQ9b1k@mail.example.com
subject: Contract renewal – draft v3
from: Anna Weber <anna@example.com>
date: 2026-10-12T07:14:00.000Z
folder_hint: /INBOX/Clients
created: 2026-10-13T08:02:11.000Z
updated: 2026-10-16T09:41:03.000Z
rev: 6
email_note_updated: 2026-10-13T08:05:00.000Z
email_note_colour: green
annotations:
  - id: 7f3c9a10-5b2e-4c1d-9a8f-0e6d2c4b1a37
    quote: termination period of 6 months
    prefix: "agreed that the contract has a "
    suffix: " from the end of each calendar"
    position: [1043, 1073]
    colour: red
    created: 2026-10-13T08:02:11.000Z
    updated: 2026-10-16T09:41:03.000Z
    text_by: Florian's MacBook
    text_base: 3e9a01c4
    colour_updated: 2026-10-13T08:02:11.000Z
tombstones:
  - id: 2b8e41d0-91aa-4f3e-8c55-6a0f2d7e9b12
    deleted: 2026-10-15T14:20:00.000Z
    quote: signed copy by Friday
    created: 2026-10-13T08:10:00.000Z
    updated: 2026-10-13T08:10:00.000Z
    note: Check with legal first.
folded:
  7f3c9a10-5b2e-4c1d-9a8f-0e6d2c4b1a37: { folded: true, at: 2026-10-16T09:45:00.000Z }
---

# Contract renewal – draft v3

General note on the whole email goes here.

## “termination period of 6 months” <!-- tn:7f3c9a10-5b2e-4c1d-9a8f-0e6d2c4b1a37 -->

We agreed **3 months** in the call. Push back.

- [ ] Reply to Anna
```

**Front matter fields**

| Field | Meaning | Since |
| --- | --- | --- |
| `thundernotes` | Format version, 1 | D25 |
| `message_id`, `subject`, `from`, `date`, `folder_hint` | The email reference; only `message_id` is a key, the rest make the file readable | D2, D25 |
| `created`, `updated`, `rev` | Set timestamps and revision number | D25 |
| `annotations[]`: `id`, `quote`, `prefix`, `suffix`, `position`, `created`, `updated` | Anchoring selectors and timestamps per highlight; authoritative for anchoring | D25 |
| `colour`, `tags` | Colour by name; tags reserved for later | D29 |
| `text_updated`, `colour_updated` | Own timestamps for text and colour (missing = `updated`) | D32 |
| `text_by`, `text_base` | Device that last changed the text; hash8 of the synced text it was edited from | D32 |
| `email_note_updated`, `email_note_colour`, `email_note_colour_updated`, `email_note_by`, `email_note_base` | The same for the whole-email note | D29, D32 |
| `tombstones[]`: `id`, `deleted`, plus a copy of the annotation and its `note` | Deletions that sync, restorable for 30 days | D7, D33 |
| `deleted_email_note`: `note`, `deleted` | Text of an emptied whole-email note, restorable for 30 days | D33 |
| `folded`: id → `folded`, `at` | Folded cards, only with the sync-folding setting on | D30 |

**Body rules.** `# Subject`, then the whole-email note, then one `## “quote” <!-- tn:<id> -->` section per highlight that has a note; plain highlights exist only in the front matter. On reading, the marked section is authoritative for note text; headings without a marker belong to the note above; text before the first marked section is the whole-email note; a missing section means an empty note.

**Export and import.** Without the helper, notes live in IndexedDB. The options page exports a zip of these files, in folders by year and month (`YYYY/MM/YYYY-MM-DD_subject-slug_<hash8>.md`, D5), and imports a zip or single `.md` files. Import merges per annotation id, the newer `updated` wins; equal times with different content mean the file was edited by hand, so the file wins.

The zip also holds a `settings.json`: the options, label colours and order, the task view's choices and the notes collapsed on this computer, but nothing tied to one computer (device name, column width, sync state, drafts). Importing restores it only when "Also restore settings when importing" is switched on; label colours are then merged label by label, the newer one winning, as in sync.

Rejected: machine data in per-note HTML comments, JSON only, `.md` + `.json` pairs. A W3C Web Annotation JSON export can be added for interop if needed.

## IMAP sync

Notes on an email sync through the IMAP account that holds the email, as one carrier message per email in a folder `ThunderNotes` at the account's root; every device signed into that account sees the same notes (D7, D14, D27, `packages/thunderbird/src/sync.ts`).

The add-on does this itself through Thunderbird's mail APIs, with the accounts and logins already in Thunderbird, OAuth included. Emails in local folders and POP accounts are not synced; they stay local, and export is their backup.

**Carrier message** (`packages/core/src/carrier.ts`)

| Part | Content |
| --- | --- |
| From, Subject | `ThunderNotes <thundernotes@thundernotes.invalid>`, `[ThunderNotes] <email subject>` |
| Message-ID | Fresh for every revision (`tn-<hash8>-<rev>-<random>@thundernotes.invalid`), because Thunderbird refuses a Message-ID already in the folder |
| Headers | `X-Annot-Version: 1`, `X-Annot-Ref: <original Message-ID>`, `X-Annot-Rev`, `X-Annot-Updated`, `X-Annot-Client` |
| Body | `multipart/mixed`: a text/plain notice for other clients (internal to ThunderNotes, don't edit or delete; to stop for good, uninstall first, then delete the folder) + the D25 file as a `text/markdown` attachment, read with `messages.getAttachmentFile` |
| Flags | Always `\Seen`, so it never counts as unread |

**Settings carrier (D40).** Settings that belong to no email and should be the same everywhere (for now label colours) travel in one extra carrier per account: the same headers with `X-Annot-Ref: <thundernotes-settings@thundernotes.invalid>`, subject `[ThunderNotes] Settings`, body a notice + `thundernotes-settings.json`. Merged per label, the newer choice wins, also "no colour"; after an upload the older settings carriers are deleted, so one remains.

**The folder** stays subscribed and visible: spike `spikes/imap-folder` showed that add-ons can't see unsubscribed folders, so D7's hidden folder was impossible (D19). The Experiment keeps it out of global search, and the add-on filters carriers out of its own views; the quick filter inside the folder still finds them, which is accepted. Each session the folder is set up again (excluded from search, "check this folder for new messages" ticked), which repairs settings changed by hand. Other clients see the folder and the carriers' plain-text notice. On Gmail every label also shows in All Mail and web search, so carriers stay visible there (D8).

**Sync rules**

1. **Push.** A local change is pushed 2 s later: the new revision is imported with a fresh Message-ID, then older revisions are deleted permanently (skipping Trash) and the folder is expunged.
2. **Pull.** 5 s after startup, every 10 minutes, and 1.5 s after Thunderbird reports new mail or changes in a carrier folder (the Experiment makes Thunderbird check it like the Inbox). Sync reads the `X-Annot-*` headers, merges carriers not yet merged, and redraws open messages.
3. **Merge per part (D32).** Per annotation id, text, colour and tags are decided separately. Colour: newer wins, never a conflict.
4. **Text, three-way.** Each device keeps, locally only, the last 10 synced texts per note (`syncHistory`). A carrier names the base it was edited from (`text_base`). The receiver merges line by line against that base with node-diff3: changes to different lines combine; only lines changed differently on both sides become a conflict box. An incoming text this device already synced is stale and ignored. Without a known base, lines both have are kept, additions of either side are kept, and the rest is a conflict.
5. **Delete.** A deletion is a tombstone with a copy of what was deleted; other devices delete too. Tombstones are dropped after 30 days, and with them the chance to restore (D33). Restored notes count as changed at that moment, so other devices take them back. "Delete for good" purges the copies on one email on all devices: the file records the time (purged\_before), so a copy another device still has doesn't come back; the tombstones stay.

**Conflict box.** Plain Markdown in the note, an Obsidian/GitHub-style callout, readable and resolvable by hand anywhere. Versions come newer first, with UTC times, so every device that combines the same two versions writes the same text and devices settle instead of overwriting each other. A version with no lines shows `*(removed)*`.

```markdown
> [!conflict] Changed on two devices — keep one
> **Work laptop · 2026-10-17 09:14 UTC**
> - [ ] call her back on Monday
>
> **MacBook · 2026-10-17 09:12 UTC**
> - [ ] call her back on Friday
```

**When the folder goes missing (D20, D36)**

| What happened | What ThunderNotes does |
| --- | --- |
| Folder deleted | Recreates it, re-uploads from the local store, and explains: notes live here; to remove it for good, uninstall the add-on first, then delete the folder |
| Folder renamed or moved | Counts as missing (the folder is found by name at the account root) and is recreated. The notice names the old folder if the carriers turn up there ("no longer used and can be deleted"); in the trash it says deleted; not found, "deleted, renamed or moved". Done in this Thunderbird, the check runs at once; elsewhere, at the next check. |
| A carrier deleted by hand | Re-uploaded silently at the next check, from any device that still has the notes |
| Folder unsubscribed | Sync can't see it, so the Experiment checks the server's folder list like the Subscribe dialog; if the folder exists, it is subscribed again with a notice. Also checked once per session where nothing points to a folder yet (a fresh device). Only a folder missing on the server is created. |

**Sync warning (D35).** Each account's outcome is recorded. Failures where the server can't be reached at all (unknown host, refused, timeout, offline and similar) don't count: Thunderbird reports those itself and a later sync uploads what is pending. Only ThunderNotes-specific problems while the connection works warn, after 2 failures in a row: folder (can't be found or created), upload (server refuses a carrier), read (a carrier can't be read; warns at once and while that message exists, with "Delete from the server"), cleanup (old versions can't be removed), other. The next successful sync clears the warning. Sync decisions are logged to the add-on's console (Debug Add-ons → Inspect).

Rejected for storage: a carrier in the email's own folder (shows everywhere), IMAP `METADATA` (per mailbox, size-limited, patchy support), keywords on the original (no content), headers on the original (IMAP messages are immutable). Optional encryption of the Markdown part stays possible later (D9).

## Settings

The options page groups its settings in cards by area, with switches and live examples for highlights and dates; everything works without configuration (D16). It also shows each account's sync state with "Sync now", and holds export and import.

| Card | Settings (default) |
| --- | --- |
| Highlights | Use the last colour for new highlights (on); adjust the text colour for contrast (on) (D29) |
| Writing notes | Show editing hints (on); renumber numbered lists automatically (on) (D28) |
| Keyboard shortcuts | Cmd/Ctrl+L turns a ticked checkbox back into text (off); Cmd/Ctrl+K opens the link picker (on) (D28, D39) |
| Dates | Hide the current year (on); past due dates in red (on) (D38) |
| Task view | Stay on a task when ticking with Space (off); animate changes (on); keep the filters at the top (on) (D38) |
| Lines and printing | Lines from notes to their highlights on screen (off) and when printing with notes (on) (D23) |
| Sync and devices | Sync state per account, "Sync now"; name of this device (the computer's name); sync collapsed and expanded notes (off) (D30, D32, D35) |
| Backup | Export (notes as Markdown plus `settings.json`), import, "Also restore settings when importing" (off) (D25) |
| Developer | Show developer functions (off): "Show match types (debug)" on the header button's menu |

## Search and the Notes space (planned)

A Notes space, a full tab opened from Thunderbird's spaces toolbar, will list all notes with full-text search; it is phase 3 and not built yet. Today emails with notes are found through the `$annotated` tag (quick filter, saved searches) and the ThunderNotes column.

- **Index:** MiniSearch or FlexSearch in the background, rebuilt from the store at any time; note text, quote, tags, the email's subject and sender.
- **Query:** free text plus filters, e.g. `tag:legal from:anna`.
- **Results:** note snippet + email subject; a click opens the email and goes to the highlight.
- **Outside Thunderbird:** the exported or helper-written Markdown folder is searchable with any editor, Spotlight or Obsidian.

Carriers stay out of Thunderbird's own mail search (D19), so notes never show up there.

## Tasks (phase 5)

Every open checklist item in a note is a task, with two optional, independent dimensions: a due date and labels (D38). A task list or project is simply a label; "important" is a label too. Built: dates and labels in notes, the task view, sub-tasks, copying as Markdown. Still planned: reminders (below).

```markdown
- [ ] Send Anna the revised contract @2026-10-24 #contract-renewal #important
```

|  | Written | Typed | Shown |
| --- | --- | --- | --- |
| Due date | `@2026-10-24` in the file | `@friday`, `@tomorrow`, `@24.10.` with autocomplete | "Fri 24 Oct", red when past (due dates only: dates in open checklist items) |
| Label | `#name`, any number | autocomplete from labels used before | chips; also usable in ordinary notes |

**Time references**

- *Absolute:* `@due(2026-10-20)` or with time.
- *Relative to now:* `@due(+2d)`, `@due(+3h)`, or natural language typed in the editor ("in 2 days", "next Monday") parsed with chrono-node and **normalised to an absolute date on save**, so "in 2 days" doesn't drift.
- *Relative to a date in the email:* the add-on detects dates in the message ("deadline 24 Oct", meeting invites) and offers them as anchors, e.g. "remind me 1 day before the date mentioned". A nice-to-have; the core need is a reminder on a certain date (absolute).
- *No time:* a plain `- [ ]` is an undated task; it appears in the task list but never alerts.

**Reminder delivery:** `alarms` API schedules, `notifications` API shows a desktop notification with "Open email", "Snooze 1h / tomorrow", "Done". Missed reminders (TB was closed) fire on next start.

**Task view across all emails** — its own tab, opened from the "ThunderNotes Tasks" button in the main toolbar, its icon in the spaces toolbar on the left, or "All tasks…" in the note popup (built in 0.24.0):

- Grouped by due date (Overdue, Today, Next 7 days, Later, No date, by a task's earliest date), by label or by email; done tasks hidden, shown inline or in a Done group of their own.
- Each row: the task rendered as in the note (dates, labels, links), the email's subject, sender and date (click opens it), and the highlighted passage its note belongs to.
- Label chips and a filter field (words, phrases, exclusions, OR, brackets, regex, date tokens) filter; the choices are remembered on this device.
- Ticking a box writes `[x]` back into the note like an edit in the email (synced, open emails redrawn), with Undo for a few seconds; the note stays the source of truth.
- Only dates in an open checklist item are due dates; other dates are references and never turn red.
- Optional later: mirror dated tasks into a Thunderbird calendar (CalDAV) for phone reminders, once its calendar API is official.

**Label colours (D40):** right-click a label anywhere (task view, note, editor) to give it one of the eight highlight colours or "no colour" (a grey dot struck through in red). A coloured label shows a tint and a darker border wherever it appears; uncoloured is the default. The colours are the same on all devices (settings carrier).

**Label order (D40):** most used (default), A–Z, Z–A, or an own order made by dragging the label chips (or "Move to front / left / right"), chosen with a ⇅ button at the start of the label row. It orders the chips, the label sections and the Done group's label sort, and syncs in the settings carrier as a whole (the latest arrangement wins).

**Finished date (D38):** ticking a task appends `✅ 2026-10-17` to its line (as the Obsidian Tasks plugin writes it), shown as a small grey "done Sat 17 Oct"; unticking removes it. The Done group sorts by latest or earliest done, due date either way, or label.

**Grouping (D38):** open tasks can be grouped by due date (the default: what's urgent), by label (one section per label: where projects stand) or by email (what is still open in a conversation). Done tasks stay in their own group last.

**Quick actions (D38):** right-click a task to set its due date (today, tomorrow, in a week, or a typed date word), remove a date, or add or remove a label, each with Undo. Only the task's own lines are rewritten, like ticking; free text editing stays in the note, one click away.

**Working through the list (D38):** the filter takes words, "phrases", -exclusions, or, (brackets), /regex/ and dates as tokens (@2026, @2026-10, @2026-10-24), tidied on Enter, with matches marked in the tasks. A selected task works with keys (Space ticks, Enter opens, d date, l label, t tomorrow, →/← note); each task can show its whole note; the shown list copies as Markdown; dropping a label chip onto a task adds the label; rows slide to new places when the order changes.

**Sub-tasks (D38):** a checklist item indented under another is its sub-task; under a plain bullet, the bullet names what it is part of. Each task keeps its own row: a sub-task says "↳ part of …" (a click selects the parent), a parent shows "2/5" done. Grouped by email, sub-tasks are indented under their parents. Selecting a task draws lines in the left margin to its sub-tasks (accent colour) and its parent (grey); ends off screen get a marker at the window's edge. No automatic ticking.

**Opening the task view (D38):** the "ThunderNotes Tasks" button in the main toolbar, or its icon in the spaces toolbar on the left of the main window (next to Mail, Calendar and Tasks). Both lead to the same tab and show the number of overdue tasks.

**Copying from an email (D38):** right-click on a task in a note (shown or being edited) copies that task as Markdown, with its email in brackets. Anywhere in a note it copies the note under a heading `Note anchored to "the passage"` in email "Subject" - Sender, date. In the email itself, on the header button and in its popup it copies all notes, under the email as a heading, each under its own heading in reading order; plain highlights are left out. Links to emails become readable references, and headings inside a note move one level below the note's heading.

## Links between emails

Notes link to emails with plain Markdown links to the email's Message-ID as an RFC 2392 `mid:` URL, built since 0.19.0 (D37): `[Subject – Sender, 12 Oct 2026](mid:abc123@example.com)`. The label tells same-subject emails apart; the target survives moving and archiving and is the same in every account and on every device.

|  | How |
| --- | --- |
| Insert | Message list right-click → **Copy ThunderNotes link** (one per selected email), paste into a note. Or the link picker (D39): typing `[[` or `<<` (or Cmd/Ctrl+K, setting on by default) opens a search box at the cursor; this conversation and emails with notes first, then Thunderbird's search by subject or sender; Enter or a click inserts the link, a web address becomes a web link. Dragging an email into a note needs a spike. |
| Open | Click in a card (Ctrl/⌘+click in the editor) opens the email in whichever account and folder it is; a notice if it isn't on this device. |
| Backlinks | The toolbar list of an email shows **Linked from** (subject, sender, date, which note), each opening that email; the button's tooltip counts them. Across all accounts on the device, and on synced devices for IMAP accounts. |

Links point to single emails for now, not conversations.

## More ideas: Notion and beyond

Links between emails are built (see Links between emails above, D37). Still open: `[[` autocomplete, dragging an email into a note (after a spike), links to whole conversations. The older sketches below remain for reference.

**Referencing other emails (GitHub-style)**

- Canonical form in Markdown: a normal link with a `mid:` URI, `[Anna, 12 Oct: draft v3](mid:CAF3xQ9b1k@mail.example.com)`. Portable, standard (RFC 2392), and readable outside the add-on.
- Typing shortcut: `#` or `[[` opens an autocomplete over recent and searched emails (subject, sender, date); picking one inserts the link. Drag-and-drop an email from the list into the editor does the same.
- Short handles like `#a3f9` (hash prefix of the Message-ID) as a display alias, expanded to the full `mid:` link on save.
- Rendered as a chip (sender · subject · date); click opens the email; hover previews the first lines.
- **Backlinks:** each email shows "Referenced in" — the notes on other emails that link to it, like GitHub's "mentioned this issue".
- Bonus: reference a *highlight*, `mid:...#a1`, to jump straight to a passage.

**Notion integration**

- A Notion database "Email notes": one page per annotated email, properties `Subject`, `From`, `Date`, `Message-ID`, `Tags`, `Open tasks`, `Link` (`mid:` URI), page body = the notes converted to Notion blocks; tasks as to-do blocks or a related Tasks database.
- Not in the MVP. The goal is two-way sync, so notes can be edited, searched and referenced inside Notion; build it after IMAP sync has proven the conflict model.
- Run it in the native helper or a small sync service rather than in the add-on, so the Notion token is not stored in the browser profile. The Notion API is plain HTTPS, so either works.
- The same adapter interface fits Obsidian (already free via the folder), Logseq, Todoist or Jira.

**Further feature ideas**

- *Thread notes:* one note shared by a whole conversation, shown on every message in it.
- *Tags and saved views*, e.g. "all red highlights from clients this month".
- *Templates* for recurring note types (meeting follow-up, invoice check, decision log).
- *Export an email with its notes* to PDF or Markdown for handover or archiving (partly there: Print with Notes, which can save as PDF, and Copy all notes as Markdown).
- *Notes on attachments* (PDF page + text quote) as a later extension.
- *Note on compose:* see your notes on an email while replying to it, in a compose sidebar.
- *Optional AI assist:* summarise a long thread into the note, suggest tasks from the email text — strictly opt-in and local-first given the data is mail.

## Risks

The largest remaining risks are Thunderbird internals used by the Experiment and sync behaviour on servers other than Florian's own.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| The Experiment relies on internals (`ThreadPaneColumns`, Gloda indexing, `nsISubscribableServer`) | Column, search exclusion, prompt fetching, re-subscribing or Print with Notes break after a Thunderbird update | One small Experiment, checked on every ESR; the rest uses stable MailExtension APIs. Tested so far only on 158, not yet on the minimum, 153 ESR (D41) |
| Emails render differently (view mode, remote content, quoted text) | Highlights can't be placed | Normalised selectors, fuzzy and partial matching; orphans listed with a warning, never dropped (D21, D23) |
| The carrier folder is visible in Thunderbird and other clients | Users delete, rename or unsubscribe it | Clear name and notice; cover in Thunderbird; restored or re-subscribed with an explanation (D20, D27, D36) |
| Gmail shows every label in All Mail and web search | Carriers visible in Gmail | Accepted (D8); `messages.import` on Gmail still to be tested |
| Edits on two devices before they sync | Overwritten text | Three-way line merge; conflict boxes instead of silent loss (D32) |
| Sync fails without anyone noticing | Edits never reach other devices | Red post-it warning for ThunderNotes-specific problems, re-subscribing, sync log (D35, D36) |
| Thunderbird closes while a note is open | Typed text lost | Draft autosave (D34) |
| Native helper blocked on managed machines | No live Markdown folder | IndexedDB, IMAP sync and export work fully without it (D16) |
| Notes hold sensitive mail content | Exposure on the server | Notes stay on the user's own mail server; encryption optional later (D9); a Notion token would stay outside the browser profile (D11) |
| Numbered sub-lists starting above 1 | Other Markdown tools show them as text | Deliberate CommonMark departure, accepted (D28) |

## Status and roadmap

Phases 0, 2 and 4 are done, and most of phase 5 (0.41.0): local annotations, IMAP sync, tasks and links between emails work, and 0.40.0 is published; reminders, the helper and Notion are still ahead. `BACKLOG.md` in the repo tracks the items.

| Phase | Content | Status |
| --- | --- | --- |
| 0 Setup | Profile, test mailbox, monorepo, add-on ID, licence | Done |
| 1 Spikes | Anchoring across views (D21), carrier folder (D19), `messages.import` on own server, Experiment for search exclusion, lazy editor loading | Done, except `messages.import` on Gmail and the optional helper skeleton |
| 2 MVP: local annotations | Highlights, margin cards, live-preview editor, colours, folding, link popup, whole-email note, toolbar list, tag and column, export/import, printing with notes, lines to highlights | Done |
| 3 Live files + Notes space | Optional native helper: two-way Markdown folder with file watching, Git repository with debounced auto-commit (D6); Notes space tab with search | Not started |
| 4 IMAP sync | Carriers, revisions and tombstones, three-way merge with conflict boxes, folder restore and re-subscribe, restore of deletions, drafts, sync warning, settings carrier | Done; still open: test with two real Thunderbird installations, check the folder on phone, webmail and server |
| 5 Tasks, links, Notion | Dates and labels, task view with filters, grouping, sub-tasks and quick actions; links between emails with backlinks and a link picker; reminders; Notion two-way sync | Tasks and links done (D37–D40); reminders and Notion not started |
| Release | Package script, release checklist, public repository with one commit per release | Done: 0.40.0 published |
| Later: Outlook | Office.js task-pane add-in for Microsoft 365/Exchange, Graph storage in a hidden folder, highlights in the side panel (D15) | Not started |

**Next steps:** reminders for dated tasks (D38 stage 3); testing on Thunderbird 153 ESR (D41); then the whole sub-task tree in the task view, Gmail (D8) or phase 3.

## Decisions

The binding decisions in one line each, as of D36; `docs/DECISIONS.md` has the full text, dates and rejected options.

| Question | Decision | D |
| --- | --- | --- |
| Platform | Thunderbird MailExtension; one minimal Experiment where no API exists; optional native helper | D1, D14, D19 |
| Email identity | Message-ID; fingerprint fallback; `mid:` URIs for links | D2 |
| Anchoring | W3C TextQuote + TextPosition on the visible text of the current view; fuzzy match required; partial anchors; orphans never dropped, shown at the top with a warning | D3, D21, D23 |
| Note file granularity | One annotation set, file and carrier per email (threads change) | D4 |
| File format | Markdown per email; all machine data in YAML front matter; notes in `## “quote” <!-- tn:id -->` sections; same for export, carrier and Git folder; export adds `settings.json` | D5, D25 |
| Local versioning | Markdown folder is a Git repository, auto-committed by the helper | D6 |
| IMAP sync | Inside the add-on via Thunderbird's mail APIs; carriers with `X-Annot-*` headers and the Markdown file attached; update = new revision + delete old; delete = tombstone, 30 days | D7, D14 |
| Sync scope and folder | Per IMAP account, folder `ThunderNotes` at the root; local folders and POP stay local; Experiment makes Thunderbird check it promptly; carriers explained by a cover | D27 |
| Carrier folder | Subscribed and visible; kept out of global search by the Experiment | D19 |
| Servers | Own Postfix-based server first; Gmail supported with visible carriers | D8 |
| Encryption | Off by default; optional later; formats stay plain for possible sharing | D9 |
| Tasks (first idea) | Markdown checkboxes with `@due(...)`; replaced by D38 | D10 |
| Notion | Not in the MVP; eventually two-way, token outside the browser profile | D11 |
| Name and repositories | ThunderNotes; public `flofrie/thundernotes` (one commit per release), private `flofrie/thundernotes-dev` | D12 |
| Language | TypeScript monorepo: `core`, `thunderbird`, `helper`, later `outlook` | D13 |
| Outlook | Later: modern add-in for Microsoft 365/Exchange, notes via Graph; no IMAP accounts, no classic Outlook | D15 |
| Usability | Installs like any add-on: no separate login, software or setup for core features | D16 |
| Add-on ID | `thundernotes@webterminate.com`, never changes | D17 |
| Licence | MPL-2.0, header in every source file | D18 |
| Carrier folder lost | Deleted, renamed or moved: recreated from the local copy with a notice naming what happened and how to remove it for good; carriers deleted by hand re-uploaded | D20 |
| Note rendering | In the background (markdown-it subset + DOMPurify); display script stays small | D22 |
| Note cards | Word-style right margin aligned with highlights; email narrows, never covered; toggle and drag width; optional lines to the highlights; printing with notes | D23 |
| Highlight vs note | One concept: a highlight is a note with empty text; click to edit, leave to save, Esc discards | D24 |
| Message-list column | ThunderNotes icon column via the Experiment, reading only the `$annotated` keyword | D26 |
| Note editor | CodeMirror 6 live preview, loaded on demand; lists, Tab, numbered sub-lists from any number, renumbering, link shortcuts; textarea fallback | D28 |
| Colours | 8 named colours stored by name; white text on orange, red, purple, grey, else WCAG; whole-email note recolourable; last colour reused | D29 |
| Folding cards | Fold to the quote line; per device, optionally synced in a separate `folded` map | D30 |
| Highlighted links | Click shows destination, Add/Edit note and Open link; Cmd/Ctrl+click opens directly | D31 |
| Edits from two devices | Text, colour, tags decided separately; text merged three-way line by line; clashes become a conflict box with Keep this / Keep both; device name setting | D32 |
| Restore | Tombstones keep a copy; per email the toolbar list restores everything deleted in the last 30 days, or deletes those copies for good | D33 |
| Drafts | Text in an open editor autosaved locally, offered back after a crash | D34 |
| Sync warning | Only ThunderNotes-specific problems while the connection works, after 2 failures: red unhappy post-it, account in the tooltip, explanation in the toolbar list | D35 |
| Unsubscribed carrier folder | Subscribed again automatically, with a notice | D36 |
| Links between emails | Markdown links to `mid:` URLs, labelled subject – sender, date; open on click; Copy ThunderNotes link; backlinks; drawn as lozenges | D37 |
| Tasks | Every open checklist item is a task; optional @dates and #labels; task view with filters, grouping, sub-tasks, quick actions, copy as Markdown; reminders planned | D38 |
| Link picker | `[[`, `<<` or Cmd/Ctrl+K find emails to link to by subject, sender or date | D39 |
| Label colours and order | Colours and order of labels the same on all devices, in a settings carrier | D40 |
| Minimum Thunderbird | 153, the current ESR | D41 |
