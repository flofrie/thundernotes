/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { COLOURS, COLOUR_NAMES, colourOf, contrast, effective, textOn } from "../src/index.js";

describe("colours (D29)", () => {
  it("falls back to yellow", () => {
    expect(colourOf(undefined).name).toBe("yellow");
    expect(colourOf("chartreuse").name).toBe("yellow");
    expect(colourOf("red").name).toBe("red");
  });

  it("computes WCAG contrast", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
  });

  it("blends with the background", () => {
    expect(effective({ ...COLOURS.yellow, hex: "#000000" }, "#ffffff", 0.5)).toBe("#808080");
  });

  it("puts black text on the light colours and white on the strong ones", () => {
    const white = ["orange", "red", "purple", "grey"];
    for (const name of COLOUR_NAMES) expect(textOn(COLOURS[name]), name).toBe(white.includes(name) ? "#ffffff" : "#000000");
  });

  it("would choose white text on a dark colour", () => {
    expect(textOn({ ...COLOURS.yellow, hex: "#222222", alpha: 1 })).toBe("#ffffff");
  });

  it("chooses text with at least 4.5:1 contrast for the light colours (WCAG AA)", () => {
    for (const name of COLOUR_NAMES.filter((n) => !COLOURS[n].whiteText)) {
      const bg = effective(COLOURS[name]);
      expect(contrast(bg, textOn(COLOURS[name])), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
