# ThunderNotes — instructions for agents and contributors

Thunderbird add-on to highlight text in emails and attach Markdown notes; notes sync across clients via a dedicated IMAP folder. Owner: Florian (GitHub `flofrie`). Development happens in the private repo `flofrie/thundernotes-dev` (full history); releases go to the public repo `flofrie/thundernotes` (one commit per release, without `spikes/`) via `scripts/publish-public.sh <version> --push` (`docs/RELEASE.md`).

This file is the one set of instructions for every agent (Codex, Cursor, Claude …) and every contributor. `CLAUDE.md` only imports it, so Claude Code loads the same text.

## Read first
- `docs/DECISIONS.md` — D1–D47, the binding design decisions. Add new ones there (dated, numbered).
- `docs/SYNC.md` — the normative sync and merge specification (D45); keep it in step with `mergeSets` and `sync.ts`.
- `BACKLOG.md` — work by phase; tick items off as they land.
- `docs/concept.md` — the concept (design, data model, formats, IMAP protocol): a snapshot of the owner's living concept doc (https://claude.ai/code/artifact/00ed577b-af03-453c-85d1-e1a3382b6f58, private), refreshed from time to time.

## Key decisions in one breath
- Usability is top-tier (D16): installs like any add-on, no separate login/software/setup for core features. Anything needing more is opt-in.
- TypeScript monorepo (D13): `packages/core` (client-independent: data model, W3C TextQuote/TextPosition anchoring, Markdown+YAML, tasks, merge), `packages/thunderbird` (MailExtension, MV3, TB ≥153, the current ESR; D41), `packages/helper` (optional native host for local Markdown folder + Git), later `packages/outlook`.
- Anchoring against the visible text of the current view; position → quote → context → loose → fuzzy → partial/orphan (D3, D21).
- Note editor: CodeMirror 6 live preview (Obsidian-style), slim build loaded on demand via a web-accessible `import()` (D28; textarea as fallback); rendering for viewing in the background (D22). Cards live in a Word-style right margin; the email narrows to make room, never covered (D23). A highlight is a note with empty text; click to edit, leave to save, Esc discards, 🗑 deletes (D24).
- File format 2: Markdown per email, machine data in YAML front matter, collision-free `body_boundary` separator lines around the existing marked-heading sections (D25; `core/src/format.ts`). Version 1 development files are rejected by the add-on; `scripts/migrate-format2/` converts carriers on the server and export zips once. Markdown syntax/source positions come from the shared markdown-it pipeline in `core/src/markdown-structure.ts`.
- Email identity = Message-ID (D2). One annotation set / file / carrier message per email (D4).
- IMAP sync runs inside the Thunderbird add-on via Thunderbird's mail APIs (D14): carrier messages in a folder `ThunderNotes` per IMAP account (local/POP not synced, D27) that stays subscribed and visible, excluded from global search by a minimal Experiment API (D19; the same Experiment adds a ThunderNotes message-list column, D26); if the user deletes it, it is restored with a notice explaining how to remove it for good (D20); headers `X-Annot-Version/Ref/Rev/Updated/Client`, body = text/plain notice + Markdown as text/markdown attachment, always \Seen; update = import new rev (fresh Message-ID) + delete old; delete = tombstone (D7). Gmail: visible carriers accepted (D8). No encryption by default (D9).
- Outlook later only as modern add-in for Microsoft 365/Exchange mailboxes, storage via Microsoft Graph hidden folder; Outlook+IMAP is unsupported by Microsoft (D15).
- Add-on ID `thundernotes@webterminate.com` — never change (D17). Licence MPL-2.0, header in every source file (D18).

## Environment (the owner's setup)
- macOS, repo at `~/claude-space/thundernotes`. Thunderbird profile `Development` (`thunderbird -P Development`) with a throwaway test IMAP account on Florian's own mail server.
- Load add-ons via Tools → Developer Tools → Debug Add-ons → Load Temporary Add-on (pick `manifest.json`).
- The owner commits as `Florian Friedrich <flofrie@users.noreply.github.com>`; contributors use their own name and email.

## Status (2026-10-20)
- Version **0.78.8** on `main`; the public repo has **0.75.0** (released 2026-10-18; the step before 1.0). Build: `npm run build -w @thundernotes/thunderbird`, then load `packages/thunderbird/manifest.json`.
- Built:
  - **Message list:** the ThunderNotes column, the post-it on cards and a one-line preview of the whole-email note there (D26).
  - **Notes:** highlights and Markdown notes in margin cards with lines to their passages (D23, D24); highlights and notes on pictures (D46); whole-email note; notes in the empty space beside an email's content, narrowing only as needed (D23); live-preview editor (D28); colours (D29); folding (D30); drafts kept on a crash (D34); restore deleted notes (D33); print with notes; copy a task, a note or all notes as Markdown.
  - **Sync:** one carrier per email in a `ThunderNotes` folder per IMAP account (D7, D27, D42); merge per part with conflict boxes, several bases per carrier and merging oldest first (D32, D45, `docs/SYNC.md`); deletion records kept a year (D33); unreadable carriers kept and listed (D35); folder restored or subscribed again (D20, D36); label settings per account in a settings carrier (D40, D42); a persisted upload marker (#14); Experiment failures shown in Settings (#12).
  - **Tasks and links:** due dates and labels in checklist items (D38); a task view with filters, grouping, sub-tasks, quick actions and an overdue count; links between emails, backlinks and a link picker (D37, D39).
  - **Accounts and emails:** notes per account, following moved emails (D42); emails in the Trash left alone (D43); notes whose email is gone marked and deletable (D44); no notes on messages without a Message-ID (#8).
  - **Files:** format 2 with separator lines (D25), JSON Schemas in `docs/schemas/`; one markdown-it pipeline for rendering and tasks, kept out of the display script (D22); export and import with `settings.json`, imports repaired instead of failing.
- The spikes in `spikes/imap-folder/` and `spikes/highlight-anchor/` (results in their READMEs) led to D19 and D21.
- Tested by the owner in Thunderbird 158 (`Development` profile): re-subscribing (D36), sync warnings (D35), links, backlinks and the link picker (D37, D39), dates and labels, label colours and order, grouping, Done sorting, and 0.47.0 after the format-2 migration.
- Tested by the owner in Thunderbird 158 during development (2026-10-19/20): the post-it and note previews in the message list's cards view (0.78.8), settings in a tab of their own and the 3D post-it (0.77.x), emails that size their root element (0.75.2).
- Not yet tested in Thunderbird: the popup's "Note on this email" always editing (0.75.1), picture notes (0.76.0), notes in the empty space beside the content (0.76.1), quick actions (0.29.0), "Delete for good" in the popup (0.30.0), sub-tasks (0.38.0), and the 0.48.x changes (editing while sync runs, list rendering, the Message-ID notice). Thunderbird 153 ESR, with sync between two physical computers on the same IMAP accounts, was tested by the owner on macOS on 2026-10-18 and works (#24); Windows and Linux aren't tested yet.

## Next steps
- Open work is in the dev repo's GitHub issues and in `BACKLOG.md`.
- Then: reminders for dated tasks (D38 stage 3); the whole sub-task tree in the task view; Gmail (D8; `messages.import` on Gmail needs a test account); the optional helper (phase 3).

## Conventions
- Keep `core` free of Thunderbird/Outlook/Node APIs.
- Update `DECISIONS.md` and `BACKLOG.md` in the same commit as the change they describe.
- Explain trade-offs to Florian in plain terms; he prefers seeing options with a clear recommendation.

## Rules for every change

Contributions from outside: see `CONTRIBUTING.md`. Pull requests on the public repo aren't merged there; the owner applies accepted ones in the dev repo (with the contributor as `Co-authored-by`), and they ship with the next release.

Follow every rule. If a rule and the task conflict, stop and ask; don't choose yourself.

### 1. Before you change anything
1. Read this file, the issue, and every file you will touch, in full.
2. Find everything that uses the code you will change: `grep -rn "<function or CSS class>" packages/`. Write down the list.
3. If the issue asks for a decision ("decide", "recommend"), don't decide. Write 2–3 options with a recommendation in the PR description and wait for the owner.

### 2. Never do these without the owner's explicit OK
- Change a product decision: anything in `docs/DECISIONS.md`, the minimum Thunderbird version, file formats, what users see or lose.
- Weaken, delete or invert an existing test. If a test fails after your change, your change is wrong until proven otherwise. Explain the failure in the PR and stop.
- Add a dependency. If allowed: pin an exact version at least 14 days old (`npm view <pkg> time`), test-only unless runtime is required.
- Delete or rewrite lines in `BACKLOG.md`, `DECISIONS.md` or docs that aren't about your issue. After a rebase, run `git diff main -- BACKLOG.md docs/` and check that only your lines changed.

### 3. While changing
- Keep the change minimal and on the issue. No unrelated refactoring.
- New source files start with the MPL-2.0 header (copy it from any existing `.ts` file).
- Code that runs in the email view (`content.ts`, `card.ts`, `margin.ts`, `editor.ts`) must stay small. Don't import anything there that pulls in markdown-it or other heavy code; `packages/thunderbird/test/bundle.test.ts` must pass.
- Thunderbird APIs: check the signature at https://webextension-api.thunderbird.net/en/mv3/. Don't guess.

### 4. Testing: all of these, every time
1. `npm test`: the **whole** suite, core **and** Thunderbird. Read vitest's own exit code; "core passed" is not enough. CI (`.github/workflows/ci.yml`) runs the same on every PR; a PR is only ready when CI is green.
2. `npm run typecheck`, `npm run build`, `git diff --check`.
3. Write a test that **fails without your change** and passes with it. Prove it: revert your source change, run the test, see it fail, restore.
4. **Test the consequences, not only the target.** For every user found in step 1.2, ask: "Does this behave differently now?" Especially:
   - **Rendering** (`markdown.ts`, `markdown-structure.ts`, card CSS): render 10 ordinary notes (lists with and without blank lines, tasks, numbered and nested lists, quotes, code) on `main` and on your branch, and diff the HTML. Explain every difference, and check that the CSS selectors in `card.ts` and `tasks.html` still match the new HTML.
   - **Anchoring** (`anchoring/`): run `anchor()` on cases where `main` succeeds: quotes at the start, middle and end of a text; whole short texts; one or two words changed; repeated text. Any case `main` places and yours doesn't is a regression unless the issue asks for it.
   - **Sync** (`sync.ts`): check the rules in `docs/SYNC.md` and D35 (offline never warns; folder problems warn after two failures in a row).
5. A test that only checks that a string is in a file (e.g. CSS text) is not a test of behaviour. Test the effect.

### 5. Finishing a PR: required checklist
- [ ] Version bumped in `packages/thunderbird/manifest.json` for any change in behaviour, and the status line in this file updated.
- [ ] `docs/DECISIONS.md` entry dated `(YYYY-MM-DD, version, issue #N)`, short and plain.
- [ ] `BACKLOG.md`: only your item changed; ticked, describing what was done.
- [ ] `docs/concept.md` updated if behaviour described there changed. Say so in the PR, so the owner can update the living concept doc.
- [ ] PR description matches the final code. Update the title and text after every revision.
- [ ] `Closes #N` only if the issue's "done when" is fully met; otherwise `Refs #N`, saying what remains.
- [ ] The PR lists exactly what you ran and the results, with test counts for core and Thunderbird.
- [ ] Rebased onto current `main`, no conflicts.

### 6. When unsure
Stop and write the question in the PR or issue. A clear question is better than a confident guess.
