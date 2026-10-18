/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { schemaExample, schemaValidator } from "../../../test/schemas.js";
import { buildSettingsFile, parseSettingsFile, type SettingsFile } from "../src/settings-file.js";

const validate = schemaValidator("settings-file-1.schema.json");

describe("export settings.json schema", () => {
  it("validates the reference and a generated export with per-account settings", () => {
    const reference = schemaExample("settings-file.json") as SettingsFile;
    expect(validate(reference), JSON.stringify(validate.errors)).toBe(true);
    const { thundernotes: _, version: __, exported, ...parts } = reference;
    const generated = buildSettingsFile(parts, new Date(exported));
    expect(validate(JSON.parse(generated)), JSON.stringify(validate.errors)).toBe(true);
    expect(parseSettingsFile(generated)).toEqual(reference);
  });

  it("allows unknown extension fields and opaque task-view preferences", () => {
    expect(validate({ ...schemaExample("settings-file.json") as SettingsFile, future: true, taskView: ["opaque"] })).toBe(true);
  });

  it.each([
    { version: 2 },
    { thundernotes: "notes" },
    { exported: "not-a-time" },
    { options: { a: 3 } },
    { labels: { version: 2, labelColours: {} } },
    { labelsByAccount: { "you@example.com": { version: 1, labelColours: { work: { colour: "teal", updated: "2026-10-18T09:00:00Z" } } } } },
    { collapsed: { a: "yes" } },
  ])("rejects malformed known fields: %j", (fields) => {
    expect(validate({ ...schemaExample("settings-file.json") as SettingsFile, ...fields })).toBe(false);
  });
});
