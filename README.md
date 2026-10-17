# ThunderNotes

Highlight text in your emails and attach Markdown notes, right inside Thunderbird. Notes sync
between your computers through your own mail server, and stay plain files you own.

## What it does

- **Highlights and notes.** Select text in an email and highlight it in one of eight colours; add a
  note to it, or to the whole email. Notes sit in a margin beside the email, like comments in a
  word processor, and never cover it. Optional lines connect each note to its passage.
- **A real Markdown editor.** Live preview while you type (headings, lists, checkboxes, links),
  links to web pages and to other emails, with backlinks.
- **Tasks.** Every checklist item in a note (`- [ ] …`) is a task. `@friday` or `@24.10.` gives it
  a date, `#name` a label. A task view collects all tasks from all notes: grouped by date, label or
  email, filtered, with sub-tasks, quick actions and a count of overdue tasks on its button.
- **Sync without an account.** Notes travel through a `ThunderNotes` folder in each IMAP account,
  using Thunderbird's own mail access. No extra login, server or software; edits from two
  computers are combined line by line.
- **Yours to keep.** Export all notes as Markdown files (one per email, with YAML front matter)
  plus your settings; import them again. Print an email with or without its notes.
- **Private.** Nothing leaves your computer except to your own mail server. No analytics, no third
  parties.

Requires Thunderbird 153 (the current extended-support release, ESR) or newer. Emails in local folders and POP accounts can be annotated too,
but aren't synced (export is their backup).

## Install

Download `thundernotes-<version>.xpi` from the [releases](../../releases), then in Thunderbird:
*Tools → Add-ons and Themes → gear icon → Install Add-on From File…*

## Documents

- [Concept](docs/concept.md): design, data model, file format, IMAP protocol
- [Decisions](docs/DECISIONS.md): every design decision, with its reasons
- [Backlog](BACKLOG.md): what is done and what is planned
- [Releasing](docs/RELEASE.md): building from source, packaging, release checklist

## Layout

```
packages/
  core/          data model, anchoring, Markdown/YAML, tasks, merge rules (no client code)
  thunderbird/   the Thunderbird add-on (MailExtension, Manifest V3)
  helper/        planned: optional native helper (local Markdown folder + Git)
```

Planned later: an Outlook add-in for Microsoft 365/Exchange mailboxes, sharing the same core.

## Development

- Node.js 22 or newer: `npm ci`, then `npm test` and `npm run build`
- Load the add-on in a separate Thunderbird profile: *Tools → Developer Tools → Debug Add-ons →
  Load Temporary Add-on…* → `packages/thunderbird/manifest.json`
- `npm run package` builds the installable `.xpi` (see [Releasing](docs/RELEASE.md))

## Licence

[Mozilla Public License 2.0](LICENSE). Source files carry the MPL header.
