# Contributing to ThunderNotes

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or an idea

Open an issue. For a bug, say what you did, what you expected and what happened, plus:
- your Thunderbird version (*Help → About Thunderbird*) and operating system;
- the ThunderNotes version (*Tools → Add-ons and Themes*);
- the kind of account (IMAP, POP, Local Folders) and, for sync problems, the mail server or provider;
- for a note that shows in the wrong place or not at all: the email's view (*View → Message Body As*), and if you can, a small example email without private content.

Please don't paste private email content or passwords into issues.

**Security problems:** don't describe them in a public issue. Open an issue that only says you have a security report, and the maintainer will contact you.

## Before you write code

- **Open or comment on an issue first** for anything bigger than a small fix, so we can agree on the approach before you spend time on it. Design decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md); a change that goes against one needs that discussion.
- **Read [AGENTS.md](AGENTS.md).** It holds the project context and the rules every change follows, whether a person or an AI agent writes it: test what your change affects, not only what it targets; never weaken an existing test; no new dependencies without agreement.

## Making a pull request

1. Fork the repository, create a branch, and make your change.
2. Run the whole suite (Node.js 22 or newer):
   ```sh
   npm ci
   npm test           # core and Thunderbird tests
   npm run typecheck
   npm run build
   ```
   CI runs the same on your pull request (first-time contributors' runs start once the maintainer approves them).
3. Add or change tests so that they fail without your change and pass with it.
4. If you can, try it in Thunderbird: *Tools → Developer Tools → Debug Add-ons → Load Temporary Add-on…* → `packages/thunderbird/manifest.json`, in a separate profile.
5. Open the pull request: what it changes and why, which issue it fixes, and what you tested.

New source files carry the MPL-2.0 header (copy it from any existing file). By contributing you agree that your contribution is licensed under the [Mozilla Public License 2.0](LICENSE), like the rest of the project.

## What happens to your pull request

This repository receives **one commit per release**. Day-to-day development happens in a private repository, and each release is published here from it. A pull request merged here directly would be overwritten by the next release, so contributions take a short detour:

1. The maintainer reviews your pull request here; CI must be green.
2. If it's accepted, the maintainer applies it in the development repository, with you credited as co-author of that commit, and adjusts it there if needed.
3. It ships in the next release. The release notes name your contribution.
4. Your pull request is then closed with a link to that release, not merged.

If changes are needed, the review says so on your pull request, and you can update it there as usual.
