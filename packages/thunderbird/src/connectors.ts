/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Lines from each note card to its highlight (D23): straight, like a stroke of a translucent
// felt-tip pen, from the middle of the card's left edge to the middle of the underlined passage,
// across the text if need be. Pure geometry (document coordinates), drawn by the display script.
// (Right-angled lines in lanes, as Word draws them, were tried first: hard to follow by eye.)

export interface Point {
  x: number;
  y: number;
}

/** Half the line's width (4 px, round ends): the end sits that far up, so the stroke ends flush
 * with the passage's lower edge instead of reaching below it. */
const HALF_STROKE = 2;

/**
 * The middle of a highlighted passage: halfway along its underline, which runs over the passage's
 * lines one after the other (so a passage over two lines has it on the longer part), and which of
 * the rects it is on. Null for none.
 */
export function passageMiddle(rects: { left: number; right: number; bottom: number }[]): (Point & { index: number }) | null {
  const total = rects.reduce((sum, r) => sum + Math.max(0, r.right - r.left), 0);
  let rest = total / 2;
  for (const [index, r] of rects.entries()) {
    const width = r.right - r.left;
    if (width <= 0) continue;
    if (rest <= width) return { x: r.left + rest, y: r.bottom - HALF_STROKE, index };
    rest -= width;
  }
  return null;
}

/** Where the line meets a card: the middle of its left edge. */
export function cardMiddle(card: { left: number; top: number; height: number }): Point {
  return { x: card.left, y: card.top + card.height / 2 };
}

export interface Band {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * For printing: a line cut into horizontal bands, each drawn on its own, so a line running over a
 * page break shows on both pages (one drawing that overflows prints only on its first page).
 * The bands tile without gaps or overlaps; `pad` leaves room for the stroke's width.
 */
export function lineBands(from: Point, to: Point, pad = 4, step = 12): Band[] {
  const left = Math.floor(Math.min(from.x, to.x) - pad);
  const width = Math.ceil(Math.max(from.x, to.x) + pad) - left;
  const top = Math.floor(Math.min(from.y, to.y) - pad);
  const bottom = Math.ceil(Math.max(from.y, to.y) + pad);
  const bands: Band[] = [];
  for (let y = top; y < bottom; y += step) bands.push({ left, top: y, width, height: Math.min(step, bottom - y) });
  return bands;
}
