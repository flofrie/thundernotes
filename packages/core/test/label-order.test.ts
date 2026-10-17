/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { mergeLabelOrder, mergeSettings, moveLabel, orderLabels, parseSettings, sameSettings } from "../src/index.js";

describe("label order (D40)", () => {
  const byUse = ["work", "home", "admin"];
  const at = (mode: "used" | "az" | "za" | "custom", custom: string[] = [], updated = "2026-10-17T10:00:00Z") => ({ mode, custom, updated });

  it("orders by use, A–Z, Z–A or the own order (new labels after it, A–Z)", () => {
    expect(orderLabels(byUse, undefined)).toEqual(["work", "home", "admin"]);
    expect(orderLabels(byUse, at("az"))).toEqual(["admin", "home", "work"]);
    expect(orderLabels(byUse, at("za"))).toEqual(["work", "home", "admin"]);
    expect(orderLabels([...byUse, "zoo", "beta"], at("custom", ["home", "gone", "work"]))).toEqual(["home", "work", "admin", "beta", "zoo"]);
  });

  it("moves a label, keeping the places of labels not shown", () => {
    expect(moveLabel(["work", "home", "admin"], "admin", 0, ["hidden", "work"])).toEqual(["admin", "work", "home", "hidden"]);
    expect(moveLabel(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  });

  it("merges as a whole (the newer), with the colours per label, and round-trips", () => {
    const older = at("custom", ["a", "b"], "2026-10-17T09:00:00Z");
    const newer = at("az", ["b", "a"], "2026-10-17T11:00:00Z");
    expect(mergeLabelOrder(older, newer)).toBe(newer);
    expect(mergeLabelOrder(undefined, older)).toBe(older);
    const merged = mergeSettings({ version: 1, labelColours: {}, labelOrder: older }, { version: 1, labelColours: { x: { colour: "red", updated: "t" } }, labelOrder: newer });
    expect(merged).toEqual({ version: 1, labelColours: { x: { colour: "red", updated: "t" } }, labelOrder: newer });
    expect(parseSettings(JSON.stringify(merged))).toEqual(merged);
    expect(sameSettings(merged, { ...merged, labelOrder: older })).toBe(false);
    expect(parseSettings('{"labelColours":{},"labelOrder":{"mode":"sideways","custom":[],"updated":"x"}}').labelOrder).toBeUndefined();
  });
});
