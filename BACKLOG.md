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
- [ ] Test sync with two real Thunderbird installations on the same account
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

## Later — Outlook (D15)
- [ ] Office.js task-pane add-in for Microsoft 365/Exchange mailboxes
- [ ] Graph storage adapter (hidden folder, same carrier format)
- [ ] Panel-based highlights (quoted passages)
