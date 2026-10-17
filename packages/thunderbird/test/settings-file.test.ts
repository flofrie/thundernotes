/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { buildSettingsFile, parseSettingsFile } from "../src/settings-file.js";

describe("settings.json in the export", () => {
  const parts = {
    options: { hideCurrentYear: false, linesScreen: true, lastColour: "green" },
    labels: { version: 1 as const, labelColours: { work: { colour: "blue" as const, updated: "2026-10-17T10:00:00Z" } } },
    taskView: { groupBy: "label" },
    collapsed: { "<a@x> n1": true },
  };
  it("writes and reads back what the notes' files don't hold", () => {
    const back = parseSettingsFile(buildSettingsFile(parts, new Date("2026-10-18T09:00:00Z")))!;
    expect(back).toEqual({ thundernotes: "settings", version: 1, exported: "2026-10-18T09:00:00.000Z", ...parts });
  });
  it("refuses what isn't a settings file, and drops values of the wrong kind", () => {
    expect(parseSettingsFile("not json")).toBeNull();
    expect(parseSettingsFile('{"thundernotes":"settings","version":2}')).toBeNull();
    const odd = parseSettingsFile('{"thundernotes":"settings","version":1,"options":{"a":true,"b":3},"collapsed":{"x":true,"y":false}}')!;
    expect(odd.options).toEqual({ a: true });
    expect(odd.collapsed).toEqual({ x: true });
    expect(odd.labels).toEqual({ version: 1, labelColours: {} });
  });
});
