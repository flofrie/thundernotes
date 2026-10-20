# Backlog

To be converted into GitHub issues and milestones.

## Phase 0 — Setup
- [x] Thunderbird `Development` profile
- [x] Test IMAP mailbox
- [x] Repository skeleton
- [x] Choose language: TypeScript monorepo (D13)
- [x] Choose add-on ID: `thundernotes@webterminate.com` (D17)
- [x] Licence: MPL-2.0 (D18)

## Phase 1 — Spikes
- [x] Highlight + re-anchor across plain-text, simple-HTML and original-HTML views: works; fuzzy match and partial anchors needed (D21)
- [x] Can a MailExtension read/write an unsubscribed IMAP folder? No: folder stays subscribed and visible (D19)
- [x] `messages.import` into a custom folder on own server
- [ ] `messages.import` into a custom folder on Gmail
- [x] Re-run spike step 6: `deletePermanently` skips Trash for carriers; `folders.delete` always goes to Trash
- [x] Minimal Experiment API: turn off "include in global search" for the carrier folder (D19); works, incl. already-indexed carriers and after restart
- [ ] Optional: can an Experiment hide a subscribed folder from the folder pane cleanly? (not required, D19)
- [ ] Native messaging helper skeleton incl. install on macOS (optional feature, D16)

## Phase 2 — MVP: local annotations
- [x] `core`: text extraction/normalisation, selectors and anchoring (position → quote → context → loose → fuzzy → partial/orphan, D21), unit tests from the spike's four test emails
- [x] Selection toolbar + context menu + shortcut (0.1.0; context menu inside the message pane to be confirmed)
- [x] Highlight rendering (`<mark>` overlay), partial highlights, remove
- [x] Margin cards (D23): right column, aligned with highlights, email narrows, collapsible
- [x] Markdown editor (textarea + helpers, D22) + renderer (markdown-it subset + DOMPurify, in the background)
- [x] Note cards: click to open, edit; highlights with a note are framed
- [x] CodeMirror live preview loaded on demand when editing starts (D28)
- [x] Task checkboxes clickable in a note's rendered view and in the editor
- [x] Stale `$Annotated` tags removed on display; backup reminder until IMAP sync
- [x] Folder pane: "Update ThunderNotes tags" per folder
- [x] Whole-email note (card pinned at the top of the margin)
- [x] (0.75.1) "Note on this email" in the toolbar popup always opens the note for editing: the message pane gets the focus once the popup has closed (it sometimes stayed elsewhere, so the card opened without its editor).
- [x] (0.75.2, D23) Emails that set a width on their root element (`<html style="width:100%">`) narrow for the notes too, instead of pushing the notes out of view.
- [ ] Keyboard shortcut while viewing an email: create the whole-email note (or open it, if it exists) and go straight into editing it. Candidate: Cmd/Ctrl+Shift+N with no text selected (with a selection it already highlights and opens a note). The display script's keydown only sees keys while the message pane has the focus; to work from the message list too, it needs a `commands` entry in the manifest, handled in the background and sent to the shown email. Show it in the options page's Keyboard shortcuts card.
- [x] Cards fold to their quote line (D30); per device, optionally synced
- [x] Highlighted links: click asks "note or link", Cmd/Ctrl+click opens; Add/Edit note in the right-click menu (D31)
- [x] IndexedDB annotation store
- [x] Count badge on the message display action
- [x] Toolbar popup listing the email's notes (incl. orphans); click jumps to the card
- [x] `$Annotated` tag (key `$annotated`; set with the first annotation, removed with the last)
- [x] Export/import (D25): zip of Markdown files from the options page; import merges, newer wins

## Phase 3 — Live files + Notes space
- [ ] Helper: two-way folder sync with file watching
- [ ] Helper: Git repo init + debounced auto-commit
- [ ] Notes space tab with full-text search (MiniSearch/FlexSearch)

## Phase 4 — IMAP sync
- [x] Carrier message writer/reader (core/carrier.ts)
- [x] Revision, tombstone and GC rules
- [x] Multi-device conflict merge per annotation id (tested with two simulated devices)
- [x] Filter carriers from all add-on views (cover on carriers, no highlighting)
- [x] Carrier folder deleted: recreate, re-upload from the local store, D20 notice
- [x] Carrier folder renamed or moved, single carriers deleted by hand (D20)
- [x] Edits of the same note on two devices combined line by line; clashes as a conflict box with Keep this / Keep both (D32)
- [x] (2026-10-18, #24) Test sync with two real Thunderbird installations on the same account (153 ESR, two Macs)
- [x] Restore deleted notes and highlights from the last 30 days, per email, from the toolbar list (D33)
- [x] Draft autosave while a note is being edited; restore or discard after a crash (D34)
- [x] Visible warning when sync isn't working: icon, tooltip, toolbar list (D35)
- [x] Carrier folder unsubscribed: subscribed again automatically, with a notice (D36)
- [ ] Check the carrier folder on other clients (phone, webmail) and on the server (deferred spike checklist C)

## Phase 5 — Tasks, links, Notion
- [x] Tasks per D38, stage 1: `@date` (stored as `@YYYY-MM-DD`, typed naturally, autocomplete), `#labels` (also in notes), lozenges on cards and in the editor
- [x] Task view tab: by due date (Overdue / Today / Next 7 days / Later / No date), label filter, open email, tick off (0.24.0)
- [x] Overdue count on the Tasks button (0.24.1)
- [ ] Reminders for dated tasks via alarms + notifications, snooze
- [x] `mid:` links between emails (open on click), "Copy ThunderNotes link" in the message list, backlinks in the toolbar list (D37)
- [x] Link picker: `[[`, `<<` or Cmd/Ctrl+K (setting), candidates by conversation, notes, recency (D39)
- [ ] Drag an email into a note (spike first)
- [x] Label colours, synced in a settings carrier (D40, 0.25.0)
- [x] Label order: most used, A–Z, Z–A or own (dragged), synced (D40, 0.28.0)
- [ ] Saved views in the task view (filter, grouping, order), if switching contexts is missed
- [x] Task view quick actions: due date (today, tomorrow, in a week, typed date word), remove date, add/remove label; with undo (0.29.0)
- [ ] Report to Thunderbird (bugzilla.mozilla.org, product Thunderbird): right-click on an email in the message list that isn't the shown one, choose "Print…": it prints the shown email, not the right-clicked one (other right-click actions use the right-clicked email via `mailContextMenu.setOverrideSelection`; cmd_print apparently doesn't). Then reconsider "Print with Notes" for such emails (show the email first, then print), see D23; for now they are hidden there.
- [x] Options page restructured (0.39.0): cards by area (highlights, writing notes, keyboard shortcuts, dates, task view, lines and printing, sync and devices, backup, developer), switches, live examples for highlights and dates, sync status per account with "Sync now". Later, when reminders add settings: a section list on the left, a search field.
- [x] Sub-tasks in the task view (0.38.0): "↳ part of …", "2/5" badge, a tree when grouped by email; the selected task's lines to its sub-tasks (accent) and parent (grey, own lane), edge markers for ends off screen; Esc or a click on empty space clears. No automatic ticking.
- [ ] Sub-task lines for the whole tree: selecting a task shows lines to its sub-tasks, from them to theirs, and so on. Several trunks side by side, the highest level leftmost (the selected task goes out furthest left, down, and in to each sub-task; each sub-task again out to its own), laid out so no lines overlap.
- [ ] When a third display setting shared by several parts comes up: one "apply display settings" function each part calls (now wired separately: hide current year, past due dates red)
- [ ] Notion two-way sync

- [x] (0.76.2) Settings page: the header's post-it in 3D (plain WebGL, no library): thickness, folded corner, light; sways, leans towards the pointer, blinks, flips on a click, and a right-click pokes it (0.76.3: briefly angry, red and frowning, instead of the page's long menu; 0.76.4: the anger grows and fades gradually, the menu blocked more firmly; 0.77.1: turns as far left and up as right and down, lit from the front); still with "reduce motion", the flat icon without WebGL.
- [x] (0.78.0, D26) A one-line preview of the whole-email note on cards (3 rows: the last line; 2 rows: between sender and date), full text on hover; setting, on by default. 0.78.3: a lozenge in the note's colour, ending in "…" when longer; 0.78.5: right-aligned, against the date (2 rows) or the icons (3 rows), never widening the list; 0.78.7: the subject's text size; 0.78.8: up to 75 % of the line's free room, measured.
- [x] (0.77.2, D26) The post-it on the message list's cards view too (cards show no custom columns): the Experiment adds it among each card's icons for emails with notes (0.77.3: read from the card's own tags, as the message list's values can be hidden from the Experiment).
- [x] (0.77.0, D47) Settings in a tab of their own: no frame in the Add-ons Manager (its browser menu and a sticking wheel came with it); right-click shows no menu, or only "Copy" with text selected. (0.76.4 had worked around the wheel inside the frame.)
- [x] (0.76.1, D23) Notes in the empty space beside the email's content (centred newsletter columns): the email narrowed only as far as needed; setting "Use empty space beside the email content for notes", on by default.
- [x] (0.76.0, D46) Highlights and notes on pictures: right-click a picture to highlight it or add a note; framed in its colour, found again by address, place and surrounding text; an optional `image` field in format 2.

### From the design review (public issue #1, 2026-10-18)
- [x] PR #7 follow-up: recover a first frame with a missing/malformed title as an unanchored note; test strict rejection, text/export preservation and the options-page merge/save/reimport path.
- [x] PR #7 review: repaired import sections become notes of their own (no merge can overwrite them); use the post-paste CodeMirror tree to preserve code examples during date conversion.
- [x] Markdown structure: use markdown-it block ranges and a shared render/extraction pipeline; source-mapped checkbox clicks without ordinal fallback (development #5).
- [x] Format 2: collision-free section boundaries independent of Markdown, no generated-fence stripping or legacy heuristics; round-trip and malformed-frame regressions (public #4).
- [x] (0.41.1) Sync: quarantine unreadable/unsupported carriers; never delete them in cleanup; remove old revisions only once the replacement is uploaded and recorded (confirmed loss path: `mergeRemote` marks a failed read as merged, `push` then deletes it). Tests: malformed attachment, newer format version, crash between upload and cleanup.
- [x] (0.41.2) Merge: equal times without a known base give a conflict box in sync mode (was "incoming wins", the import rule).
- [x] (0.46.4) Dev issues #1, #3, #4: a carrier not read for a connection problem isn't removed by cleanup; a label colour chosen in an email stays in its account; an import naming an account not in Thunderbird waits for it instead of going to another account.
- [x] (#15) Rendering: keep no-break-space blank-line padding inside active quote/list containers; verify continuation text and code mapping for lists, quotes and nesting (PR #6 discussion).
- [x] (#16) Performance: `tasksIn/taskAt`: 2 parses per note (one shared prepared parse for code and checklist lines), pinned by a parser-count test.
- [x] (0.48.0, D45) Merge spec: `docs/SYNC.md`, with scenarios as tests (3 devices, reordered carriers, reverts, missing base, equal times, editing while sync runs, equal-time colours). Fixed on the way: several bases per carrier, merging oldest first, combining a save with what arrived during editing, a deterministic colour tie-break.
- [x] (0.48.1, #14) Sync backstop: persist the exact local state and readable carrier known to represent it; a check uploads if either changes, including when another device replaces the carrier with the same `rev`.
- [x] (0.41.3) Deletions: compact deletion records (id + time, no text) kept for a year beyond the 30-day restore window, so a stale device can't resurrect deleted notes (limit: away over a year).
- [x] (0.42.0, D42) Identity/routing: notes per account (Message-ID + account), moves take notes along, removed accounts shown, label settings per account. Messages with an empty Message-ID aren't annotated; a fallback isn't planned (#26, accepted with its rare corner cases).
- [x] (2026-10-18) Docs: old time-reference sketch replaced by "Dates, not times"; `[[` picker shown as built; done grouping as built; "Where the notes live" (authoritative state, copies, undo without Git); compatibility rules and format-2 reference files (`packages/core/test/format-fixtures/`); D5, D6, D10 point to what refines them.
- [x] (#9, D9) Encrypted email disclosure: note text, quotes and context remain plain in the profile, exports and IMAP carriers; documented limitation, with no unreliable per-message warning or selector-less storage mode.
- [x] (#13) Draft 2020-12 schemas in `docs/schemas/` (front matter, settings.json, settings carrier), tested against reference files and generated output; documented version/conversion rules for future changes. Migration implementation and corner cases remain out of scope.
- [x] (0.48.6, #10) Anchoring: clearly better context or fuzzy score decides; overlapping fuzzy alignments count as one place; among equally good places the one clearly nearest the old position wins (next at least twice as far); about equally near or no position: unplaced, with the existing warning.
- [x] (#11) Tested-version register in `docs/RELEASE.md` (#25); minimum stays 153 ESR.
- [x] (2026-10-18, #24) 153 ESR tested by the owner on two physical computers (macOS), syncing on the same IMAP accounts: works; recorded in the register. Windows and Linux not yet tested.
- [x] (#12) Degraded behaviour when an Experiment function fails (search exclusion above all).
- [x] (2026-10-18) D15: classic Outlook left out as a scope choice; add-in support on non-Microsoft accounts checked against Microsoft's overview.

## Later — Outlook (D15)
- [ ] Office.js task-pane add-in for Microsoft 365/Exchange mailboxes
- [ ] Graph storage adapter (hidden folder, same carrier format)
- [ ] Panel-based highlights (quoted passages)
