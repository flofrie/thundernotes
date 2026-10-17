/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Selectors and anchoring (D3, D21). Works on normalised text only.
 * Order: position -> quote -> quote + context -> loose -> fuzzy -> partial -> orphan.
 */

import search from "approx-string-match";
import type { TextPositionSelector, TextQuoteSelector } from "../index.js";

/** Characters of prefix and suffix stored with a quote. */
export const CONTEXT_LENGTH = 32;

export type AnchorMethod = "position" | "quote" | "context" | "loose" | "fuzzy" | "partial";

export type AnchorResult =
  | {
      status: "anchored" | "partial";
      method: AnchorMethod;
      start: number;
      end: number;
      /** Number of places the quote (or its loose form) was found. */
      candidates?: number;
      /** Edit distance of a fuzzy match. */
      errors?: number;
      /** Share of the quote that was found (partial matches). */
      coverage?: number;
    }
  | { status: "orphan" };

/** Selectors for text offsets [start, end) of normalised text. */
export function describe(text: string, start: number, end: number): [TextQuoteSelector, TextPositionSelector] {
  return [
    {
      type: "TextQuoteSelector",
      exact: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
      suffix: text.slice(end, end + CONTEXT_LENGTH),
    },
    { type: "TextPositionSelector", start, end },
  ];
}

/** Finds the selectors' target in normalised text. */
export function anchor(text: string, quote: TextQuoteSelector, position?: TextPositionSelector): AnchorResult {
  const { exact } = quote;
  const prefix = quote.prefix ?? "";
  const suffix = quote.suffix ?? "";
  const near = position?.start ?? 0;
  if (!exact) return { status: "orphan" };

  if (position && text.slice(position.start, position.end) === exact) {
    return { status: "anchored", method: "position", start: position.start, end: position.end };
  }

  const hits = indexesOf(text, exact);
  if (hits.length === 1) {
    return { status: "anchored", method: "quote", start: hits[0]!, end: hits[0]! + exact.length };
  }
  if (hits.length > 1) {
    const h = bestByContext(text, hits, exact.length, prefix, suffix, near);
    return { status: "anchored", method: "context", candidates: hits.length, start: h, end: h + exact.length };
  }

  const loose = looseMatch(text, exact, prefix, suffix, near);
  if (loose) return loose;

  const fuzzy = fuzzyMatch(text, exact, prefix, suffix, near);
  if (fuzzy) return fuzzy;

  const partial = partialMatch(text, exact, near);
  if (partial) return partial;

  return { status: "orphan" };
}

// ---- helpers ---------------------------------------------------------------------

function indexesOf(haystack: string, needle: string): number[] {
  const hits: number[] = [];
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) hits.push(i);
  return hits;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function commonSuffix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/** Context agreement around a hit, in characters. */
function contextScore(text: string, start: number, end: number, prefix: string, suffix: string): number {
  return (
    commonSuffix(text.slice(Math.max(0, start - prefix.length), start), prefix) +
    commonPrefix(text.slice(end, end + suffix.length), suffix)
  );
}

/** Best hit by context; distance to the old position breaks ties. */
function bestByContext(text: string, hits: number[], length: number, prefix: string, suffix: string, near: number): number {
  let best = hits[0]!;
  let bestScore = -Infinity;
  for (const h of hits) {
    const score = contextScore(text, h, h + length, prefix, suffix) - Math.abs(h - near) / 1e7;
    if (score > bestScore) [best, bestScore] = [h, score];
  }
  return best;
}

/** Letters and digits only, lower case, with a map back to text offsets. */
function loosen(text: string): { s: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (/[\p{L}\p{N}]/u.test(c)) {
      out.push(c.toLowerCase());
      map.push(i);
    }
  }
  return { s: out.join(""), map };
}

/** Exact match ignoring punctuation, spacing and case (`*bold*`, `/em/`, bullets). */
function looseMatch(text: string, exact: string, prefix: string, suffix: string, near: number): AnchorResult | null {
  const pattern = loosen(exact).s;
  if (pattern.length < 3) return null;
  const loose = loosen(text);
  const hits = indexesOf(loose.s, pattern);
  if (!hits.length) return null;
  const nearLoose = Math.max(0, loose.map.findIndex((i) => i >= near));
  const h = bestByContext(loose.s, hits, pattern.length, loosen(prefix).s, loosen(suffix).s, nearLoose);
  return {
    status: "anchored",
    method: "loose",
    candidates: hits.length,
    start: loose.map[h]!,
    end: loose.map[h + pattern.length - 1]! + 1,
  };
}

/** Approximate match allowing edits in up to a quarter of the quote. */
function fuzzyMatch(text: string, exact: string, prefix: string, suffix: string, near: number): AnchorResult | null {
  if (exact.length < 8) return null;
  const maxErrors = Math.min(256, Math.floor(exact.length / 4));
  const matches = search(text, exact, maxErrors);
  if (!matches.length) return null;
  // Same weighting idea as Hypothesis: the quote counts most, then context, then position.
  let best = matches[0]!;
  let bestScore = -Infinity;
  for (const m of matches) {
    const score =
      50 * (1 - m.errors / exact.length) +
      20 * (prefix ? commonSuffix(text.slice(Math.max(0, m.start - prefix.length), m.start), prefix) / prefix.length : 0) +
      20 * (suffix ? commonPrefix(text.slice(m.end, m.end + suffix.length), suffix) / suffix.length : 0) +
      2 * (1 - Math.min(1, Math.abs(m.start - near) / Math.max(1, text.length)));
    if (score > bestScore) [best, bestScore] = [m, score];
  }
  return { status: "anchored", method: "fuzzy", start: best.start, end: best.end, errors: best.errors, candidates: matches.length };
}

/** Partial anchoring needs at least this many characters and this share of the quote. */
const PARTIAL_MIN_CHARS = 8;
const PARTIAL_MIN_COVERAGE = 0.2;
/** Upper bound for the quadratic search; beyond it only a window around the old position is searched. */
const PARTIAL_MAX_CELLS = 20_000_000;

/**
 * Longest piece of the quote that still exists, for text shown in only one view
 * (e.g. hidden preheaders that Simple HTML reveals). Longest common substring, O(n·m).
 */
function partialMatch(text: string, exact: string, near: number): AnchorResult | null {
  let from = 0;
  let to = text.length;
  if (text.length * exact.length > PARTIAL_MAX_CELLS) {
    const half = Math.floor(PARTIAL_MAX_CELLS / exact.length / 2);
    from = Math.max(0, near - half);
    to = Math.min(text.length, near + half);
  }
  let best = 0;
  let bestEnd = 0;
  let prev = new Uint16Array(exact.length + 1);
  let cur = new Uint16Array(exact.length + 1);
  for (let i = from; i < to; i++) {
    for (let j = 1; j <= exact.length; j++) {
      const v = text[i] === exact[j - 1] ? prev[j - 1]! + 1 : 0;
      cur[j] = v;
      if (v > best) [best, bestEnd] = [v, i + 1];
    }
    [prev, cur] = [cur, prev];
  }
  // Don't start or end a highlight on a space.
  let start = bestEnd - best;
  let end = bestEnd;
  while (start < end && text[start] === " ") start++;
  while (end > start && text[end - 1] === " ") end--;
  const length = end - start;
  if (length < PARTIAL_MIN_CHARS || length / exact.length < PARTIAL_MIN_COVERAGE) return null;
  return { status: "partial", method: "partial", start, end, coverage: length / exact.length };
}
