/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { SETTINGS_REF, buildSettingsCarrier, labelColourCss, mergeLabelColours, parseCarrierHeaders, parseSettings, sameLabelColours } from "../src/index.js";

describe("label colours (D40)", () => {
  it("merges per label: the newer choice wins, also 'no colour'", () => {
    const here = { work: { colour: "blue" as const, updated: "2026-10-17T10:00:00Z" }, home: { colour: "green" as const, updated: "2026-10-17T09:00:00Z" } };
    const there = { work: { colour: null, updated: "2026-10-17T11:00:00Z" }, home: { colour: "red" as const, updated: "2026-10-17T08:00:00Z" }, urgent: { colour: "red" as const, updated: "2026-10-17T07:00:00Z" } };
    expect(mergeLabelColours(here, there)).toEqual({
      work: { colour: null, updated: "2026-10-17T11:00:00Z" },
      home: { colour: "green", updated: "2026-10-17T09:00:00Z" },
      urgent: { colour: "red", updated: "2026-10-17T07:00:00Z" },
    });
    expect(sameLabelColours({ a: here.work, b: here.home }, { b: here.home, a: here.work })).toBe(true);
    expect(sameLabelColours(here, there)).toBe(false);
  });

  it("writes and reads a settings carrier", () => {
    const settings = { version: 1 as const, labelColours: { work: { colour: "blue" as const, updated: "2026-10-17T10:00:00Z" } } };
    const { eml } = buildSettingsCarrier(settings, { client: "test" });
    const headers = Object.fromEntries(
      eml.split("\r\n\r\n")[0]!.split("\r\n").map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()])
    );
    expect(parseCarrierHeaders(headers)).toMatchObject({ ref: SETTINGS_REF, updated: "2026-10-17T10:00:00Z" });
    const body = eml.split('filename="thundernotes-settings.json"\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1]!.split("\r\n--")[0]!;
    const json = new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)));
    expect(parseSettings(json)).toEqual(settings);
  });

  it("ignores malformed entries", () => {
    expect(parseSettings('{"labelColours":{"A":{"colour":"red","updated":"x"},"b":{"colour":"teal","updated":"x"},"c":{"colour":null},"d":{"colour":null,"updated":"y"}}}')).toEqual({
      version: 1,
      labelColours: { a: { colour: "red", updated: "x" }, d: { colour: null, updated: "y" } },
    });
  });

  it("colours labels by CSS on their data-label", () => {
    const css = labelColourCss({ work: { colour: "blue", updated: "x" }, home: { colour: null, updated: "y" } });
    expect(css).toContain('.tn-chip.tn-label[data-label="work"]');
    expect(css).toContain('.cm-tn-chip.cm-tn-label[data-label="work"]');
    expect(css).not.toContain("home");
  });
});
