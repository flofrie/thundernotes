# Decision log

One entry per decision, newest last. Status: accepted | superseded.

## D1 — Platform: Thunderbird MailExtension + native helper (2026-10-13, partly superseded by D14)
Message display scripts render highlights and margin notes; the background script owns the store.

A native messaging helper handles file I/O, folder watching and Git. Avoid Experiment APIs unless a spike proves a gap.

**Note (2026-10-16):** "avoid Experiment APIs" turned into "one small Experiment" (D19, D26):
- search exclusion,
- the message-list column,
- prompt folder fetching,
- expunging old carriers (D7, D27),
- the device name (D32),
- re-subscribing the carrier folder (D36)
- and focusing the message pane (D37).

## D2 — Email identity = Message-ID (2026-10-13, accepted)
Folder/UID is never a key.

- Fallback fingerprint hash(Date+From+Subject+first 1 KB) when Message-ID is missing.
- Links use `mid:` URIs (RFC 2392).

**Implemented limit (dev issue #8):** Thunderbird's `MessageHeader.headerMessageId` is used as the key. If it is empty, ThunderNotes refuses to load or save annotations rather than colliding every such message under an empty key. The proposed fingerprint is not implemented: the MailExtension API documentation does not specify what it returns when the header is absent, and cross-device stability (including IMAP and local/POP messages) has not been verified on Thunderbird 153/158. If Thunderbird supplies a non-empty generated value, ThunderNotes currently treats that API value as the identity; that behavior also needs empirical verification. See `docs/SYNC.md` §1.

**Accepted as is (2026-10-18, development issue #26, closed as not planned):** refusing to annotate a message with an empty Message-ID is the accepted behaviour. Thunderbird probably invents a Message-ID for messages without one; whether that value stays the same (across restarts, copies and computers) is not verified. So there may be corner cases where messages without a real Message-ID get the same notes, or a note doesn't find its message on another computer. This is a known potential issue, low priority, and won't be fixed: such messages are rare. The fingerprint fallback above is not planned.

## D3 — Anchoring = W3C Web Annotation selectors (2026-10-13, accepted; refined by D21)
TextQuoteSelector (exact + prefix/suffix) + TextPositionSelector on normalised text.

- fuzzy fallback;
- unmatched annotations become orphans, never dropped.

## D4 — One annotation set / one file per email (2026-10-13, accepted)
Not per thread, because threads change.

## D5 — Local format: Markdown + YAML front matter (2026-10-13, accepted; refined by D25)
Path `YYYY/MM/YYYY-MM-DD_subject-slug_<hash8>.md`.

Canonical store; everything else is a sync target or a rebuildable cache.

**Refined (2026-10-18, design review, public issue #1):** without the helper there are no files to rebuild from. Markdown is the canonical *interchange* format (export, carriers, the future folder); the authoritative state on each computer is the add-on's IndexedDB in the Thunderbird profile. Copies: the IMAP `ThunderNotes` folder (IMAP accounts only, D27), export zips, later the helper's folder. Notes in Local Folders and POP accounts have no copy but an export. The concept's "Where the notes live" lists what each copy restores and what can be undone without Git.

## D6 — Local notes folder is a Git repository (2026-10-13, accepted)
The helper auto-commits (debounced) on every change from either side.

- Gives history and undo, so conflict handling stays simple (rev/updated wins, Git as safety net). *Superseded for conflicts (2026-10-18):* merging is D32 (line-by-line, conflict boxes) and D33 (deletion records), the same with or without the helper; Git adds history, not correctness.
- Git is not the cross-device sync channel in the MVP; IMAP is.
- Optional push to a private remote as backup or a future sharing path.

## D7 — IMAP sync via carrier messages in a dedicated unsubscribed folder (2026-10-13, partly superseded by D19: folder stays subscribed; D27: folder named `ThunderNotes`, per account)
Headers `X-Annot-Version/Ref/Rev/Updated/Client`; body = text/plain notice + the Markdown file as a text/markdown attachment; always `\Seen`.

- Update = APPEND new revision + expunge old;
- delete = tombstone (GC after 30 days).
- All clients logged into the same IMAP account see the same notes.
- The `$annotated` keyword marks annotated originals.

## D8 — Gmail: accept visible, clearly named `[annot]` carriers (2026-10-13, accepted)
Primary target is the user's own Postfix-based mail server.

**Note (2026-10-16):** carriers are named `[ThunderNotes] <email subject>` since D27, on Gmail too; `[annot]` was the earlier working name.

## D9 — No encryption by default (2026-10-13, accepted)
Optional later; sharing notes may become a requirement, so formats stay plain.

**Clarified 2026-10-18 (development issue #9):** ThunderNotes does not inherit an email's S/MIME
or OpenPGP protection. A highlight stores its exact quote and nearby prefix/suffix, so annotating an
encrypted email copies decrypted content into the local database, exports and, for an IMAP email,
a plain-text carrier on the mail server. Note text is plain there too.

For now this is an explicit, documented limitation rather than a per-message warning or a second
storage mode. ThunderNotes does not try to detect encrypted messages. A warning would not protect
the stored data, omitting selectors would break anchoring, and local-only notes would silently give
up the normal sync guarantee. Users who must keep the decrypted content within the original
cryptographic envelope should not annotate that email. Optional encryption can still be designed
later, but must cover notes and selectors together.

## D10 — Tasks = Markdown checkboxes with `@due(...)` (2026-10-13, superseded by D38)
Absolute dates are the core case; relative (`+2d`, natural language, normalised on save) and email-derived dates are extras.

**Superseded by D38:** due dates are `@YYYY-MM-DD` (date words are converted when typed), without `@due(...)`, chrono-node or a time of day. Whether reminders bring times is decided with D38 stage 3.

## D11 — Notion: post-MVP, eventually two-way (2026-10-13, accepted)
Runs in the helper or a sync service; the Notion token stays outside the browser profile.

## D12 — Project name and repository (2026-10-15, accepted)
Working name **ThunderNotes**; private GitHub repository `flofrie/thundernotes`.

## D13 — TypeScript monorepo (2026-10-15, accepted)
Packages:
- `core` (data model, anchoring, Markdown/YAML, task parsing, merge rules; no client-specific code),
- `thunderbird` (MailExtension),
- `helper` (optional native messaging host),
- later `outlook`.

One language everywhere so the core is shared.

## D14 — Each client syncs through its platform's own mail API; helper is optional (2026-10-15, accepted; fallback chosen in D19)
The Thunderbird add-in does IMAP sync itself through Thunderbird's mail APIs (`messages`, `folders`), using the accounts already configured in Thunderbird: no separate credentials, OAuth handled by Thunderbird.

The native helper is optional and limited to the local Markdown folder + Git.

Fallbacks if the hidden-folder spike fails:
- (1) folder stays subscribed but excluded from search,
- (2) small Experiment API to hide it,
- (3) IMAP in the helper.

## D15 — Outlook: modern add-in for Microsoft 365/Exchange mailboxes, deferred (2026-10-15, accepted)
Office.js task-pane add-in (new Outlook for Windows, Mac, web, mobile); highlights live in the side panel because add-ins cannot draw on the message.

Storage via Microsoft Graph in a hidden mail folder using the same carrier format; no helper.

Not supported:
- Outlook with IMAP accounts (Microsoft does not load add-ins there),
- classic Outlook (COM),
- Mac-only routes,
- a separate companion app.

**Corrected (2026-10-18, design review, public issue #1):** classic Outlook on Windows runs Office.js add-ins too, so leaving it out is a scope choice (one client to build and test first), not a technical limit. Add-ins don't run on non-Microsoft accounts (IMAP, Gmail) in any Outlook except Outlook for Mac with an IMAP CloudCache account ([Microsoft: Outlook add-ins overview](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/outlook-add-ins-overview), checked 2026-10-18). Before building: which Graph APIs and sign-in the adapter needs, per account type.

Built after the Thunderbird MVP.

## D16 — Usability principle: zero extra setup (2026-10-15, accepted)
Usability is a top-tier requirement.

Installing ThunderNotes must feel like installing any other add-on:
- no separate login,
- no extra software,
- no manual configuration for the core features.

Anything that needs more (native helper for Markdown files + Git) is an opt-in power feature, and the core experience must be complete without it.

## D17 — Add-on ID: `thundernotes@webterminate.com` (2026-10-15, accepted)
Email-style ID on a domain the author controls, so it is unique.

It is permanent: Thunderbird ties updates and the add-on's local storage to it, so it must never change.

## D18 — Licence: MPL-2.0 (2026-10-15, accepted)
File-level copyleft: changes to project files stay open when distributed; combining with separately licensed files is allowed.

- Same licence as Thunderbird.
- Every source file carries the MPL header.
- If outside contributions arrive and relicensing should stay possible, introduce a contributor agreement first.

## D19 — Carrier folder stays subscribed and visible; excluded from global search via a minimal Experiment API (2026-10-15, accepted; Experiment widened by D26)
**Decision:** `Annotations` stays subscribed and visible in the folder pane, like the Gmail case (D8); a visible "where my notes live" folder is acceptable.

### Spike finding
Spike `spikes/imap-folder` (TB 157, own server): MailExtension APIs only see folders Thunderbird is subscribed to. After unsubscribing, `Annotations` disappears from the add-on as well (not found by name or id; list and import fail), in the same session and after a restart. So the hidden, unsubscribed folder of D7 is not possible with standard APIs.

### Search exclusion
Carriers must not show up in global search, though: Thunderbird has a per-folder "include in global search" option (Folder Properties, on by default) that the MailExtension API cannot set, so a minimal Experiment API turns it off for the carrier folder.

- That is the only privileged code; it must stay small and be checked on every Thunderbird release.
- Hiding the folder from the folder pane is not pursued now (possible later experiment, the product must not depend on it).
- IMAP in the helper is rejected (D16).
- Confirmed by the spike's Experiment (`Gloda.setFolderIndexingPriority(folder, kIndexingNeverPriority)`, same call as the checkbox): works in MV3, removes already-indexed carriers, keeps new ones out, survives restart.

### Consequences
- the add-on filters carriers out of its own `messages.query` results;
- quick filter inside the folder still finds carriers (acceptable).

Other spike findings:
- `folders.create` subscribes the new folder;
- `messages.import` rejects a Message-ID already in the folder, so every revision gets a fresh Message-ID;
- `getFull` returns no `body` for the `text/markdown` attachment part, read it with `messages.getAttachmentFile`;
- unsubscribing removes the folder from the global search index.

## D20 — Restoring a deleted carrier folder is announced, with the way out (2026-10-15, accepted)
If the user deletes, moves or renames the carrier folder or carriers, the add-on recreates them from its local copy and says so clearly: a notification explains that ThunderNotes keeps its notes in this folder and has restored it, and that to get rid of it for good the user should uninstall the add-on first and then delete the folder (otherwise it comes back).

No silent recreation, so nobody fights the add-on without knowing why.

**Extended 2026-10-16 to renames and moves:** the add-on looks for its folder by name at the top of the account, so a renamed or moved folder counts as missing and is recreated the same way.

To word the notice right, it looks up the carriers it knew by Message-ID:
- found in another folder → "renamed or moved, now X; X is no longer used and can be deleted";
- found in the trash → "deleted";
- not found (changed on another device, in webmail or on the server, in a folder Thunderbird hasn't seen) → "deleted, renamed or moved".

Further rules:
- Renames and moves made in this Thunderbird trigger the check at once; elsewhere the next regular check finds it.
- A carrier deleted by hand is re-uploaded silently on the next check, from any device that still has the notes.
- A restored folder is set up again like a new one (excluded from global search, D19; checked for new messages, D27); the setup also runs once per session for an existing folder, which repairs the settings if they were changed by hand.

## D21 — Anchoring: visible text of the current view, fuzzy match required, partial anchors (2026-10-15, accepted)
Refines D3 after the spike `spikes/highlight-anchor` (TB 157, four test emails, all three body views).

### Normalised visible text
Selectors are made and matched against the normalised visible text of the view currently shown:
- whitespace and block boundaries → one space,
- `>` quote markers at line start,
- soft hyphen and zero-width characters dropped,
- invisible elements skipped,
- bracketed URLs like `<https://…>` dropped because Plain view prints links as `text <url>`.

### Matching order
Matching order: position → exact quote → quote + prefix/suffix context → loose (letters and digits, case-insensitive) → fuzzy → partial → orphan.

Offsets are JavaScript string offsets (UTF-16 code units), because the same offsets are applied to DOM text nodes and the stored normalised text. A still-valid position is sufficient. A unique exact quote is sufficient. If an exact or loose quote occurs more than once, a candidate with at least 8 matching context characters across prefix and suffix that beats the next by at least 4 wins; among candidates whose context is about as good, the one clearly nearest the old position wins (see below). Fuzzy alignments whose text ranges overlap are grouped as one candidate location before the confidence check; each location is represented by its highest-scoring alignment. Across distinct locations, a fuzzy candidate with a score of at least 60/92 and a lead of at least 6 over the next wins; among about equally good ones, the clearly nearest to the old position. Scores weight quote similarity 50, prefix and suffix agreement 20 each, and old-position proximity at most 2. Below these thresholds the annotation remains an orphan in the note list, rather than being placed at a merely plausible passage. The card's existing “can't be found at the moment” warning is also used for ambiguous matches; no new repair action is introduced.

- Fuzzy uses `approx-string-match` (Myers' algorithm, MIT, as in Hypothesis), not diff-match-patch, whose matcher is limited to 32-character patterns.
- The fuzzy step is required, not optional: Plain view rewrites HTML (`*` bullets, `/emphasis/`, links as `text <url>`), and changed wording defeats exact and loose matching.
- Low-confidence repeated/fuzzy matches are left unplaced. Regression tests cover repeated quotes with and without distinguishing context, UTF-16 offsets after a supplementary Unicode character, and the existing Original/Simple/Plain and long-message fixtures.

Follow-up (2026-10-18, 0.48.6, development issue #10): fuzzy alignments with overlapping ranges represent one physical passage, not competing candidate locations. Confidence thresholds compare distinct locations, so a quote at the start of a message can anchor despite multiple equally good overlapping alignments, while two plausible locations remain orphaned. Tests cover both cases.

**Nearness as a guarded tie-break (2026-10-18, 0.48.6, issue #10; owner's decision).** Among equally good candidates (repeated exact or loose quotes whose context is about as good, or fuzzy locations within the score margin), the one nearest the old stored position wins if the next one is at least twice as far; otherwise, or when no position is stored, the note stays unplaced. A view change (Original, Simple, Plain) shifts text only a little, so the nearest copy is usually the one the note was made on: in 180 generated cases with a duplicated passage, nearness chose the original copy every time, while dropping it left all 180 unplaced. Two copies about as near still count as a real coin flip and stay unplaced. Considered: no nearness at all (strict, but notes on repeated text such as quoted replies and signatures would vanish after every view switch); nearness without a guard (the old behaviour, which guesses even between equally near copies).

### Partial anchors and orphans
Text that exists in only one view (Simple view shows `display:none` content, Original hides it) anchors partially: the surviving part is highlighted and the annotation is marked "partly shown"; with no match at all it stays an orphan in the email's note list, never dropped.

### Rejected and follow-up
- Anchoring against the raw MIME source was rejected: the highlight must be found in the displayed text anyway, so it only adds a mapping step.
- The spike's extraction and normalisation move to `core` with unit tests built from the four test emails.

## D22 — Note editor: textarea with Markdown helpers; rendering in the background (2026-10-15, editor superseded by D28; background rendering stays)
Chosen: a plain `<textarea>` with small helpers (Enter continues lists, Tab indents, Ctrl/Cmd+B/I, paste a URL over a selection to link it, Ctrl/Cmd+Enter saves, Esc cancels) and a live rendered preview.

### Why
Notes are edited in cards inside the displayed email, so the editor's code is part of the script injected into every displayed message.

Measured: CodeMirror 6 with Markdown support ≈ 500 KB minified, markdown-it + DOMPurify ≈ 130 KB, against 23 KB for the whole display script.

### Rendering
- Rendering (markdown-it subset + linkify + DOMPurify, only http(s)/mailto links) runs in the background; the card receives sanitised HTML.
- Tasks render as ☐/☑, not form controls.
- Links in cards open in the default browser via `windows.openDefaultBrowser`.

### Upgrade path and rejected options
Upgrade path if the textarea feels too bare: CodeMirror injected only when editing starts; stored notes don't change.

Rejected:
- CodeMirror always loaded (cost on every email),
- editing in a separate window (loses context),
- WYSIWYG editors (heavier, Markdown round-trips can rewrite notes).

## D23 — Notes in a Word-style margin, never over the email text (2026-10-15, accepted)
Note cards sit in a column on the right of the message pane, each at the height of its highlight; overlapping cards are pushed apart, the active card stays level with its text.

### Width and layout
- While an email has notes, the email is narrowed to make room (padding on the root element, 30 % of the pane, 200–320 px); emails without notes keep their full width.
- Fixed-width emails wider than the remaining space get the column after their content (the pane scrolls sideways) rather than under it.
- A toggle hides the column and restores the full width; the choice is remembered.
- The width can be dragged at any card's left edge (180 px to 60 % of the pane, remembered for all emails; double-click returns to automatic).
- Hovering a highlight or card emphasises the other.
- Replaces the pop-over card of 0.2.0.

### Opening cards
- A card opened from its highlight or the popup that isn't fully on screen is scrolled into view (whole card if it fits, else its top), even if the highlight then leaves the view (2026-10-16).
- A note chosen in the toolbar list goes to its card and stays there; the card is in edit mode only when the email has the keyboard focus (seen in use: usually not right after the list closes, which is fine).

### Orphans (2026-10-16)
Notes whose passage can't be found (orphans, D21) sit right after the whole-email note, before the anchored cards, with a warning line: "This note belongs to a passage of this email that can't be found at the moment" (tooltip: it may show in another view; if it keeps happening, tell the author); no repair tool (2026-10-16).

### Header button's right-click menu (2026-10-18, 0.36.4)
Header button's right-click menu (2026-10-18, 0.36.4):
- "Copy all notes as Markdown" (only for an email with notes, 0.37.0).
- "Show match types (debug)" only with the setting "Show developer functions" (Developer section of the options page, off by default; switched off, the match types are switched off too).
- "Export / import notes…" removed (the popup links to it).

Thunderbird adds "Manage Extension" and "Remove Extension" there itself: a good central place, kept.

### Printing (2026-10-18)
**Printing (2026-10-18):** an email prints as without ThunderNotes (no notes column, no highlights, full width).

- "Print with Notes…" and "Print with Notes, All Expanded…" right after "Print…" in Thunderbird's File menu and in the right-click menus of the message list and the shown email print it with them, for that one print (added by the Experiment: add-ons can put items only into their own right-click submenu and nowhere into the File menu; not in the print dialog itself, whose inside isn't meant for add-ons and changes between versions; without "Print…" in a menu the items go to its end).
- They open Thunderbird's own print dialog for the shown email, active only when it has notes.
- Right-clicking an email in the list that isn't the one shown (Thunderbird's menu then acts on that one) doesn't offer them, as they can only print the shown email (0.37.1).
- All expanded, the cards are really unfolded and laid out anew for the print (else they overlapped), then folded again; nothing saved.

### Lines from cards to their highlights (2026-10-18, 0.34.0; straight since 0.35.0)
**Lines from cards to their highlights (2026-10-18, 0.34.0; straight since 0.35.0):** a straight line like a stroke of a slightly translucent felt-tip pen (4 px, round ends, the highlight's darker shade at 30 %, the active note's at 50 %) from the middle of the card's left edge to the middle of the underlined passage (halfway along its underline, over several lines too; the stroke's round end flush with the passage's lower edge, 0.35.6), across the text if need be (`connectors.ts`).

- A line goes to where its card is being placed, not where it is at that moment (cards slide there; measured at once, lines went to a card's place before another unfolded, 0.35.1).
- In print the email's header (Thunderbird's `.moz-main-header`, in the page but shown only in print) moves the email down; how far it moves the email's text (measured on a highlight: the first paragraph's top margin stops merging with the page's below the header, so the text moves about half a line more than the header is tall; an empty marker missed that, 0.35.5) is measured when printing with notes starts and the notes and lines move down with it (0.35.2).
- Thunderbird lays an email's lines out slightly differently on paper than on screen (line heights rounded to whole screen pixels), so positions taken on screen drift from the text the further down a long email; in print each line therefore starts from a marker inside its highlight and moves with the text, what is left of the drift landing at the card's end (0.35.7; the header shift still places the cards).
- When printing, each line is drawn as a stack of 12 px bands of its own, so lines show on every page the notes run onto (one drawing overflowing its box printed only on its first page); the "Hide notes" button isn't printed (0.35.3).
- Printing with notes prints them also while they are hidden with "Hide notes" (shown for the print, then hidden again; 0.35.4).
- Right-angled lines as in Word, in lanes in a wider gap, with steps for passages ending on one line, came first (0.34.0–0.34.1): hard to follow by eye.
- Only highlights with a note (not the whole-email note, not passages not found).

Two independent settings:
- "Show lines from notes to their highlights" (on screen, off by default: the margin is calm without them).
- "Show those lines when printing with notes" (on by default: on paper nothing points at what belongs together).

## D24 — One concept: a highlight is a note with empty text; click to edit, leave to save (2026-10-15, accepted)
The UI doesn't separate highlights from notes.

### Creating and editing
- Selecting text offers one **Highlight** button (since D29 a bar of colour dots instead; Ctrl/Cmd+Shift+H; Ctrl/Cmd+Shift+N highlights and opens the note).
- Clicking a highlight opens its card in the margin straight in edit mode; clicking a note's text edits it too (links still open in the browser).
- Leaving the card saves automatically (clicking elsewhere, switching message or window).
- Esc discards only the changes of the current editing session.
- Ctrl/Cmd+Enter saves and stops editing.
- A note left empty is a plain highlight and leaves the margin; highlights with a note are framed.
- No Edit/Save/Cancel buttons.

### Removing
Removing: 🗑 at the top right of a card deletes the note and its highlight (as deleting a Word comment does); right-click offers **Remove highlight** on a plain highlight and **Remove note** (same effect) on one with a note.

Plain highlights don't open an editor by default, so marking text doesn't make the email narrow and widen again.

### Switching apps (2026-10-16)
Switching to another app (or to Thunderbird's own panes) is not leaving the card: editing goes on, with the cursor where it was, as in other programs; switching message still saves, and a crash meanwhile is covered by the draft (D34) (2026-10-16).

**How (found with diagnostics, 2026-10-16):**
- When the message loses the focus, the open editor gives it up but stays open; coming back, it takes it again.
- A click into the editor while the message isn't focused (e.g. right after "Copy ThunderNotes link" in the message list) is left to the browser so the message pane gets focused (the editor's own mouse handling blocks that, and `window.focus()` is ignored there), then the cursor goes where the click was.
- Such a first click also arrives without its shadow-DOM path and is recognised as the card's by position.

### Esc refined (2026-10-17)
**Esc refined (2026-10-17):**
- With changes since editing began, the first Esc only shows "Press Esc again to discard your changes to this note" as a small framed message floating at the cursor (also in long notes and with hints switched off).
- A second Esc within 3 s discards; typing on or waiting keeps editing.
- Without changes one Esc leaves.
- Esc in a suggestion list or the link picker only closes that.

## D25 — File format: Markdown body, all machine data in YAML front matter (2026-10-15, accepted)
Refines D5. One `.md` file per email.

### Front matter
The front matter holds the email reference (`message_id`, subject, from, date, folder hint), `created`/`updated`/`rev`, a format version (`thundernotes: 2`) and, per annotation, `id`, `quote`, `prefix`, `suffix`, `position: [start, end]`, timestamps (later colour, tags; since D30 an optional `folded` map; `email_note_colour` for the whole-email note; since D32 `text_updated`, `colour_updated`, `text_by`, `text_base` and their `email_note_*` counterparts; since D33 tombstones with a copy of the deleted annotation and `deleted_email_note`).

### Body
The body is for people: `# Subject`, the note on the whole email, then one `## “quote” <!-- tn:<id> -->` section per annotation that has a note; plain highlights live only in the front matter.

### Import rules
On import:
- The front matter is authoritative for anchoring, the marked section for note text.
- Headings without a marker belong to the note above.
- Text before the first marked section is the whole-email note.
- A missing section means an empty note (plain highlight).

Same format for export/import, the IMAP carrier attachment (D7) and the Git folder (D6).

### Rejected
Rejected:
- machine data in per-note HTML comments (ad hoc, fragile),
- JSON only (notes unreadable, poor diffs),
- `.md` + `.json` pairs (drift),
- JSON master with one-way Markdown (no editing).

A W3C Web Annotation JSON export for interop can be added if needed.

### Merging
- Import merges per annotation id, newer `updated` wins.
- Equal timestamps with different content mean the file was edited by hand (editors don't touch `updated`), so the file wins and the note is stamped with the import time.
- The whole-email note follows the same rule.
- Deletions travel as tombstones (D7), which since D33 keep a copy for restoring.

### Export zip (2026-10-18, 0.40.0)
**Export zip (2026-10-18, 0.40.0):** besides one `.md` per email, a `settings.json` (`thundernotes: settings`, version 1) with what the notes' files don't hold: the options page's switches and the last highlight colour, label colours and order (D40), the task view's choices, and the notes collapsed on this computer only (collapsing made while "Sync collapsed and expanded notes" is on is in the notes' `folded` map already).

Not what belongs to one computer: device name, notes column width, sync bookkeeping, drafts, the developer switch's match types.

Import restores it only with the switch "Also restore settings when importing" (off by default, not remembered):
- switches as exported,
- label colours and order merged label by label (the newer wins, as sync does, then pushed),
- collapsed notes added;
- without the switch the import says the export has settings.

**Unambiguous sections (2026-10-18; format 2, supersedes the 0.46.1–0.46.3 code-scanner fixes):** section framing is independent of Markdown syntax. Front matter contains `body_boundary: N`, a non-negative safe integer; `<!-- thundernotes:boundary:N -->` is the separator line. The writer chooses the smallest N for which that exact line occurs in none of the note texts. It writes the separator before each annotation heading and once at the end of the body. The first frame is `# Subject` plus the whole-email note; following frames start with the existing marked annotation heading. Notes keep their literal markers, indentation and unfinished code fences; no artificial fence or closing comment is inserted or removed. Leading/trailing separator blank lines are normalized, not content-line indentation or trailing spaces.

The reader requires the final separator and rejects invalid boundary metadata, unknown section IDs, duplicate sections and duplicate front-matter IDs with `FormatError`. Missing annotation frames still mean empty notes. That strictness is for carriers (a damaged one stays unread and listed, D35). An import from the options page reads a file the user may have edited: an unknown or unmarked section, a duplicate section or a missing final separator doesn't fail the file, and nothing is dropped. Each section that can't be placed becomes a note of its own: a section for an unknown note is anchored at the quote its heading names (when the email still has that passage); a duplicate section goes on the same passage as the note it duplicates; a section without a marker keeps its heading as text and has no passage (the toolbar list shows it under "Not found in this view"). If the first frame lacks its `# Subject` heading, its entire non-empty text likewise becomes an unanchored note, rather than the whole-email note where a newer local version could discard it. Empty malformed frames create no note. Strict carrier reads still reject a missing title. Its id comes from its text (`recovered-<hash8>`), so importing the same file again finds the same note, and no merge can overwrite it with a newer local note, as happened when such text was added to the whole-email note (PR #7 review). The import result names each repair. What can't be framed at all (front matter, `body_boundary`) still fails. When editing a file, keep the structural boundary lines and section IDs intact; to insert a literal copy of the current separator, choose a different unused N and update the structural lines and front matter together. A Markdown viewer may display later sections as code if an earlier note has an unfinished fence; the interchange reader nevertheless preserves every section. It does not repair or reinterpret user Markdown.

This is an intentional development-only format change: the add-on rejects version 1 files explicitly, with no heuristic compatibility path in it. There are no users. IndexedDB's data model is unchanged. Development data in format 1 is converted once, outside the add-on, by `scripts/migrate-format2/`: `migrate.py` rewrites an account's carriers on the IMAP server (dry run by default, read-only; `--apply` backs up the originals, uploads the converted carriers and only then deletes the old ones), and `convert.ts export` converts an export zip. Both read with a frozen copy of the format-1 reader and check that each converted file reads back to the same notes. The MIME carrier envelope remains version 1.

**Schemas and version policy (2026-10-18, development issue #13):** `docs/schemas/` holds Draft 2020-12 JSON Schemas for format-2 front matter, export settings version 1 and settings-carrier JSON version 1. Tests validate reference files and generated output with a test-only validator; no validator is bundled into the add-on. The schemas describe well-formed interchange values; readers remain lenient where already implemented, and body framing and unique IDs still need the format reader. Unknown fields may be ignored and dropped. Safe optional additions keep the version; incompatible changes get a new schema/version and an explicit compatibility/conversion plan, with preservation tests if existing data must be carried forward. The README records the existing format-1 conversion and future format-3 obligations; migration scripts and corner cases are out of scope. It also records that `parseSettings` currently ignores the JSON version: a future incompatible settings carrier needs a safe refusal/identity strategy, not merely a version bump.

**Blank-line layout in lists and quotes (2026-10-18, 0.48.4, development issue #15):** to keep each empty visual paragraph inside its Markdown container, the renderer indents its no-break-space padding to the content column of the active list item and keeps the quote prefix. The source-line map still points all padding lines to the original blank line. This prevents list continuation paragraphs from becoming code and keeps text extraction aligned with rendering.

**One Markdown parser (2026-10-18):** `core/src/markdown-structure.ts` creates the supported markdown-it dialect, supplies parser-derived code ranges, and owns the note-layout preprocessing and original-line map. Rendering and task extraction share both that preprocessing and the checklist-token predicate. Quote/list container boundaries and indentation are interpreted by markdown-it, not a second handwritten parser. Rendered checkboxes carry their original `data-line`; the card rejects missing or invalid mappings instead of guessing by checkbox order. `tasksIn` and `taskAt` share the prepared parse: two parses per note, pinned by a parser-count test.

The parser stays out of the message display script (D22). The renderer, in the background, marks what the card's menus need: each checkbox's source line, and on an `@` date that isn't ISO yet the date it would be (`data-iso`). "Copy task" checks the clicked line's shape only (`taskAtLine`; a rendered box or the editor's syntax tree has already ruled out code), and the background checks again with the parser before copying. "Convert to date" is worked out in the background (`convertLooseDate`). The live editor uses the text-level helpers (`looseDatesInText`, `labelsInText`): it knows its code blocks from its own syntax tree. A test fails if markdown-it gets bundled into the display script again. The display script is about 84 KiB (88 KiB before format 2, 184 KiB with the parser in it).

## D26 — The Experiment API also adds a ThunderNotes column (2026-10-15, accepted)
Widens D19. The MailExtension API has no message-list columns; Thunderbird's internal `ThreadPaneColumns` module (`chrome://messenger/content/ThreadPaneColumns.mjs`, `addCustomColumn`) is meant for add-ons but only reachable from an Experiment.

The add-on's single Experiment (`packages/thunderbird/experiments/thundernotes/`) therefore has two jobs:
1. a sortable icon column "ThunderNotes" showing the post-it on messages carrying the `$annotated` keyword — the column reads only the keyword, never the note store, so it stays fast and simple;
2. the global-search exclusion for the carrier folder (D19), ready for IMAP sync.

### Registration and layout
- It is registered at add-on startup and removed on shutdown.
- Thunderbird hides columns missing from a folder's saved layout and sorts them first, so on first start the Experiment writes the column into every folder's layout once (visible, right after the attachment column; folders without a saved layout get their default layout plus the column); later user changes are respected.
- A 16 px icon file is used for the cells.

### Risk and limits
- Risk: an internal module can change between major Thunderbird versions; check on each ESR.
- A separate icon for "notes" vs "highlights only" would need a second keyword; not done.

## D27 — IMAP sync: per account, folder `ThunderNotes`, prompt fetching, explained carriers (2026-10-15, accepted)
Refines D7/D14/D19. Notes on an email are synced through the IMAP account that holds the email, in a folder named **`ThunderNotes`** at the account's root (renames D7's `Annotations`: the folder is visible, D19, so its name should say what it is).

Emails in local folders and POP accounts are not synced; they stay local (export is their backup).

### Carriers
- Carriers follow D7 (X-Annot-* headers, text/plain notice + D25 Markdown attachment, always read; update = import new revision with a fresh Message-ID + permanently delete the old one; deletions as tombstones, GC after 30 days).
- The subject reads `[ThunderNotes] <email subject>`.

### Prompt fetching
Because no MailExtension API fetches a folder from the server, the add-on's Experiment (D26) gets a third job: it ticks "check this folder for new messages" on the carrier folder and triggers a check at startup, so other devices' notes arrive as promptly as Inbox mail.

### Explained carriers
- Opening a carrier in Thunderbird shows a dismissable cover explaining that the message is internal to ThunderNotes; no highlight UI on carriers.
- Other clients see the plain-text notice at the top of the carrier.

## D28 — Note editor: CodeMirror 6 live preview, loaded on demand (2026-10-15, accepted)
Supersedes D22's textarea + preview. Notes are edited Obsidian-style: Markdown shown formatted, with the markup visible only on the line being edited (bold, italic, inline code, headings, lists, task checkboxes that can be clicked, links, quotes).

### Build and loading
- Built on a slim CodeMirror 6 (core + `@lezer/markdown`, no HTML/JS language support: 297 KB instead of 488 KB); the live-preview rules are our own.
- The bundle is loaded only when editing starts, with `import()` of a file listed in `web_accessible_resources` (spike `spikes/lazy-editor`: 43 ms; a plain extension file can't be imported from the display script; background injection works as a fallback).
- Until then the card shows the background-rendered note (D22), so viewing emails costs nothing extra.
- Own right-click menu in the editor (Cut/Copy/Paste/Select All), as Thunderbird's message-pane menu has no Paste.
- The textarea editor stays as a fallback if loading fails.

### Fenced code blocks (2026-10-16)
- Fenced code blocks (2026-10-16) are a shaded box in both the editor and the shown note; the fence lines are the box's top and bottom padding, their ``` visible only while the cursor is in the block, so nothing jumps when editing starts.
- No blank lines are needed around a fenced block (CommonMark).
- Links show their destination as tooltip in both modes.

### Tab (2026-10-16)
Tab follows where Markdown has indentation (2026-10-16):
- in a list it nests the item (with its sub-items) under the item above, at that item's text column (2 spaces under `-`, 3 under `1.`), Shift+Tab returns it to its parent's level;
- a numbered item nested by Tab gets 1 when it starts a sub-list, else the next number;
- a numbered sub-list right under a list item may start at any number (e.g. sub-points numbered on across items), a deliberate departure from CommonMark, which requires 1 there and otherwise reads the lines as text of the item, so other Markdown tools show such sub-lists as text;
- after ordinary text a number other than 1 still doesn't start a list;
- in code it inserts spaces (4, as in Python) at the cursor or before each selected line;
- elsewhere it adds a quote level (`> `), Shift+Tab removes one;
- each selected line by its own kind;
- Tab never leaves the editor.

### Indentation display
- The editor draws nested items one step per level (as the shown note) instead of their narrow spaces (since 2026-10-16 every list marker, bullet, number or checkbox, is one fixed width, 1.4em, in both views, and that is the step; an item's continuation lines start where its text starts), except on the cursor line, where the spaces are plain text so the cursor moves normally; hides the 1–3 meaningless leading spaces of plain lines off the cursor line, and draws indented (4-space) code as the same box as fenced code.
- Nested quotes (`> >`) have one bar that moves in with the text, one 1.2em step per level, in the editor (off the cursor line) and the shown note.

### Joining list items
- Joining list items (Delete at the end of an item, Backspace at the start of the next item's text or line) brings up only the lower item's text, its marker goes, so Enter splits them again.
- Backspace on a first item with no item above only removes its marker.

### Lists by shortcut (2026-10-16)
- Lists by shortcut (2026-10-16): Ctrl+Shift+7 numbered, Ctrl+Shift+8 bulleted, Ctrl on macOS too (Cmd+Shift+7 is the system's Help search on German keyboards and never reaches the add-on; by physical key), on the line or all selected lines, checkboxes kept; again on such lines: plain text.
- Numbered lists renumber themselves after an edit, from the first item's number (which is all Markdown keeps; the shown note numbers that way anyway); the renumbering is its own undo step, so Cmd+Z right after it restores the typed numbers, and undo never renumbers.
- Setting "Renumber numbered lists automatically", on by default; off leaves the numbers as typed.

### Links (2026-10-16)
- A pasted URL is written as a Markdown link (`[example.com/page](https://example.com/page)`, or with the selected text as label; 2026-10-16), so the file says what the card shows.
- Bare URLs typed by hand stay as typed (valid GFM, linked when displayed) and become Markdown links only on request: Cmd/Ctrl+K on the URL or "Turn link into Markdown format" in the editor's right-click menu.
- Cmd/Ctrl+K on other text inserts `[text](url)` with the clipboard's URL, or leaves the cursor where the URL goes.

### Rejected
Rejected:
- an own contenteditable editor (undo, cursor around hidden markup, IME and paste would all be ours to get right) and
- a textarea with a coloured overlay (markup can only be dimmed, not hidden).

**The simple editor says so (2026-10-18, 0.46.2):** when the live editor can't be loaded and the textarea takes over, the card shows "Simple editor: the full editor couldn't be loaded. Your notes are safe; please report this", the reason on hover and in the error console. It should never appear on supported versions; it's there for a future Thunderbird change to what an email's scripts may load, or a bug in the editor, and silently it would never be reported.

## D29 — Highlight colours: a palette of 8 named colours (2026-10-15, accepted)
Colours work as categories (concept), so a fixed palette instead of a colour picker: yellow (default and fallback), green, blue, pink, orange, red, purple, grey.

### Storage
Stored by name in `colour` (D25), so other clients and themes map names to their own shades.

### Shades and contrast
- A highlight and its card share the colour; highlights stay slightly see-through, so the shades match only on a white background.
- All colours are light, like sticky notes (yellow close to a classic Post-it, the others shifted lighter by the same factor), so by the WCAG ratio black text contrasts best on each.
- Seen in use (2026-10-16), white reads better on the strong ones (orange, red, purple, grey), where WCAG 2's ratio is known to favour black on mid tones: those four always take white text; the others follow the WCAG rule.
- Text contrast follows the WCAG contrast ratio (black or white, whichever contrasts more with the effective colour): always on cards; in highlights by default too (setting "Adjust text colour in highlights for contrast", on by default).
- New highlights use the last colour chosen (setting "Use last highlight colour for new highlights", on by default; off = always yellow).

### Choosing
Choosing:
- a bar of colour dots after selecting, which replaces the Highlight button (a click highlights in that colour; a small post-it marks the bar as ThunderNotes'; Ctrl/Cmd+Shift+H uses the ringed colour),
- a colour dot on each card,
- a row of colours at the top of the right-click menus,
- a right-click on a highlight (since 2026-10-17 the add-on's own menu, like the cards': colour dots, Add/Edit note, Open link/email, Copy, Remove; Thunderbird's menu shows no icons there and is long; with text selected, Thunderbird's menu still appears, with a Colour submenu of names),
- and Cmd+Option+1…8 (Ctrl+Alt+1…8) for the active card.

### Whole-email note (2026-10-16)
The whole-email note starts yellow and can be recoloured like any card (2026-10-16; stored as `email_note_colour`, travelling with the note's timestamp); before, it had no colour choice, which was confusing.

## D30 — Cards fold to their quote line; the choice stays on the device unless synced (2026-10-16, accepted)
A small tab centred on a card's top edge, shown while the card is hovered (a chevron: up = fold, down = open; on the border so it never covers the quote) and the quote line itself fold the card to that line, with its colour button and bin; clicking it again opens it.

### Behaviour
- Cards without text have nothing to fold.
- A folded card still opens its editor when its highlight is clicked or it is edited from a menu, and folds back when editing ends.
- Clicking the tab or the quote line while editing saves, leaves the editor and folds the card.

### Storage and sync
- Folding is a viewing choice, so by default it is remembered per note on this device only (`storage.local`) and never touches the notes.
- The setting "Sync collapsed and expanded notes to your other devices" (off by default) also stores it with the notes: a set-level `folded` map (id → `folded`, `at`) in the D25 front matter, merged by its own timestamp per id and dropped with the annotation.
- It deliberately doesn't use the annotation's `updated`, so folding on one device can never override a note edited on another.
- With the setting on, the synced choice wins where one exists; folding writes a new carrier revision.

Rejected: always syncing (each fold would be a revision and, sharing `updated`, could beat a concurrent edit).

## D31 — Highlighted links: a click asks "note or link" (2026-10-16, accepted)
Now a click on the highlighted part of a link opens a small popup where it was clicked: the link's destination (host in bold, then the path, shortened), **Add note** / **Edit note**, and **Open link**.

**Why:** A highlight on a link made the link unusable as a highlight: clicking opened the link, so a plain highlight could never get a note.

**Details:**
- Cmd/Ctrl+click opens the link directly, as in the note editor.
- Links that aren't highlighted, and the unhighlighted part of a partly highlighted link, behave as always.
- Showing the destination also helps spot links whose text says something else.
- In addition, Thunderbird's right-click menu on any highlight offers **Add note** / **Edit note**.

**Rejected:**
- a modifier key alone (invisible),
- a note icon next to highlighted links (clutter in the email, awkward on wrapped links),
- the right-click menu alone (breaks "click a highlight to edit", D24).

## D32 — Edits from two devices are combined line by line; clashes become a conflict box (2026-10-16, accepted)
Refines D7/D25/D27.

Before, the newer edit of a note replaced the whole note (and a colour change counted as an edit, so it could wipe out text written elsewhere).

- **Per part:** each highlight's text, colour and tags are decided separately: `text_updated`, `colour_updated` next to `updated` (missing = `updated`, for older files).
  - Colour: newer wins, never a conflict.
  - The whole-email note follows the same rules (`email_note_updated`, `email_note_colour_updated`).
- **Text, three-way:** every device keeps, locally only, the last texts it synced per note (`syncHistory`, up to 10).
  - A carrier names, per note, the synced text it was edited from (`text_base` / `email_note_base`, hash8).
  - The receiver looks that base up and merges line by line (node-diff3, MIT):
    - changes to different lines combine;
    - lines replaced on both sides are decided line by line, so e.g. two neighbouring tasks ticked on two devices don't clash;
    - only lines changed differently on both become a conflict.
  - An incoming text this device already synced is stale and ignored.
  - Without a known base:
    - in sync, lines both have are kept, additions of either side kept, the rest is a conflict (nothing is lost);
    - on import, the newer text wins as before (D25), and equal times with different text still mean a hand-edited file.
- **Conflict box:** plain Markdown in the note, an Obsidian/GitHub-style callout, so the file stays readable and can be resolved by hand anywhere:
  - `> [!conflict] Changed on two devices — keep one`,
  - then per version `> **<device> · YYYY-MM-DD HH:MM UTC**` and its lines (`*(removed)*` for none), newer first,
  - followed by one blank line.
  - Fixed order and UTC times make the result identical on every device that combines the same two versions, so devices settle instead of overwriting each other.
- **Cards:**
  - a note with a conflict gets an orange stripe and "2 versions" on its quote line (also when folded);
  - the shown note draws each box with both versions (device, local time) and **Keep this** / **Keep both** buttons;
  - the editor draws the box as an orange quote.
  - The toolbar button's tooltip and the popup list name notes changed on two devices.
- **Device names:** "Name of this device" in the settings, pre-filled with the computer's name (plus the profile's when there are several), read by the Experiment (no MailExtension API knows it); shown in conflict boxes (`text_by`, `email_note_by`).

**Rejected:**
- newer-wins with the older version in a box (a box even when the edits didn't touch the same lines);
- CRDTs (Yjs/Automerge: machine state in the file, much more code, for short notes).

**Equal times in sync (2026-10-18, 0.41.2; design review, issue #1):** two different texts with the same time and no known base become a conflict box when syncing (nothing lost); "the incoming text wins, stamped now" applies only on import, where equal times mean a file edited by hand (D25). Before, sync took the incoming text.

## D33 — Restore what was deleted on an email in the last 30 days (2026-10-16, accepted)
Tombstones (D7) now keep a copy of the deleted highlight or note (its front-matter fields plus the note text, `note:`), and emptying the whole-email note keeps its text (`deleted_email_note`); both sync like the tombstones and are dropped with them after 30 days.

**Restoring:**
- On an email, the toolbar list offers "Restore N deleted in the last 30 days", which brings all of them back: restored annotations count as changed at that moment, so other devices take them back despite their tombstones.
- Restoring is about deletions only, not older versions of notes that still exist (Cmd+Z covers a wrong edit right away).
- Sets of local/POP emails that lost their last note are now kept while something can be restored, and expire when the email is next shown.

**Rejected for now:** "restore everything" across all emails (deletions happen one note at a time, so it would mostly resurrect notes deleted on purpose); a "Recently deleted" list across emails on the options page is the better form if needed later.

### Purging (2026-10-18, 0.30.0)
- next to "↺ Restore N deleted …" in the popup, "Delete for good" (a second click confirms) deletes those copies on this email, on all devices.
- A copy could come back with a merge from a device that still has it, so the set records the time instead (`purged_before` in the file): copies of what was deleted up to then are dropped whatever a merge brings, the later purge wins; what is deleted afterwards can be restored again.
- The tombstones stay, for the deletions to reach the other devices; a set left with nothing goes as after deleting the last note.

**Deletion records outlive the restore window (2026-10-18, 0.41.3; design review, issue #1):**
- After 30 days a deletion drops only its copy (no longer restorable); the bare record (note id and time, no text) stays for a year, then goes too. The same for a deleted whole-email note (its time only).
- So a device that was away longer than 30 days doesn't bring deleted notes back. Known limit: a device away for more than a year still can.
- An email whose notes were all deleted keeps its carrier (with only the records) for that year.
- A note edited on another device after its deletion stays (the edit wins), as before.

## D34 — Draft autosave while a note is being edited (2026-10-16, accepted)
Now the editor's text is kept as a draft in `storage.local` (this device only, key `drafts`, per email and note) 1.5 s after the last change, and dropped when editing ends, saved or discarded with Esc.

**Why:** Notes are saved when editing ends (leaving the card, switching message, Ctrl/Cmd+Enter, D24), so text typed into an open editor was lost if Thunderbird crashed or was killed meanwhile.

**Details:**
- A draft found later (and different from the saved note) shows on its card as "Unsaved text from <time>: Thunderbird closed while you were writing" with:
  - **Restore** (opens the editor with the draft; leaving saves it, Esc drops it) and
  - **Discard**.
- A note without text (a new highlight being written) gets a card for this too.
- Drafts aren't synced: they belong to the device where the typing happened.

**Rejected:** saving to the note itself while typing (a new carrier revision every few seconds, and edits would reach other devices half-written).

**A failed save keeps the text (2026-10-18, 0.46.1; issue #6):** leaving the editor no longer deletes the draft; it goes only when the save succeeded (or the edit is discarded with Esc). Saving fails: the card says so and offers the text back ("Not saved (…). Your text is kept: restore it to try again"). Before, the draft was deleted before saving, so a failed save lost what was typed.

## D35 — A visible warning when sync isn't working (2026-10-16, accepted)
Now each account's sync outcome is recorded (`storage.local`, `syncProblems`); after 2 failures in a row (one can be a passing network hiccup) the header button gets an orange warning triangle in its icon, its tooltip names the account, and the toolbar list opens with "Sync of <account> with the mail server isn't working since <time>: <reason>".

**Why:** Sync failures (server unreachable, login, the carrier folder unreachable) only went to the error console; notes kept working locally, so a broken sync went unnoticed.

**Details:**
- The next successful sync clears it.
- A carrier folder that can't be found and can't be created (typically: still on the server but unsubscribed, which hides it from add-ons, spike `imap-folder`) gets a reason that says so and how to subscribe it again.
- Automatic re-subscribing is a possible follow-up once the warning shows what Thunderbird actually does in that case.

### Refined after testing (2026-10-16)
- offline, Thunderbird's import fails with a network error (0x804B001E, unknown host) rather than queueing, so failures where the server can't be reached at all (Firefox network errors: unknown host, refused, timeout, offline, reset, interrupt, proxy; or the browser offline) no longer count: Thunderbird reports those itself, and a later sync uploads what's pending.
- **Kinds:** The warning is only about ThunderNotes-specific problems while the connection works, by kind:
  - the folder can't be found or created (folder),
  - the server refuses a carrier (upload),
  - a carrier can't be read (read; warns at once and for as long as that message is in the folder, as it isn't read again by itself; the explanation lists such messages by subject, each with "Delete from the server", two clicks),
  - old versions can't be removed (cleanup),
  - or other.
- **Icon:** The corner triangle was too easy to miss: the whole post-it turns red and unhappy (`icons/icon-sad.svg`).
- **Explanation:** The toolbar list's red line opens an explanation of the kind and what helps, and that the notes are safe on this computer.
- **Possible later:** warn anyway when Thunderbird is online, the account's other folders sync, and ThunderNotes hasn't synced for over an hour.

**Unreadable carriers are kept (2026-10-18, 0.41.1; design review, issue #1):**
- A carrier that can't be read (damaged, a newer format, notes for another email than its headers name) is never removed by cleanup as an old revision: it may hold notes no other device has. Only the user removes it (from the toolbar list), and its warning stays until then, whatever else syncs fine.
- Read again after an update of the add-on: a newer version may understand it.
- Consolidating several carriers of one email goes by the readable ones only.
- A new revision is recorded before the old ones are deleted: a crash in between leaves a duplicate (cleaned up at the next check), never a gap.
- Before 0.41.1 an unreadable carrier was deleted at the next upload of notes on the same email (lost if no other device had read it).

**Only merged carriers are removed (2026-10-18, 0.46.4; dev issue #1):** cleanup removes only carriers whose content has been merged on this device. A carrier whose reading failed for the connection (a timeout) stays unmerged until a later check reads it; before, the next upload of notes on the same email deleted it, its notes merged nowhere. The same applies to the settings carrier.

## D36 — An unsubscribed carrier folder is subscribed again (2026-10-16, accepted)
If the folder exists but isn't subscribed, it is subscribed again; once Thunderbird shows it, sync carries on and a notice explains it ("…was unsubscribed. ThunderNotes … can't reach an unsubscribed folder, so it has subscribed it again. To remove ThunderNotes for good, uninstall the add-on first, then delete the folder.").

**Why:** Seen in testing: after `ThunderNotes` was unsubscribed, sync stopped without any error (edits never reached the server; a device whose local store was reset got nothing back), so the D35 warning couldn't catch it. Thunderbird hides unsubscribed folders from add-ons (spike `imap-folder`).

**How:**
- Now, whenever sync can't see the folder (and once per session on an account where nothing points to one, e.g. a fresh device), the Experiment checks the server's full folder list the way the Subscribe dialog does (`nsISubscribableServer`: populate, `setState`, `commitSubscribeChanges`).
- Only a folder that isn't on the server at all is created (D20).
- Accounts that show all folders regardless of subscription are left alone.
- Sync decisions are logged to the add-on's console (Debug Add-ons → Inspect) for cases like this.

**Tested 2026-10-16:** the folder is subscribed again and the notice shows; `setState` alone sends nothing, the `subscribe` command is needed.

## D37 — Links between emails: Markdown links to `mid:` URLs, with backlinks (2026-10-16, accepted)
Refines D11. A link to an email is a plain Markdown link whose target is the email's Message-ID as an RFC 2392 `mid:` URL, labelled so emails with the same subject can be told apart: `[Subject – Sender, 12 Oct 2026](mid:abc123@example.com)`.

It survives moving and archiving, works in every account and on every device, and stays readable in other Markdown tools.

### Opening
Clicking it in a card (or Ctrl/⌘+click in the editor) opens the email in Thunderbird (`messageDisplay.open` by `headerMessageId`), in whichever account and folder it is; a notice says so when it isn't on this device.

### Inserting
- the message list's right-click menu offers "Copy ThunderNotes link" (one link per selected email) to paste into a note;
- `[[` autocomplete while typing follows later;
- dragging an email into a note needs a spike first.
- After "Copy ThunderNotes link", a note being edited in that tab gets the keyboard focus straight back (the Experiment focuses the message pane; no MailExtension API moves focus between panes), so Cmd/Ctrl+V pastes at once.
- Links point to single emails for now, not conversations.

### Backlinks
- the toolbar list of an email shows "Linked from" with the emails whose notes link to it (subject, sender, date, which note), each opening that email; the header button's tooltip counts them.
- They are found across all accounts on the device (Message-IDs are global) and, for IMAP accounts, on every device once synced; local/POP notes stay on their device.

### Display
- Email links are drawn as a see-through rounded lozenge with an envelope (✉; wrapped over two lines it stays open at the line break), in the editor (off the cursor line; on it the text is underlined like a web link, its Markdown showing, and ⌘+click, Ctrl+click on Windows/Linux, opens it; Ctrl+click is a right-click on macOS).
- Right-click on a link in the editor or the shown note offers "Open link" / "Open email" and the shown note, so they read differently from web links.

### Escaping
- Link text escapes only brackets without a partner (`[tn-spike] C` stays as it is, valid CommonMark); the editor's parser would read an inner `[x]` as a link of its own, so the editor finds such links (email and web) itself.
- Escapes that do occur render as plain brackets in the shown note and are hidden in the editor off the cursor line.

## D38 — Tasks: every checklist item, with an optional due date and labels (2026-10-16, accepted; stage 1 built)

Refines D10. Every open checklist item (`- [ ]`) in a note is a task; nothing has to mark it as one.

### Due dates and labels

Two independent, optional dimensions:

- a **due date**, written `@2026-10-24` in the file (unambiguous for other tools and sync; typed naturally as `@friday`, `@tomorrow`, `@24.10.` and turned into the date by autocomplete; shown as "Fri 24 Oct", red when overdue), and
- any number of **labels** `#name` (a task list or project is simply a label, e.g. `#contract-renewal`; "important" is a label too, no separate priority; labels autocomplete from those used before).

Labels also work in ordinary notes, so the Notes space (phase 3) can find all notes on a label.

Labels are one regardless of case (`#URGENT` = `#urgent`: filters, colours, order, counts) but keep a spelling, as in Obsidian, Gmail or GitHub:

- the one written most often, on a tie the first;
- the label row, label sections, suggestions (task view and editor, one per label) and newly added labels use it;
- labels already in notes stay as written (2026-10-18; before, the task view showed and wrote them in lower case).

### Planned task view and reminders

Planned task view (its own tab, from the toolbar button): Overdue / Today / This week / Later / No date, label chips to filter, each task showing and opening its email; ticking in the view updates the note (and so all devices); done tasks hidden by default.

Reminders only for dated tasks (a notification on the due day at a set time, snooze), overdue ones also on the toolbar button.

### Stage 1: lozenges

Stage 1 (2026-10-16, 0.21.0): dates and labels show as lozenges like email links, in the shown note and the editor (off the cursor line; plain Markdown on it).

A date reads "Sat 24 Oct", with the year at the end only when it isn't this year ("Mon 11 Jan 2027"; setting "Hide the current year in dates", on by default, 2026-10-18: off, always with the year, everywhere dates show), the full date as tooltip, red when past if it is a due date.

### Due dates vs. date references

Due dates vs. date references (2026-10-17):

- only dates in an open checklist item's own text (its line and continuation lines, not its sub-items) are due dates, all of them if there are several (in "prepare @mon for the meeting @tue" Monday is a deadline too);
- dates anywhere else (prose, ticked tasks, headings) are date references and never turn red.

No separate syntax such as `@@` (one more thing to remember, and forgetting it fails silently); the task view uses the same rule.

Setting "Past due dates shown in red", on by default; off: they look like any other date.

Also inside a link's text (their own lozenge within the link); not in code or a link's address.

### Autocomplete

Autocomplete while editing:

- after `@` today, tomorrow, the next weekdays, in a week, in a month, or what the typed word means (`@fri`, `@montag`, `@morgen`, `@24.10.` or `@24.10`, `@24.10.27`, `@2026-10-24`, year first also short `@2026-1-2` / `@26-1-2` (2026-10-17); a weekday is the next one, today excluded; a day without year already past means next year),
- after `#` the labels used before (most used first);
- arrow keys, Enter or Tab take it, Esc closes;
- the list opens only when typing or deleting in such a word, or with Ctrl+Space (Ctrl on macOS too) on one, not when the cursor merely moves onto a date or label, so the arrow keys keep moving through the text (2026-10-17);
- a lone `#` at a line start (a heading being typed) offers nothing.

### More date words

More date words (2026-10-17):

- `@yesterday`/`@gestern`, `@vorgestern`;
- the last weekday `@lastmonday`, `@last-mon`, `@letztenmontag` (on that weekday itself: a week ago);
- `@inaweek`, `@inamonth` (German `@ineinerwoche`, `@ineinemmonat`);
- counts `@3d`, `@2w`, `@1m`, `@1y` (German `t`, `j` too) and backwards with a minus (`@-3d`), exactly a number and one letter, so `@3dprinting` stays text;
- a month on from the 31st is the next month's last day.

Not `@nextweek`: unclear which day. Past days appear in the list only once something is typed; typing a number offers days, weeks and months.

### Converting typed and pasted dates

Typed dates are also converted without picking from the list (2026-10-17):

- a recognised date after `@` followed by a space or punctuation (not ".", part of `24.10.`) becomes the ISO date, as its own undo step (Cmd+Z brings back the typed text, kept as text);
- only number dates and whole words, two-letter abbreviations only in the list.

The file holds ISO dates only (unambiguous, understood by other tools, sortable); non-ISO dates in the text aren't due dates. Only dates marked with `@` are looked at; plain dates in prose stay text.

Pasted text: `@` number dates (`@24.10.27`, `@1.3.27`) become ISO dates as their own undo step; `@` words (`@freitag`) are left, as they meant a day relative to when they were written.

An `@` date that stays non-ISO (conversion undone, pasted words, written elsewhere) shows with a dotted underline whose tooltip says what date reference it would be; right-click → "Convert to date (Fri 24 Oct 2027)", in the editor and on the shown note.

### Stage 2: the task view

Stage 2, the task view (2026-10-17, 0.24.0): a tab opened from a "Tasks" button in the main toolbar (named "ThunderNotes Tasks" since 0.37.0, not to be confused with Thunderbird's own Tasks; the tab is titled so too; also an icon in the spaces toolbar on the left of the main window, like Mail, Calendar and Tasks, with the same overdue badge, both leading to the same tab, through Thunderbird's `spaces` API) (Thunderbird's `action`; it brings an open task tab to the front instead of opening another) or "All tasks…" in the note popup.

- Groups Overdue / Today / Next 7 days / Later / No date by a task's earliest date ("next 7 days" instead of "this week": on a Saturday "this week" would be one day), sorted by date, else newest email first; done tasks hidden, "Show done" adds a Done group.
- Each task shows its text rendered as in the note (dates, labels, links), below it the email's subject, sender (name and, lighter, address, to tell people apart; the address is searchable too, 2026-10-18) and date (click opens the email) and the highlighted passage its note belongs to.
- Label chips filter (all chosen labels must be on the task; a label in a task filters too), a text box filters by words in the task, subject, sender or passage; "Show done" and chosen labels are remembered on this device.
- Ticking changes the note like an edit in the email (per-part time and device, D32; synced; open emails redrawn), with Undo for a few seconds; the task is found by its line, or by the same line elsewhere if the note changed meanwhile, else the list just updates.
- The page reads all notes from the local database (thousands of notes in milliseconds, no index needed) and reloads when notes change (the store announces every write) or when the tab gets the focus (a new day).
- Empty checklist items (`- [ ]` with nothing after it: just started, or left by Enter) are no tasks: not listed, not counted (2026-10-17).
- Clicking a task's email line opens the email with the task's note open for editing, the cursor at the end of the task's line and the keyboard focus in the message (2026-10-17).
- No separate priority (a label, D38); no "recently added" order until tasks record when they were made.

### Badge and redraw

The Tasks button shows the number of overdue open tasks as a red badge, none when there are none, its tooltip says "N overdue" (2026-10-17, 0.24.1); counted again whenever notes change (in an email, by sync, an import) and every 10 minutes, so it follows the date. The task tab's icon carries the same count and its title says "Tasks (N overdue)".

An email whose notes changed while it was in a background tab (a task ticked in the task view, sync) is drawn again when it becomes visible or gets the focus (2026-10-17, 0.24.2).

### Label chips

Many labels (2026-10-17, 0.24.3):

- the chips are ordered by open tasks, most first, the same number alphabetically, also with done tasks shown (switching doesn't move them; labels only on done tasks come last, alphabetically; refined 2026-10-17, label ordering to be discussed further);
- they show how many tasks in view have each label and take two lines, then "+N more" opens all ("Fewer" folds them again, remembered);
- chosen labels always show.

Typing `#word` in the filter box narrows the chips to labels containing the word, Enter picks the first (outlined) and removes the word from the box.

Rejected: hiding labels used once (that may be the one wanted).

### Label filter

Label filter (2026-10-17):

- a click on a label chip at the top cycles include (red ring) → exclude (struck through in red, dashed ring; tasks with it hidden) → off;
- a click on a label inside a task only includes it or takes it out again (an exclude step there was unexpected, 2026-10-18);
- "Match all | any" chooses whether a task needs all included labels or one (always shown on its own line below the labels, greyed out until two are included, next to a "Done hide | show" switch of the same kind that replaced the "Show done" checkbox);
- excluded labels always hide a task;
- all remembered on this device.

### Quick actions and menus

Quick actions (2026-10-18, 0.29.0; menus refined the same day): the right-click menu goes by what is clicked.

On a task:

- "Open email with this note",
- "Mark as done",
- "Copy text",
- "Add date today / tomorrow / in a week",
- "Add date…" (a field at the task for a date word, the date it means shown as typed),
- "Add label…" (a field with our own list of labels used before, as chips in the label row's order, all of them in a list that scrolls (also with the wheel), each a full-width row with a grey block when hovered or chosen, narrowed to those containing what is typed; the browser's list was narrow and hard to read; a picked label is added, not selected as a filter; while a field is open the list doesn't redraw, e.g. when sync stores the note a moment after the last change, it catches up when the field closes; a field opened while another is open closes that one first; Tab finishes like Enter; hovering a suggestion highlights it, Enter or Tab then take it);
- "date", not "due date" (a date in a ticked task isn't due).

On a date in a task: "Change to today / tomorrow / next week", "Change to…", "Remove this date" (that date; should it be in the task twice, only the occurrence clicked).

On a label in a task: its colour row and "Remove label" (no moving: that is the label row's order); on a chip in the label row: its colour and "Move to front / left / right".

Colour rows have no title, the dots say it (also in notes).

Each rewrites only the task's lines (its line and continuation lines), like ticking, as an edit of the note (synced, emails redrawn), with Undo (the lines put back if still as left). Free text editing stays in the note (one click away): in the task view it would bring the editor's complexity and two editors of one note.

Right-click in the task view gives its own menu, not Thunderbird's page menu (Back, Reload …):

- on a task "Open email with this note", "Mark as done/not done", "Copy text";
- on a link inside a task "Open email/link" first;
- on a label its colour (D40);
- with text selected "Copy";
- elsewhere none;
- the filter field has an edit menu of its own (see below).

### Filter expressions

The filter is words only, all of which must match (task text, subject, sender, passage), a phrase in quotes counting as one (spaces included; straight or typographic quotes; an unclosed one runs to the end while typing; a date word inside stays text); a minus in front of a word or phrase excludes it (`offer -anna`, `-"call back"`; a lone minus is nothing).

Expressions as in Gmail or Google (2026-10-18):

- space = AND (a written "and", any case, is ignored),
- "or" in any case (written out as OR; capitals only was confusing, refined the same day; the words themselves in quotes, `"or"`) binds more tightly than the space (`offer anna OR ben` = offer AND (anna OR ben)),
- brackets group,
- a minus also before a group (`-(anna OR ben)`);
- incomplete input is read leniently (open brackets and quotes close at the end, a dangling OR, stray ")" and empty brackets are nothing);
- on Enter (when it picks nothing else) or leaving the field the filter is written out as understood (brackets closed, dangling OR and AND left out, brackets around an OR among other terms, none where they change nothing; the terms as typed), Cmd/Ctrl+Z brings back the typing;
- date tokens are joined by AND, a date in an OR is typed as text (`@2026-10 OR @2026-11`);
- a term between slashes is a regex (2026-10-18; no mode to switch: `offer /inv-\d+/ -anna`), case ignored, an open one counts as closed at the end, an invalid one counts as nothing and tints the pill red until it is valid, the tidy-up closes it.

### Date tokens

Dates are words too, as they are in the text (simplified 2026-10-18; a separate date condition did nothing a word doesn't): `@2026-10-24`, `@2026-10` (that month), `@2026` (that year) show as tokens before the field, always with the year whatever the date setting ("@Fri 24 Oct 2026", "@Oct 2026", "@2026": "@Oct" alone could be read as every October).

- typing "@" offers the same date suggestions as in notes, then months whose name starts with what is typed (English and German, `@jan`, `@okt`: always that month of the current year, a filter looks back as much as ahead) (Enter, Tab or a click take one; a finished date word and a space become a token by themselves);
- a left-click on a date in a task adds its token (again: removes it);
- a token's own × removes it, a click on the token turns it back into its text, selected, in the field (type over it, Backspace it, Space/Tab to keep it; leaving the field unchanged brings the token back, Esc while editing does so too, a second Esc clears the filter);
- Backspace in the empty field removes the last token, the pill's × or Esc clear;
- Cmd/Ctrl+Z right after brings back a removed token or the cleared filter (the field's own undo doesn't know tokens), once typed on it undoes the typing;
- the field's right-click menu is ours for the same reason (Thunderbird's Undo stayed grey): Undo, Cut, Copy, Paste (plain text), Select All.

Ranges like "this week" aren't possible this way (grouping by due date covers that need).

### Filter placement

The filter sits at the start of the label row; that row and the switch line stay at the top while the title and the tasks scroll, with a little room above the shadow (setting "Keep the task view's filters at the top while scrolling", on by default).

The text filter sits in the header: unused, a small lozenge with a funnel (the filter symbol, as on a spreadsheet column; a magnifier would read as search); clicked or Cmd/Ctrl+F it opens into a field ("Filter… (#label)"), tinted blue while it filters so a filtered list looks filtered; × or Esc clear it, Cmd/Ctrl+F gets there.

### Grouping and done tasks

Grouping open tasks (2026-10-17, 0.27.0): a "Group due date | label | email" switch, first on the line below the labels, remembered.

- By due date as before (the default); "No date" now oldest email first (waiting longest, where tasks are most easily forgotten).
- By label: one section per label in the chips' order, headed by the label in its colour, a task with two labels in both, "No label" last, by due date inside ("where do my projects stand?").
- By email: one section per email, newest first, headed by subject (opens the email) and sender, tasks in the order written; the rows then say "Open note" instead of repeating the email ("what do I still owe here?").

Done tasks: "Done hide | show inline | show separately" (0.27.0, replaces hide | show): inline puts them in each label's or email's section after its open tasks, struck through, in the Done order (whose Sort switch then sits on the line below the labels); by due date inline doesn't apply (a done task with a past date isn't overdue, and a group of its own would just be "Done"), so it is greyed out and they show separately, the choice kept for label and email.

The "No date" heading says "(oldest email first)".

### Keyboard and selection

More ways to work through the list (2026-10-18, 0.33.0): a selected task (a click on its row, or ↑/↓; j/k too; the task view takes the keyboard focus when opened or brought to the front, through the Experiment's `focusCurrentTab`, as a page's own request is ignored there) with keys (↑/↓ stop at the ends, no wrapping round in a long list; Home/End or Cmd/Ctrl+↑/↓ jump to the first or last task):

- Space ticks,
- Enter opens the note at the task,
- d adds a date,
- l a label,
- t sets tomorrow (the earliest date moved, else added),
- →/← show or hide the note,
- Esc lets go;
- Space moves the selection on to the next task first (the previous at the end), also when the ticked one stays listed in Done (setting "When ticking a task with Space, stay on it", off by default; on, the page scrolls to the task should it move to Done off screen; other redraws never scroll);
- a focused button keeps Space and Enter.

### Filter matches and note preview

What the filter matched (words, phrases, regex hits that must or may be there, not excluded ones) is marked faintly in the task and its email line, `@2026-10` marks the date lozenges.

A small arrow on each task shows its whole note below it, read-only.

### Copying as Markdown

"Copy list as Markdown" (right-click on the background) copies what is shown:

- a heading per group,
- the tasks as written with their email in brackets as `("Subject" - Name <address>, 2026-10-12)` (the subject exactly as it is, no escaping: it runs from the first quote mark to the last before " - "; the sender as in email headers, names unchanged; the email's day, ISO);
- on a task "Copy this task as Markdown" copies that line;
- a link to an email (`mid:`, leading nowhere outside ThunderNotes) becomes `(reference to email: "Subject" - Name <address>, 2026-10-12)`, replacing the usual "Subject – Sender, date" link text, after the writer's own;
- the email found among those with notes, else in Thunderbird by Message-ID, else its link text stands in (the options page export keeps `mid:` links: a backup, read back on import).

Copying from an email too (2026-10-18, 0.36.0):

- right-click on a task in a note, shown or being edited, anywhere on its line (its continuation lines too) gives "Copy task as Markdown" (the same line as in the task view, with its email in brackets; in the editor the text as it stands, unsaved changes included);
- anywhere in a note (and on a highlight with a note) "Copy note as Markdown": a heading `## Note anchored to "the passage" in email "Subject" - Name <address>, 2026-10-12` (the passage on one line, as written; `## Note on email "Subject" - …` for the note on the whole email; the email in the heading since 0.36.3, before on a last line of its own), then the note's text, email links as references;
- right-click in the email (not on a highlight or note) and the header button's menu, also a link in its popup, "Copy all notes as Markdown": the email as heading (`## "Subject" - …`), then each note under its own `### Note anchored to "…"` heading (the note on the whole email first, then reading order), only notes with text (plain highlights left out; refined 2026-10-18, 0.36.1).

Headings inside a note go one level below the note's heading in the copy (`# Plan` under `## Note anchored to …` becomes `### Plan`, under `###` it becomes `####`), past six levels too (`#######`: not standard Markdown, but the hierarchy stays clear); underlined headings become `#` headings; code blocks unchanged (0.36.2).

A copy isn't word for word, like the references to emails; the note itself stays as written.

### Dragging labels

A label chip dragged from the label row onto a task adds the label (a task that has it: a note, nothing changed).

A label dragged out of a task:

- onto empty space (anything but a task or the label row, e.g. beside the list) it is removed from that task (as things dragged off the macOS Dock),
- onto another task it is added there,
- back on its own task nothing happens;
- Undo as for every change (2026-10-18).

### Animation

When the list is drawn anew (another grouping or order, a task ticked, labels reordered), rows and headings slide to their new places and new ones fade in (about 0.2 s; only what is on screen; also while typing in the filter: a redraw during a slide measures the rows where they appear, so the next slide starts there without waiting; never with "reduce motion"; setting "Animate changes in the task view", on by default; all in `list-motion.ts` and one call, 2026-10-18, so it can be taken out as a whole).

### Finished date

When a task was finished (2026-10-17, 0.26.0): ticking appends `✅ 2026-10-17` to its line (the form of the Obsidian Tasks plugin), wherever it is ticked (email, editor, Cmd/Ctrl+L, task view); unticking or turning it back into text removes it; a date already there is kept.

- Only the day, no time.
- Shown as a small grey "done Sat 17 Oct" in notes, the editor (off the cursor line) and the task view.
- Stored in the line, not hidden on the device: it syncs with the note, survives export and is readable in other Markdown tools; tasks have no id a hidden record could rely on.

The Done group has a "Sort" switch: latest done (default), earliest done, due ↑, due ↓, label (first label alphabetically); tasks without the value last, then the most recently finished; remembered on this device. Tasks ticked before 0.26.0 have no date and sort last.

The date is text and can be edited: anything not of the form `✅ YYYY-MM-DD` is plain text (no finished date); a date of that form that can't be (month 13, 30 February) shows as text with a dotted underline "Not a valid date" and doesn't count, likewise a due date like `@2026-13-45` (2026-10-17).

### Sub-tasks

Sub-tasks (2026-10-18, 0.38.0): a checklist item indented under another one in the same note is its sub-task (found over continuation lines, sibling items and blank lines; the list ends at unindented text); under a plain bullet or number, that item's text says what it is part of (it is no task and gets no row).

- Each task keeps its own row and group; a sub-task shows "↳ part of “…”" at the end of its email line (after the email link, 0.42.2) (a click selects the parent task; not shown with the filter: a notice), a task with sub-tasks a badge "2/5" (done of all, direct ones).
- Grouped by email, sub-tasks are indented under their parents (24 px per level, note order), without "part of" there (the indent shows it; kept when the parent isn't listed or is a bullet), and done ones shown inline stay in the order written, under their parents, not last (0.38.2).
- The lanes run left of every row they join and every row they pass (a parent sits less indented, its arrow pointed backwards; a sub-task whose parent is hidden as done sits further out in between, the line ran through its box, 0.38.7).
- The expanded note preview indents nested items (0.38.2).

The selected task (click or keys) gets lines in the margin left of the list:

- a stub out, one trunk along a lane, a stub with a small arrow into each row;
- to its sub-tasks in the accent colour, to its parent in grey on a lane further out, across group headings;
- measured by layout offsets, so rows sliding to new places don't bend them;
- only for the selected task (all at once would be busy).

Ends off screen: a marker at the window's top or bottom ("↑ part of", "↓ 2 sub-tasks") scrolls to the nearest; it counts tasks, not rows (grouped by label, a task with two labels has a row and a line in each section, 0.38.1).

Esc or a click on empty space clears the selection and its lines. No automatic ticking of parents or sub-tasks.

Later: the whole tree from the selected task (trunks side by side, see BACKLOG).

### Stage 3

Stage 3 (reminders) follows.

**Ticking in the shown note (2026-10-18; issues #4, #5):** the renderer writes each checkbox's original source line in `data-line`, using the line map maintained during blank-line preprocessing. Ticking and “Copy task as Markdown” use that line. Task extraction and rendering share the parser configuration, preprocessing and checklist-token predicate in `markdown-structure.ts` (D25). Tests compare real rendered boxes against extracted tasks across quoted/list-contained fences, nested and mixed fences, indented code and blank-line combinations, and exercise the real NoteCard's clicks. Missing, fractional, negative and out-of-range source mappings are ignored; the old ordinal fallback is removed.

**Dates in pasted Markdown (2026-10-18; PR #7 follow-up):** insert the clipboard text first, then use CodeMirror's syntax tree for the resulting document to exclude fenced, indented and inline code from numeric-date conversion. The old insertion point alone cannot classify code contained in the paste or prose after a pasted closing fence. CRLF is normalized before mapping offsets; conversion remains its own undo step. Parsing is bounded to 50 ms; if the tree is unavailable, keep the paste without automatic correction rather than altering possible code. No markdown-it dependency is added to the display/editor bundles.

## D39 — The link picker: [[, << or Cmd/Ctrl+K (2026-10-16, accepted)
Refines D37. Typing `[[` or `<<` in a note (outside code) opens a search box at the cursor; the two characters make way for the link, and Esc puts them back.

`<<` because `[` takes Option+5 on a German Mac keyboard; `[[` for those used to Obsidian.

### What it lists
- With nothing typed it lists the current conversation (same subject without Re:/Fwd:/AW:/WG:) and emails with notes.
- with words, emails whose subject or sender contains them (Thunderbird's search over all accounts, about 25 hits each, stopped early, plus matching emails with notes), at most 20, ordered: this conversation, then with notes, then newest.
- Each shows subject, sender, date, folder and tags (this conversation, has notes).

### Inserting
- Arrow keys + Enter (or Tab) or a click insert the link (`[Subject – Sender, date](mid:…)`, or the selected text as link text).
- a web address typed or pasted into the box becomes a web link.

### Cmd/Ctrl+K
- Setting "Cmd/Ctrl+K opens the link picker" (on by default): Cmd/Ctrl+K opens the same picker, the selected text becoming the link text (on a bare URL it still turns it into a Markdown link).
- off, Cmd/Ctrl+K behaves as before (web links only).
- **2026-10-18:** Cmd/Ctrl+K again while the picker is open closes it like Esc, back in the note (2026-10-18; left to Thunderbird it jumped to its search box and ended the editing).

### Web addresses, one rule everywhere (2026-10-18)
what starts with https://, http:// or www. (and mailto:) is an address:
- the editor shows it as a link while writing,
- the shown note links it,
- Cmd/Ctrl+K and pasting make a Markdown link of it (a www. one gets https:// in front),
- Cmd+click and "Open link" open it.

A bare "example.com" isn't one: without a list of top-level domains it would catch "file.txt" or "node.js" (before, Cmd+K only knew https:// and http://, the shown note linked no www. at all).

## D40 — Label colours, the same on all devices: a settings carrier (2026-10-17, accepted)
Labels (D38) can have a colour: right-click a label (a chip at the top of the task view, a label in a task, in a shown note or in the editor) → "#label colour" with the eight highlight colours (D29) and "no colour", a grey dot struck through in red, so it isn't read as the colour grey.

### Look
- A label chosen as a filter in the task view keeps its own look (its colour) with a strong red ring and bold text, not a colour of its own, which got confusing next to coloured labels.
- A coloured label gets a tint of its colour and a border in a darker shade wherever it shows (task view chips and tasks, notes, editor); its text stays as it is, readable on the light tint, also on a coloured card.
- Uncoloured is the default; labels aren't coloured automatically (everything colourful, nothing stands out).

### Settings carrier
Colours belong to no email, so they don't fit the per-email carriers (D4): each IMAP account's `ThunderNotes` folder gets one **settings carrier** (same headers as a note carrier, `X-Annot-Ref: <thundernotes-settings@thundernotes.invalid>`, subject "[ThunderNotes] Settings", body a notice + `thundernotes-settings.json`).
- Merged per label, the newer choice wins; "no colour" is kept with its time, so taking a colour off reaches the other devices.
- Uploaded a moment after a change and when a pull finds this device knows more; then the older settings carriers are deleted (one remains).
- Locally the colours are in `storage.local`, so emails and the task view redraw when they change, also when sync brings them; on local or POP accounts they work but aren't synced.
- The same carrier can later carry other settings that should be equal everywhere.

**Rejected:** colours on this device only (they'd differ between computers until set twice).

**Note:** versions before 0.25.0 don't know the settings carrier and would list it as unreadable (D35).

### Label order (extended 2026-10-17, 0.28.0)
Extended 2026-10-17 (0.28.0): the labels' **order** is a setting too: most used (open tasks, then A–Z; the default), A–Z, Z–A or an own order, chosen with a ⇅ button at the start of the task view's label row (at the start so it doesn't move as labels change).
- Dragging a chip makes the own order (starting from what was shown; all chips show while dragging; the others make way as it moves, with a short slide, swapping once past a neighbour's middle, so it always sits where it would land; let go in the row and that order is kept, elsewhere or Esc it goes back).
- right-click a chip: "Move to front / left / right".
- Labels new to the own order come after it, A–Z.
- The order applies to the chips, the label sections and the Done group's "label" sort (a task's first label in this order).
- Synced in the settings carrier as a whole, the latest arrangement wins (merging two arrangements would surprise); choosing another order keeps the own one to come back to.
- One own order only: several saved orders would be overengineering; if contexts need switching, saved views (filter, grouping, order together) would be the tool, later if missed.

**Per account since D42 (2026-10-18):** each account has its own label colours and order, synced through its own settings carrier; before, one set went to every account.

**Deleting a label (2026-10-18, 0.44.0):** right-click a chip in the task view's label row → "Delete label…": asked again (how many tasks it's on, in which accounts), then taken out of every note it is in, in all accounts or in the one the view is narrowed to (D42); each change is an edit like any other (synced, open emails redrawn), with Undo for a few seconds (a note changed since is left as it is). Not in code blocks. Its colour stays in the settings (unused; it comes back should the label be used again).

## D41 — Minimum Thunderbird version: the current ESR, 153 (2026-10-17, accepted)
The add-on requires Thunderbird 153 or newer (`strict_min_version` in `manifest.json`): the current extended-support release (ESR, "Meadow", July 2026), which organisations mostly run.

- Replaces "Thunderbird ≥ 128" from the first concept, which was an assumption, never tested.
- Until 2026-10-18 tested only on Thunderbird 158 (the monthly release), not on 153 ESR; most at risk is the Experiment, which uses Thunderbird internals (print menus, message list, message pane) that change between versions.
- **Tested on 153 ESR (2026-10-18, development issue #24):** the owner ran the release checklist and synced notes between two physical computers on the same IMAP accounts, both on macOS: everything worked. The minimum stays 153. Windows and Linux aren't tested yet. Details are in the tested-version register (`docs/RELEASE.md`).
- The previous ESR line (140) isn't supported: it would need its own testing for little gain.
- **Maximum version (2026-10-18, 0.75.0):** addons.thunderbird.net requires a `strict_max_version` for add-ons with an Experiment (its upload check refuses them otherwise). It is the highest version tested, now `158.*` (153 ESR and the current release). Each new Thunderbird release needs a short test and the maximum raised (on ATN for the version already listed, and in the manifest for the next one); until then release-channel users of the newer Thunderbird can't install it. Considered: `153.*` (ESR only, no monthly upkeep, but release users shut out). Thunderbird has announced it will stop running Experiments on the release channel (reported postponed to summer 2027); then only the ESR line remains.

## D42 — Notes belong to an email in one account (2026-10-18, accepted; refines D2, D4, D27, D40)
An email's notes are identified by its Message-ID **and the account it is in**: the same message in a work and a personal account has two independent sets of notes, each synced only through its own account's `ThunderNotes` folder. Each account is its own world: work notes never reach the personal server and the other way round.

Raised by the design review (public issue #1): before, notes were one set per Message-ID for the whole profile, synced through the account where the first note was made, so a note on the personal copy could go to the work server; moving an email didn't move its notes; label settings went to every account.

### Across devices
- The account a note belongs to is where it is stored: that account's `ThunderNotes` folder. Another device reads the folder and files what it finds under its own copy of the same account. Thunderbird's internal account names ("account1"…) differ between computers and are never written into anything that syncs.
- Notes, settings and label colours of an account therefore sync between all devices that have that account, and only there.

### Locally
- The store keys a set by account and Message-ID. Sets from before (keyed by Message-ID only) keep the account they synced through; sets without one get the account of the first copy found, as before.
- Moving an email to another account (or to Local Folders) takes its notes along: they leave the old account's folder and go to the new one's. Copying doesn't copy notes.
- An account removed from Thunderbird: its notes stay on this computer, not synced; the options page says how many there are (export keeps them).
- Moved back (Thunderbird's Undo): the notes come back; carried notes count as changed at the move, so the deletion records the first move left there don't delete them.
- A save that arrives after switching emails names the email and its account, so it never lands on the same email's copy in another account. Unsaved drafts (D34) are kept per account too. Folded cards (D30) stay per Message-ID: the same email folds alike in both accounts.
- The address in an imported file only finds the account; it isn't stored or synced (else a moved set would carry the old account's address to the new server).
- A file naming an account that isn't in Thunderbird (unknown, or removed) never goes to another account (2026-10-18, 0.46.4; dev issue #4): its notes wait on this computer, unassigned, not synced, not tagged and not shown in any email. The import result and the options page (Sync) name the address; once an account with that address (any of its identities) is added, the notes go to it. Only files without an address get the account of the first copy found.
- The `$annotated` tag, backlinks and the task view's "open email" work on the copies in the note's own account.

### Label colours and order per account
- Each account has its own label colours and order (its own settings carrier, D40); Local Folders and POP accounts keep theirs on this computer. On the first start after the change every account starts with the colours and order used so far.
- A label is drawn in the colour of its note's account. In the task view across all accounts, a chip uses the colour and order of the first account (in Thunderbird's account order) that has it; coloured differently in the accounts using it, the chip (and a label heading) is split into side-by-side segments, one per distinct colour in account order, at most four, an account without a colour for it a neutral one, its tooltip naming each account's colour (0.46.0); choosing a colour or an order there applies to every account that uses the label, on a task to that task's account. In an email, a colour chosen on a card applies to that email's account only (0.46.4; before, it went to every account, dev issue #3).

### Files
- Export and import: the front matter names the account by its address (`account: you@private.example`), so an import lands in the matching account on any computer; files without it get the account of the first copy found. Two sets of the same email get different file names.
- The task view shows all accounts, each task with its account; a filter narrows it to one account.

## D43 — Deleted emails are left alone (2026-10-18, accepted)
An email moved to the Trash is ignored by ThunderNotes: its tasks leave the task view and the overdue count, and its notes are no longer offered by the link picker or shown as backlinks. The notes themselves are kept (and synced as before): restored from the Trash, the email has them all again.

- An email counts as deleted when every copy of it in its account (carrier folders aside) is in a folder Thunderbird marks as Trash (`specialUse: trash`). A copy elsewhere (the Sent copy, the inbox) keeps it alive.
- Deleted for good (emptied from the Trash): ignored the same way. An email Thunderbird merely can't find is never taken as deleted: a failed lookup must not hide notes.
- Kept up to date when emails are moved, copied or deleted, and checked once a little after Thunderbird starts (emails deleted while the add-on wasn't running, or before this decision). The list lives on this device (`deletedEmails` in local storage); each device works it out from its own folders.
- Not included: the Junk folder (could be added the same way if wanted).

## D44 — Notes whose email can't be found (2026-10-18, accepted)
An email removed outside Thunderbird (in webmail, another client, on the server) just vanishes from its folder; Thunderbird doesn't report that as a deletion, and its notes, safely in their carrier, stay. They are kept, never hidden by themselves (a failed lookup must not hide notes, D43), but shown as what they are and deletable:

- When Thunderbird starts (a little later) and whenever the task view or the options page opens (at most once a minute), every email with notes is looked up in its account. Not found: marked "missing" (in the same local list as D43).
- Task view: such a task's email line reads "<subject> – email not found", the last words red, bold and italic (nothing to open; the arrow still shows the whole note). Hovering it shows: "This task comes from a note in an email that's not on the server anymore. The recommended action is to delete the notes that relate to that email in the settings", "settings" a link to the options page, which scrolls to that email in the list and frames its Delete button for a moment. The marker itself is a link too (0.45.3): both open the settings in a tab of their own (inside the Add-ons Manager the page can't scroll to a section), jumping straight to "Orphaned notes"; a settings tab open already is brought to the front. No action on the task's own menu (0.45.1): a task's menu acting on a whole note was unexpected.
- Options page, a card "Orphaned notes" of its own (shown only when there are any, between "Sync" and "Devices", 0.45.2): a list of the notes whose email can't be found (subject, date, account, how many), each with Show (all its notes as text, also those without tasks) and Delete (two clicks).
- Deleting is an ordinary deletion of every note on the email: synced (the carrier then holds only deletion records, D33).
- Found again (the account synced late, the email restored): the mark goes by itself.

## D45 — Sync and merge specification (2026-10-18, accepted; design review, public issue #1 P1.1)
The rules devices follow to combine notes are written down as a normative specification, `docs/SYNC.md`: the model (one set per email and account, carriers as revisions), what `rev`, the times and the bases mean, the merge per part (text three-way against a common base, colour, passage, deletion), the order of merging, cleanup, uploading, editing while sync runs, import, and the known limits. Its scenarios are tests ("merge spec scenarios" in `packages/thunderbird/test/sync.test.ts`, and unit tests in core and the background).

`rev` is a revision counter per writer, not proof of what a carrier contains: correctness comes from the merge (bases, deletion times), and `rev` only names and orders carriers.

Writing the scenarios as tests found four gaps, fixed with it (0.48.0):
- **Several bases.** A carrier named only its writer's newest synced text as the base. After a merge (A combining C's edit) that is a text other devices may never have seen, so a third device found no base and made a conflict box although no line was changed twice. Carriers now list the hashes of every synced text their writer remembers, newest first (`text_bases`, `email_note_bases`; `text_base` stays the first, so 0.47.0 still reads them); the receiver merges against the newest it has too.
- **Oldest first.** A device finding several revisions of one email at once merged them in the server's order; the newest first left the older ones without a known base (a conflict box on a new device). They are merged oldest first now (headers' time, revision, Message-ID).
- **Editing while sync runs.** An open editor isn't replaced by incoming changes, but saving then overwrote a change that had arrived meanwhile (and the upload spread the loss). A save now sends the text the edit started from; if the stored text changed since, both are combined line by line, a line changed differently on both becoming a conflict box.
- **Equal-time colours.** Two colours chosen at the same moment: each device took the other's, swapping until a later stamp settled it. In sync the greater colour name now wins on both.

Follow-up (0.48.1, development issue #14): the upload backstop no longer compares independent devices' revision counters. Each device records the exact local `rev` and `updated` and the readable carrier known to represent them. If the local state changes or that carrier disappears, the next periodic check uploads. This closes the case where another device replaced the last carrier with the same revision while a local edit was waiting.

Considered: a CRDT for note texts (exact convergence, but per-character metadata in the files and no readable Markdown), vector clocks per note (exact "contains", but more machine data per carrier than the merge needs). The base list gets the cases that occur right with plain text and hashes.

Follow-up (2026-10-18, 0.48.5, development issue #16): note analysis uses one parse of the source to preserve source structure and one parse of the prepared Markdown to derive code and checklist line maps together. Consumers reuse that shared result instead of independently parsing for code and tasks.
