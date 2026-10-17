/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Packages the add-on for release (docs/RELEASE.md), after `npm run build`:
// - build/thundernotes-<version>.xpi: what Thunderbird installs (manifest, pages, built scripts
//   without source maps, icons, the Experiment, the licence);
// - build/thundernotes-<version>-source.zip: the committed sources (git archive of HEAD), for the
//   review on addons.thunderbird.net, which needs to rebuild the bundled scripts.
// Refuses with uncommitted changes (the source zip would not match the add-on); --allow-dirty overrides.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(root, "build");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const version = manifest.version;
const fail = (message) => {
  console.error(`package: ${message}`);
  process.exit(1);
};

const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
if (dirty && !process.argv.includes("--allow-dirty")) fail(`uncommitted changes; commit first (or --allow-dirty):\n${dirty}`);

/** All files under a folder, as paths relative to the add-on. */
const walk = (dir) =>
  readdirSync(join(here, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(here, path)).isDirectory() ? walk(path) : [path];
  });

const files = [
  "manifest.json",
  ...readdirSync(here).filter((f) => f.endsWith(".html") || f.endsWith(".css")),
  ...walk("icons"),
  ...walk("experiments"),
  ...readdirSync(join(here, "dist")).filter((f) => f.endsWith(".js")).map((f) => `dist/${f}`),
];

// Everything the manifest and the pages refer to must be in the package.
const referenced = [
  ...(manifest.background?.scripts ?? []),
  manifest.options_ui?.page,
  manifest.message_display_action?.default_popup,
  ...Object.values(manifest.icons ?? {}),
  manifest.action?.default_icon,
  manifest.message_display_action?.default_icon,
  ...(manifest.web_accessible_resources ?? []).flatMap((r) => r.resources),
  ...Object.values(manifest.experiment_apis ?? {}).flatMap((api) => [api.schema, api.parent?.script]),
  ...files.filter((f) => f.endsWith(".html")).flatMap((page) => [...readFileSync(join(here, page), "utf8").matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])),
].filter((f) => typeof f === "string");
const missing = [...new Set(referenced)].filter((f) => !files.includes(f));
if (missing.length) fail(`referenced but not packaged (built?): ${missing.join(", ")}`);

const entries = Object.fromEntries(files.map((f) => [f, readFileSync(join(here, f))]));
entries.LICENSE = readFileSync(join(root, "LICENSE"));
mkdirSync(out, { recursive: true });
const xpi = join(out, `thundernotes-${version}.xpi`);
writeFileSync(xpi, zipSync(entries, { level: 9 }));

const source = join(out, `thundernotes-${version}-source.zip`);
execFileSync("git", ["archive", "--format=zip", `--prefix=thundernotes-${version}/`, "-o", source, "HEAD"], { cwd: root });

const kb = (path) => `${Math.round(statSync(path).size / 1024)} KB`;
console.log(`package: ${relative(root, xpi)} (${files.length + 1} files, ${kb(xpi)})`);
console.log(`package: ${relative(root, source)} (${kb(source)})${dirty ? "  [uncommitted changes not in it]" : ""}`);
if (!existsSync(join(root, "docs", "RELEASE.md"))) console.warn("package: docs/RELEASE.md missing (the reviewers' build instructions)");
