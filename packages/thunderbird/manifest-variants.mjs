/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The two packages of a release (package.mjs, D41): the one for addons.thunderbird.net keeps the
// manifest's highest Thunderbird version (ATN requires it for an add-on with an Experiment); the
// one attached to GitHub releases has none, so Thunderbird installs it on newer, untested versions
// too. Only that line differs, so the rest of the manifest stays byte for byte as committed.

const MAX_LINE = /,(\s*\n\s*)"strict_max_version":\s*"[^"]*"/;

/** The highest Thunderbird version in the manifest's text, or null. */
export function maxVersion(manifestText) {
  return /"strict_max_version":\s*"([^"]*)"/.exec(manifestText)?.[1] ?? null;
}

/** The manifest's text without its highest Thunderbird version; throws if it has none to remove. */
export function withoutMaxVersion(manifestText) {
  if (!MAX_LINE.test(manifestText)) throw new Error("manifest.json has no strict_max_version line after another setting");
  return manifestText.replace(MAX_LINE, "");
}
