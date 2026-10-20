/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { fitReserve, stackCards } from "../src/margin.js";

const TOP = 36;
const GAP = 8;
const stack = (items: [number, number][], pivot = -1, target: number | null = null) =>
  stackCards(items.map(([want, height]) => ({ want, height })), pivot, target, TOP, GAP);

describe("stackCards (margin layout)", () => {
  it("places cards at their highlights, pushing overlaps down", () => {
    expect(stack([[100, 50], [120, 50], [400, 50]])).toEqual([100, 158, 400]);
  });

  // Reported on email B: notes taller than the email; clicking the last card made the gap
  // above it grow, because the cards above were re-stacked from the top.
  it("moves nothing when a card is clicked where it is", () => {
    const items: [number, number][] = [[100, 300], [120, 50], [130, 80]];
    const natural = stack(items);
    for (let pivot = 0; pivot < items.length; pivot++) {
      expect(stack(items, pivot, natural[pivot]!)).toEqual(natural);
    }
  });

  it("aligns an active card with its highlight when there is room above", () => {
    // Natural: 100, 408 (pushed by the tall first card). Opened from the text, card 2 wants 120:
    // card 1 moves up as far as the top allows (Word-style), card 2 gets as close as it can.
    expect(stack([[100, 300], [120, 50]], 1)).toEqual([36, 344]);
    // With room: the cards above shift up to make space, but not above the top.
    expect(stack([[300, 50], [320, 50]], 1)).toEqual([262, 320]);
  });

  it("keeps the whole-email note first and cards without a highlight last", () => {
    const MAX = Number.MAX_SAFE_INTEGER;
    expect(stack([[-Infinity, 40], [200, 50], [MAX, 30]])).toEqual([TOP, 200, 258]);
  });
});

describe("fitReserve (notes in the empty space beside the content, 0.76.1)", () => {
  // A pane 1200 px wide, notes 332 px wide: narrowed fully by 332 + 2 × 12, and the content must
  // end 12 + 16 px left of the notes.
  const VIEW = 1200;
  const FULL = 356;
  const LIMIT = VIEW - 332 - 12 - 16;
  const fit = (layout: (reserve: number) => number) => {
    const seen: number[] = [];
    const reserve = fitReserve(FULL, LIMIT, (r) => (seen.push(r), layout(r)));
    return { reserve, steps: seen.length };
  };

  it("doesn't narrow a centred column with room beside it", () => {
    expect(fit((r) => (VIEW - r) / 2 + 200)).toEqual({ reserve: 0, steps: 1 }); // a 400 px column ends at 800
  });

  it("narrows a centred column only as far as needed (it moves half as far)", () => {
    const right = (r: number) => (VIEW - r) / 2 + 300; // a 600 px column: ends at 900, limit 840
    const { reserve } = fit(right);
    expect(right(reserve)).toBeLessThanOrEqual(LIMIT);
    expect(reserve).toBeLessThan(FULL);
    expect(right(reserve - 2)).toBeGreaterThan(LIMIT); // and no further
  });

  it("narrows fully when text fills the width, as before", () => {
    expect(fit((r) => VIEW - r - 8).reserve).toBe(FULL); // 8 px: the body's margin
  });

  it("narrows fully when the space saved would be tiny", () => {
    expect(fit((r) => (VIEW - r) / 2 + 410).reserve).toBe(FULL); // an 820 px column: 340 of 356 needed
  });

  it("narrows fully when the content doesn't move (wider than the space left)", () => {
    expect(fit(() => 1100).reserve).toBe(FULL);
  });

  it("doesn't narrow an email without content", () => {
    expect(fit(() => -Infinity).reserve).toBe(0);
  });
});
