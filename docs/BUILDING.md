# ThunderNotes {{version}}: building from source (for add-on review)

This archive is the source of ThunderNotes {{version}}, a Thunderbird add-on, for review on
addons.thunderbird.net. Its build bundles and minifies the add-on's TypeScript with esbuild, so
the submitted `.xpi` is rebuilt from these files. The build is reproducible: following the steps
below gives a byte-identical `.xpi`.

## Requirements

- **OS:** Ubuntu 24.04 (any recent Linux or macOS gives the same result; checked on Ubuntu with
  Node.js 22 and 26, and on macOS).
- **Node.js {{node}}** with **npm {{npm}}**: https://nodejs.org/dist/v{{node}}/ (or via
  https://github.com/nvm-sh/nvm: `nvm install {{node}}`). Check the npm version with `npm -v`;
  if it differs: `npm install -g npm@{{npm}}`.
- No other tools, no network services besides the npm registry for `npm ci`.

## Build

From the folder this README is in:

```sh
npm ci            # installs the exact versions in package-lock.json
npm run package   # type-checks, bundles, and writes build/thundernotes-{{version}}.xpi
sha256sum build/thundernotes-{{version}}.xpi
```

The checksum must be:

```
{{sha256}}
```

## What the build does

- `packages/core/src/` and `packages/thunderbird/src/` (TypeScript) are type-checked (`tsc -b`) and
  bundled by esbuild (`packages/thunderbird/build.mjs`) into `packages/thunderbird/dist/*.js`,
  minified, without source maps in the package.
- `packages/thunderbird/package.mjs` packs those bundles with the files that are copied
  unchanged: `manifest.json`, the HTML pages and `content.css`, `icons/`, the Experiment
  (`experiments/thundernotes/implementation.js` and `schema.json`, plain JavaScript, not built)
  and `LICENSE`. Files are sorted and carry a fixed date, so the `.xpi` is the same on every
  machine.

## Third-party code in the bundles

Only release versions from npm, unmodified, declared with exact versions and resolved in
`package-lock.json` (which also lists their own dependencies):

{{dependencies}}

`npm ls --omit=dev --all` lists the complete tree.

## The Experiment

`experiments/thundernotes/` does what no WebExtension API offers (each checked against the
Thunderbird MV3 API reference): keep the add-on's IMAP folder subscribed, out of global search and
checked for new mail, expunge it after removing old messages, add a message-list column (and its icon and a note preview on the cards view's cards), add
"Print with Notes" to Thunderbird's print menus, move the keyboard focus into the message pane or
a tab, and read the computer's name for the default device name.

The project's full repository, with tests and design documents, is public:
https://github.com/flofrie/thundernotes
