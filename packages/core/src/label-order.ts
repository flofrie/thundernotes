/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The order of labels (D40): by use (open tasks, most first; the default), A–Z, Z–A, or the
 * user's own (dragged). The same on all devices (settings carrier); the own order is one list,
 * synced as a whole (the latest arrangement wins: merging two arrangements would surprise).
 */

export type LabelOrderMode = "used" | "az" | "za" | "custom";

export interface LabelOrder {
  mode: LabelOrderMode;
  /** The own order (kept when another mode is chosen, to come back to). */
  custom: string[];
  updated: string;
}

export const LABEL_ORDER_MODES: LabelOrderMode[] = ["used", "az", "za", "custom"];

/** The newer of two (either may be missing). */
export function mergeLabelOrder(a: LabelOrder | undefined, b: LabelOrder | undefined): LabelOrder | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.updated > a.updated ? b : a;
}

/**
 * Labels (`byUse`: most used first) in the chosen order. Own order: its labels first, labels
 * not in it yet (new ones) after them, alphabetically.
 */
export function orderLabels(byUse: string[], order: LabelOrder | undefined): string[] {
  const mode = order?.mode ?? "used";
  if (mode === "az") return [...byUse].sort((a, b) => a.localeCompare(b));
  if (mode === "za") return [...byUse].sort((a, b) => b.localeCompare(a));
  if (mode === "custom") {
    const custom = order!.custom.filter((l) => byUse.includes(l));
    return [...custom, ...byUse.filter((l) => !custom.includes(l)).sort((a, b) => a.localeCompare(b))];
  }
  return [...byUse];
}

/**
 * A new own order: `label` moved to `index` of the labels shown (`shown`, in their order);
 * labels of the old own order not shown now keep their places after those.
 */
export function moveLabel(shown: string[], label: string, index: number, previous: string[] = []): string[] {
  const without = shown.filter((l) => l !== label);
  without.splice(Math.max(0, Math.min(index, without.length)), 0, label);
  return [...without, ...previous.filter((l) => !without.includes(l))];
}
