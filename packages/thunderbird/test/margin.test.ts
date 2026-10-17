/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { stackCards } from "../src/margin.js";

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
