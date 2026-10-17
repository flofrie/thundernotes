/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Lines between a selected task and its sub-tasks and parent in the task view (D38), in the margin
// left of the list: from the selected task a short stub out to a lane, one trunk along the lane, a
// stub with a small arrow into each other task. Sub-tasks on the inner lane, the parent on its own
// lane further out, so the two don't merge. Pure geometry (coordinates in the list), drawn by
// tasks.ts; only for the selected task (all tasks' lines at once would be busy).

/** One end of a bracket: a task's row, at the height of its checkbox, and where the row begins. */
export interface RowEnd {
  y: number;
  /** The row's left edge (rows grouped by email are indented by depth). */
  x: number;
}

const ARROW = 4;

/**
 * SVG path data for a bracket from `from` to each of `to` along the lane at `laneX`: a stub out
 * from the selected row, the trunk, a stub with an arrow into each target row. Empty without targets.
 */
export function bracketPath(from: RowEnd, to: RowEnd[], laneX: number): string {
  if (!to.length) return "";
  const r = (n: number) => Math.round(n * 2) / 2; // crisp lines
  const ys = [from.y, ...to.map((t) => t.y)];
  const parts = [
    `M${r(from.x - 1)} ${r(from.y)}H${r(laneX)}`,
    `M${r(laneX)} ${r(Math.min(...ys))}V${r(Math.max(...ys))}`,
  ];
  for (const t of to) {
    const end = t.x - 2;
    parts.push(`M${r(laneX)} ${r(t.y)}H${r(end)}`, `M${r(end - ARROW)} ${r(t.y - ARROW)}L${r(end)} ${r(t.y)}L${r(end - ARROW)} ${r(t.y + ARROW)}`);
  }
  return parts.join("");
}

/** The left edge a lane must stay left of: of the rows it joins and of every row between them. */
export function laneLeftOf(joined: RowEnd[], rows: RowEnd[]): number {
  const top = Math.min(...joined.map((r) => r.y));
  const bottom = Math.max(...joined.map((r) => r.y));
  // A loop, not a spread: a long list can hold thousands of rows.
  let left = Infinity;
  for (const r of [...joined, ...rows]) if (r.y >= top && r.y <= bottom) left = Math.min(left, r.x);
  return left;
}
