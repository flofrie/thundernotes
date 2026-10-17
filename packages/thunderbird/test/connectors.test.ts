/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { cardMiddle, lineBands, passageMiddle } from "../src/connectors.js";

describe("lines from note cards to their highlights (D23)", () => {
  it("meets a passage on one line in the middle of its underline", () => {
    expect(passageMiddle([{ left: 100, right: 200, bottom: 41 }])).toEqual({ x: 150, y: 39, index: 0 });
  });

  it("meets a passage over several lines halfway along the whole underline", () => {
    // 40 px at the end of line 1, 200 px on line 2: halfway (120 px) is 80 px into line 2
    const rects = [
      { left: 360, right: 400, bottom: 21 },
      { left: 0, right: 200, bottom: 41 },
    ];
    expect(passageMiddle(rects)).toEqual({ x: 80, y: 39, index: 1 });
  });

  it("finds nothing for a passage without width (not shown)", () => {
    expect(passageMiddle([])).toBeNull();
    expect(passageMiddle([{ left: 5, right: 5, bottom: 10 }])).toBeNull();
  });

  it("meets a card in the middle of its left edge", () => {
    expect(cardMiddle({ left: 520, top: 100, height: 60 })).toEqual({ x: 520, y: 130 });
  });

  it("cuts a line into bands for printing that tile from end to end without gaps", () => {
    const bands = lineBands({ x: 100, y: 40 }, { x: 520, y: 70 }, 4, 12);
    expect(bands[0]).toEqual({ left: 96, top: 36, width: 428, height: 12 });
    for (let i = 1; i < bands.length; i++) expect(bands[i]!.top).toBe(bands[i - 1]!.top + bands[i - 1]!.height);
    const last = bands[bands.length - 1]!;
    expect(last.top + last.height).toBe(74);
  });
});
