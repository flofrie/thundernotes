/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Packages the add-on for release (docs/RELEASE.md), after `npm run build`:
// - build/thundernotes-<version>.xpi: what Thunderbird installs (manifest, pages, built scripts
//   without source maps, icons, the Experiment, the licence);
// - build/thundernotes-<version>-source.zip: what the review on addons.thunderbird.net needs to
//   rebuild the bundled scripts: the committed files the build uses (no tests, spikes, scripts or
//   design documents), with docs/BUILDING.md as its README (versions and the .xpi's checksum filled in).
// The .xpi is reproducible: files sorted, a fixed date, so every machine builds the same bytes.
// In a git checkout it refuses uncommitted changes (the source zip would not match the add-on;
// --allow-dirty overrides). Outside git (a reviewer building from the source zip) it only builds the .xpi.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(root, "build");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const version = manifest.version;
const fail = (message) => {
  console.error(`package: ${message}`);
  process.exit(1);
};

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
let inGit = true;
try {
  git("rev-parse", "--is-inside-work-tree");
} catch {
  inGit = false;
}
const dirty = inGit ? git("status", "--porcelain").trim() : "";
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

// A fixed date in local time: zip stores local date fields, so the bytes don't depend on the time zone.
const FIXED_DATE = new Date(2026, 0, 1, 0, 0, 0);
const zip = (entries) =>
  zipSync(Object.fromEntries(Object.keys(entries).sort().map((name) => [name, [entries[name], { mtime: FIXED_DATE }]])), { level: 9 });
const kb = (path) => `${Math.round(statSync(path).size / 1024)} KB`;

const entries = Object.fromEntries(files.map((f) => [f, readFileSync(join(here, f))]));
entries.LICENSE = readFileSync(join(root, "LICENSE"));
mkdirSync(out, { recursive: true });
const xpi = join(out, `thundernotes-${version}.xpi`);
const xpiBytes = zip(entries);
writeFileSync(xpi, xpiBytes);
const sha256 = createHash("sha256").update(xpiBytes).digest("hex");
console.log(`package: ${relative(root, xpi)} (${files.length + 1} files, ${kb(xpi)})`);
console.log(`package: sha256 ${sha256}`);

if (inGit) {
  // The reviewers' source archive: only what `npm ci && npm run package` needs.
  const wanted = (path) =>
    ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.base.json", "LICENSE"].includes(path) ||
    /^packages\/core\/(package\.json|tsconfig\.json|src\/)/.test(path) ||
    (path.startsWith("packages/thunderbird/") && !/\/test\/|vitest\.config/.test(path));
  const sources = git("ls-files").split("\n").filter(Boolean).filter(wanted);
  const pkg = (dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  const deps = { ...pkg("packages/core").dependencies, ...pkg("packages/thunderbird").dependencies };
  const readme = readFileSync(join(root, "docs", "BUILDING.md"), "utf8")
    .replaceAll("{{version}}", version)
    .replaceAll("{{sha256}}", sha256)
    .replaceAll("{{node}}", process.versions.node)
    .replaceAll("{{npm}}", execFileSync("npm", ["-v"], { encoding: "utf8" }).trim())
    .replaceAll(
      "{{dependencies}}",
      Object.entries(deps)
        .filter(([name]) => !name.startsWith("@thundernotes/")) // our own workspace, in this archive
        .sort()
        .map(([name, v]) => `- \`${name}\` ${v}: https://www.npmjs.com/package/${name}/v/${v}`)
        .join("\n"),
    );
  const prefix = `thundernotes-${version}/`;
  const archive = Object.fromEntries(sources.map((f) => [prefix + f, readFileSync(join(root, f))]));
  archive[`${prefix}README.md`] = strToU8(readme);
  const source = join(out, `thundernotes-${version}-source.zip`);
  writeFileSync(source, zip(archive));
  console.log(`package: ${relative(root, source)} (${sources.length + 1} files, ${kb(source)})${dirty ? "  [includes uncommitted changes: not for release]" : ""}`);
}
