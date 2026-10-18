# Releasing ThunderNotes

## Building from source (also for add-on reviewers)

Requirements: Node.js 22 or newer with npm (developed with Node 26, npm 11), macOS, Linux or Windows.

```sh
npm ci                 # exact dependency versions from package-lock.json
npm test               # unit tests (core and the Thunderbird add-on)
npm run package        # builds everything, then writes build/thundernotes-<version>.xpi
```

The `.xpi` contains `manifest.json`, the HTML pages and `content.css`, `icons/`, the Experiment
(`experiments/thundernotes/`), `LICENSE` and the scripts bundled by esbuild in `dist/`
(`background.js`, `content.js`, `live-editor.js`, `popup.js`, `options.js`, `tasks.js`, `result.js`).
They are built from `packages/thunderbird/src/` and `packages/core/src/` (TypeScript) by
`packages/thunderbird/build.mjs` (esbuild, minified; `npm run package` rebuilds them exactly).
Third-party code in the bundles: CodeMirror 6 and Lezer (MIT), markdown-it and its dependencies
(MIT), DOMPurify (MPL-2.0 or Apache-2.0), yaml (ISC), approx-string-match (MIT), node-diff3 (MIT),
fflate (MIT), all at the versions in `package-lock.json`.

The Experiment (`experiments/thundernotes/implementation.js`, plain JavaScript, not built) does
what no MailExtension API offers: keeps the ThunderNotes sync folder subscribed, out of global
search and checked for new messages (and expunges it after deleting old carriers), adds the
ThunderNotes column to the message list, adds "Print with Notes" to Thunderbird's print menus,
moves the keyboard focus into the message pane or a tab, and reads the computer's name for the
default device name. See `docs/DECISIONS.md` (D19, D20, D23, D26, D36).

## Release checklist

1. **Version.** `packages/thunderbird/manifest.json` has the version to publish (higher than the
   last published one). The add-on ID `thundernotes@webterminate.com` never changes (D17).
   `strict_max_version` covers the newest Thunderbird you tested (required by ATN because of the
   Experiment, D41).
2. **Tests.** `npm test` passes (vitest's own exit code; also no "Errors" / unhandled errors).
3. **Committed.** Everything is committed: `npm run package` refuses otherwise, as the source zip
   must match the add-on.
4. **Package.** `npm run package` writes to `build/`:
   - `thundernotes-<version>.xpi`, the add-on;
   - `thundernotes-<version>-source.zip`, the committed sources, for the review.
   It checks that every file the manifest and the pages refer to is in the package.
5. **Install test in a clean profile.** `thunderbird -P` → a new profile (not `Development`) →
   Add-ons Manager → gear → *Install Add-on From File…* → the `.xpi` (installed the normal way,
   not as a temporary add-on). Check:
   - highlight, note, edit, delete; the margin and lines; the popup list;
   - the task view (toolbar button and the left spaces toolbar), ticking a task;
   - an IMAP account: the ThunderNotes folder appears, a note syncs (second profile or device);
   - Print with Notes; export and import (with settings);
   - the options page; restart Thunderbird: the add-on and the notes are still there.
   Run this on the minimum supported Thunderbird version. Add each completed run to the tested-version register below; a second profile is useful for the checklist, but it is not evidence for sync between two physical computers.
6. **Release notes.** What changed since the last published version, in plain words.
7. **Publish.**
   - addons.thunderbird.net: follow `docs/ATN-SUBMISSION.md` (steps, listing texts, privacy
     policy, notes to reviewers). Upload the `.xpi` and the source zip; the source zip's README is
     `docs/BUILDING.md` with the versions and the `.xpi`'s checksum filled in. The `.xpi` is
     reproducible: CI prints the same checksum as `npm run package`. The Experiment and the bundled
     scripts are reviewed by people, so allow time.
   - Or self-hosted: attach the `.xpi` to a release (users install it from file); automatic updates
     then need an `update_url` in the manifest and an `updates.json` next to the releases.
8. **Tag.** `git tag v<version> && git push --tags` (in the private repository).
9. **Public repository.** `scripts/publish-public.sh <version>` shows what would be published;
   with `--push` it publishes. The public repository `flofrie/thundernotes` gets one commit per
   release ("ThunderNotes <version>"), made from the private repository's current commit without
   `spikes/` (the private history stays private), tagged `v<version>`, and a GitHub
   release with the `.xpi` from step 4.

## Tested-version register

Record the exact Thunderbird build, OS, mail server, date, test profile/device setup, and result for each real install test. Keep missing details explicit; do not infer a clean-profile or cross-computer test from unit tests or a second profile.

| Thunderbird | OS | Mail server | Date | Setup and result |
| --- | --- | --- | --- | --- |
| 153 ESR (exact build not recorded) | macOS on both computers (versions not recorded) | The owner's own mail server (IMAP) | 2026-10-18 | Pass. The owner ran the steps in development issue #24: the release checklist above, and notes syncing between two physical computers on the same IMAP accounts. ThunderNotes version not recorded. |
| 158 (exact build not recorded) | Not recorded | Not recorded | Not recorded | Existing development record says 158 was tested; the test scope/result was not recorded. Clean-profile and two-physical-computer evidence is not established by the available record. |
