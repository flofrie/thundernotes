/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Bundles the background and the message display script into dist/.
// `node build.mjs --watch` rebuilds on change; then click Reload in Debug Add-ons.

import * as esbuild from "esbuild";

const options = {
  entryPoints: { background: "src/background.ts", content: "src/content.ts", options: "src/options.ts", popup: "src/popup.ts", result: "src/result.ts", tasks: "src/tasks.ts" },
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "firefox128",
  sourcemap: "linked",
  minify: true,
  logLevel: "info",
};

// The live-preview editor (D28): its own ES module, imported on demand by the display script.
const live = {
  ...options,
  entryPoints: { "live-editor": "src/live/editor.ts" },
  format: "esm",
  minify: true,
};

if (process.argv.includes("--watch")) {
  await (await esbuild.context(options)).watch();
  await (await esbuild.context(live)).watch();
} else {
  await esbuild.build(options);
  await esbuild.build(live);
}
