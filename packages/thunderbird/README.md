# @thundernotes/thunderbird

The Thunderbird MailExtension: highlighting, editor, views, IMAP sync through Thunderbird's mail APIs (D14).

Add-on ID: `thundernotes@webterminate.com` (D17). Never change it.

## Build and load

```sh
npm install          # once, at the repo root
npm run build -w @thundernotes/thunderbird
# or, while developing: npm run watch -w @thundernotes/thunderbird
```

Then in Thunderbird: Debug Add-ons → Load Temporary Add-on… → `packages/thunderbird/manifest.json`. After a rebuild, click **Reload** there and re-open the message.

## Layout

- `src/background.ts`: event page. Registers the message display script, owns the IndexedDB store (`src/store.ts`), sets the message display action badge.
- `src/content.ts`: message display script. Uses `@thundernotes/core` anchoring (D21) to draw highlights and create new ones.
- `src/options.ts` + `options.html`: options page with export/import.
- `src/popup.ts` + `popup.html`: the header button's popup listing the email's notes.
- `src/tags.ts`: the `$Annotated` tag.
- `src/backup.ts`: last export date and the reminder rule.
- `src/sync.ts`: IMAP sync (D27); `test/sync.test.ts` runs it between two simulated devices.
- `src/result.ts` + `result.html`: result window of "Update ThunderNotes tags".
- `experiments/thundernotes/`: the only privileged code (D19, D26): the message-list column and the global-search exclusion for the future carrier folder. Plain JS, not bundled.
- `src/margin.ts`, `src/card.ts`: the margin column (D23) and one note card.
- `src/live/editor.ts`: the live-preview editor (D28), built separately as `dist/live-editor.js` (web-accessible) and loaded by `src/live-loader.ts`; `test/live-editor.test.ts`.
- `src/edit-menu.ts`: the editors' right-click menu; `src/editor.ts`: textarea fallback helpers (D22).
- `src/protocol.ts`: messages between the two.
- `src/messenger.d.ts`: minimal types for the Thunderbird MV3 APIs used.
- `content.css`: highlight styles, injected with the display script.
- `build.mjs`: esbuild bundling into `dist/` (not committed).

## What works (0.11.0)

- Select text in a message → a small bar of colour dots below the selection (with the post-it icon): click a colour to highlight. Ctrl/Cmd+Shift+H highlights in the ringed colour, Ctrl/Cmd+Shift+N also opens the note; context menu **Highlight** works too.
- A highlight is a note with empty text (D24). Click a highlight → its card opens in the margin in edit mode; click a note's text to edit it again. Leaving the card saves; Esc discards this session's changes; Ctrl/Cmd+Enter saves and stops editing. A note left empty stays a plain highlight. Highlights with a note are framed.
- Editing (D28): Obsidian-style live preview. Markdown shows formatted (bold, italic, ~~strikethrough~~, code, headings, bullets, task checkboxes, links, quotes, rules); its markup appears only on the line with the cursor. The editor (slim CodeMirror 6, ~300 KB) loads only when you click into a note, and the cursor lands where you clicked. Enter continues lists, Tab/Shift+Tab indent, Ctrl/Cmd+B/I, Ctrl/Cmd+Shift+X (strikethrough), checkboxes: Cmd/Ctrl+L cycles text → `- [ ]` → `- [x]` (Obsidian), Cmd/Ctrl+Shift+L turns lines into a checklist and back (Apple Notes), `[]` + space at a line start becomes `- [ ] ` (Notion), paste a URL over selected text to link it, click a checkbox to tick it, Ctrl/Cmd+click opens a link. Right-click: Cut / Copy / Paste / Select All (our own menu: Thunderbird's message-pane menu has no Paste). If the editor can't load, the text box with preview (D22) takes over.
- Task checkboxes can also be ticked in a note's rendered view, without editing.
- Margin (D23): cards on the right, each at the height of its highlight; the email narrows to make room while it has notes. Hovering a highlight or card emphasises the other. **Hide notes** (top right) gives the email its full width back. Drag the left edge of any card to change the width of the notes (180 px to 60 % of the pane, remembered); double-click the edge for the automatic width again.
- Popup (click the ThunderNotes button in the message header): the note on the whole email and all highlights in reading order, with the start of each note; highlights not found in this view are listed and marked. Clicking an entry scrolls to it and opens its card to read (focus stays outside the email after the popup closes); one click into the note starts editing. **Add a note on the whole email…** opens an empty card pinned at the top of the margin; it disappears again if nothing is written.
- Notes whose highlight isn't found in the current view still get a card, at the bottom of the margin, marked "Not found in this view"; partly found ones say "Partly shown in this view".
- Colours (D29): 8 colours (yellow, green, blue, pink, orange, red, purple, grey); highlight and card share the colour, text is black or white by WCAG contrast. Choose via the colour bar after selecting text, the colour dot on a card, the colour row in the right-click menus, **Colour** in Thunderbird's menu on a highlight, or Cmd+Option+1…8 (Ctrl+Alt+1…8) for a selection or the active card. New highlights take the last colour (setting; off = yellow). Text in highlights adjusts for contrast (setting, on by default).
- Removing: the bin at the top right of a card deletes the note and its highlight; right-click a highlight in the email → **Remove highlight** / **Delete note and highlight** (Thunderbird's menu).
- Right-click a note card: it becomes active and our menu opens: **Edit note**, **Copy** (selected text), **Delete note…**; while editing: Cut / Copy / Paste / Select All and **Delete note…**.
- Message list column **ThunderNotes**: the post-it icon on every email with highlights or notes; sortable. On first start it is switched on in every folder, right after the attachment column (one-time; pref `extensions.thundernotes.columnPlaced`); hide or move it via the column picker as usual. Provided by the add-on's Experiment API (D26), based on the `$annotated` tag.
- Emails with highlights or notes get the tag **Annotated** (`$annotated`, an IMAP keyword on the server), set when the first one is added and removed with the last; usable in the quick filter, saved searches and the tag column. Opening an email never sets the tag, so removing it by hand sticks; it does remove a stale tag from an email ThunderNotes has nothing for (e.g. after the add-on was removed, which deletes its database).
- Folder pane: right-click one or more folders → **Update ThunderNotes tags** sets the Annotated tag on exactly the emails ThunderNotes has highlights or notes for, and removes stale ones; a small window reports the result. Subfolders are not included.
- IMAP sync (D27): notes on emails in an IMAP account are kept as carrier messages in that account's `ThunderNotes` folder (created on first use, excluded from global search, checked for new messages like the Inbox). Changes are sent about 2 s later; other devices' changes arrive at startup, every 10 minutes and whenever Thunderbird sees new messages in the folder, then merge per note (deletions travel as tombstones, kept 30 days). Emails in local folders or POP accounts stay local. Opening a carrier shows a cover explaining it; it can be dismissed. Deleting the folder makes ThunderNotes restore it and say so (D20).
- Options page → **Settings**: "Show editing hints in notes" (the grey line under a note while editing; on by default); "Use last highlight colour for new highlights" (on; off = yellow); "Adjust text colour in highlights for contrast" (on); "Cmd/Ctrl+L turns a ticked checkbox back into text" (off by default: Cmd/Ctrl+L then only ticks and unticks).
- Backup reminder: until IMAP sync, the add-on's database is the only copy of the notes and removing the add-on deletes it. The popup warns when notes changed since the last export and that export is over 7 days old (or there was none); the options page shows the last export date.
- Export / import (D25): Add-ons Manager → ThunderNotes → Options, or right-click the ThunderNotes button → **Export / import notes…**. Export downloads a zip of Markdown files (`YYYY/MM/YYYY-MM-DD_subject_hash.md`); import takes that zip or single `.md` files, merges by note (newer wins) and tags the emails it finds. Open emails redraw with the imported notes.
- Highlights are stored per Message-ID and re-anchored whenever the message is shown, in any body view. Partly found highlights get a dashed underline.
- The ThunderNotes button in the message header shows just the icon. With notes (highlights with text, plus the whole-email note), its badge shows their number; with only plain highlights, a red dot; with neither, nothing. The tooltip spells out the counts and how many are partly shown or not found in this view.

## Debug: match types

Right-click the ThunderNotes button in the message header → **Show match types (debug)**. Highlights are then coloured by how they were found in the current view (D21), and their tooltip names the match type and details:

| Colour | Match type | Meaning |
|---|---|---|
| yellow | position | Same text at the same offset (also every new highlight) |
| green | quote | Exact text found once elsewhere |
| blue | context | Exact text found several times; prefix/suffix picked one |
| orange | loose | Same letters and digits, punctuation/spacing/case differ |
| purple | fuzzy | Approximate match (a few characters changed) |
| red | partial | Only part of the text is in this view |

## Permissions

Besides the permissions below, the add-on contains an Experiment API (privileged code, reviewed separately on addons.thunderbird.net); see D19 and D26.


| Permission | Why |
|---|---|
| `messagesRead` | Read the displayed message's Message-ID, subject and folder; register the display script |
| `accountsRead` | Folder pane action "Update ThunderNotes tags": list the messages of the right-clicked folders |
| `messagesUpdate` | Set and remove the `$Annotated` tag on emails with highlights or notes |
| `messagesTags`, `messagesTagsList` | Create the "Annotated" tag definition if it's missing |
| `scripting` | Inject the display script into displayed messages |
| `menus` | Right-click items (Highlight, Remove highlight/note, debug toggle) |
| `storage` | Settings (margin hidden, debug colours) |
| `accountsFolders` | Create the `ThunderNotes` carrier folder (D27) |
| `messagesImport` | Write carrier messages |
| `messagesDelete` | Remove a carrier's previous revision permanently |
| `alarms` | Check for notes from other devices every 10 minutes |
| `clipboardRead`, `clipboardWrite` | Paste / Cut / Copy in the note editor's right-click menu. Install dialog: "Get data from the clipboard" |
