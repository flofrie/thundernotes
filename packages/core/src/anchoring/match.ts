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
const REPEATED_CONTEXT_MIN = 8;
const REPEATED_CONTEXT_MARGIN = 4;
const FUZZY_SCORE_MIN = 60;
const FUZZY_SCORE_MARGIN = 6;
/** Among equally good candidates, the nearest to the old position wins only if the next is this many times as far. */
const NEAREST_FACTOR = 2;

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
  // For deciding between equally good candidates: only a position actually stored counts.
  const known = position ? position.start : undefined;
  if (!exact) return { status: "orphan" };

  if (position && text.slice(position.start, position.end) === exact) {
    return { status: "anchored", method: "position", start: position.start, end: position.end };
  }

  const hits = indexesOf(text, exact);
  if (hits.length === 1) {
    return { status: "anchored", method: "quote", start: hits[0]!, end: hits[0]! + exact.length };
  }
  if (hits.length > 1) {
    const h = bestByContext(text, hits, exact.length, prefix, suffix, known);
    if (h === null) return { status: "orphan" };
    return { status: "anchored", method: "context", candidates: hits.length, start: h, end: h + exact.length };
  }

  const loose = looseMatch(text, exact, prefix, suffix, known);
  if (loose) return loose;

  const fuzzy = fuzzyMatch(text, exact, prefix, suffix, near, known);
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

/**
 * Several equally good candidates (#10): the one nearest the old position, if it is clearly the
 * nearest (the next at least NEAREST_FACTOR times as far). A view change shifts text only a
 * little, so that is usually the passage the note was made on; two about equally near, or no
 * stored position, stay undecided (null).
 */
function nearest<T>(candidates: T[], start: (c: T) => number, near: number | undefined): T | null {
  if (near === undefined || !candidates.length) return null;
  const [first, second] = [...candidates].sort((a, b) => Math.abs(start(a) - near) - Math.abs(start(b) - near));
  if (!second) return first!;
  return Math.abs(start(first!) - near) * NEAREST_FACTOR < Math.abs(start(second) - near) ? first! : null;
}

/**
 * Repeated text: substantial, clearly better context decides; among candidates whose context is
 * about as good, the clearly nearest to the old position (`nearest`); otherwise none.
 */
function bestByContext(text: string, hits: number[], length: number, prefix: string, suffix: string, near: number | undefined): number | null {
  const scored = hits.map((start) => ({ start, score: contextScore(text, start, start + length, prefix, suffix) }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const contenders = scored.filter((s) => best.score - s.score < REPEATED_CONTEXT_MARGIN);
  if (contenders.length === 1 && best.score >= REPEATED_CONTEXT_MIN) return best.start;
  return nearest(contenders, (c) => c.start, near)?.start ?? null;
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
function looseMatch(text: string, exact: string, prefix: string, suffix: string, near: number | undefined): AnchorResult | null {
  const pattern = loosen(exact).s;
  if (pattern.length < 3) return null;
  const loose = loosen(text);
  const hits = indexesOf(loose.s, pattern);
  if (!hits.length) return null;
  const nearLoose = near === undefined ? undefined : Math.max(0, loose.map.findIndex((i) => i >= near));
  const h = hits.length === 1 ? hits[0]! : bestByContext(loose.s, hits, pattern.length, loosen(prefix).s, loosen(suffix).s, nearLoose);
  if (h === null) return null;
  return {
    status: "anchored",
    method: "loose",
    candidates: hits.length,
    start: loose.map[h]!,
    end: loose.map[h + pattern.length - 1]! + 1,
  };
}

/** Approximate match allowing edits in up to a quarter of the quote. */
function fuzzyMatch(text: string, exact: string, prefix: string, suffix: string, near: number, known: number | undefined): AnchorResult | null {
  if (exact.length < 8) return null;
  const maxErrors = Math.min(256, Math.floor(exact.length / 4));
  const matches = search(text, exact, maxErrors);
  if (!matches.length) return null;
  // Same weighting idea as Hypothesis: the quote counts most, then context, then position.
  const scored = matches.map((m) => ({ match: m, score:
      50 * (1 - m.errors / exact.length) +
      20 * (prefix ? commonSuffix(text.slice(Math.max(0, m.start - prefix.length), m.start), prefix) / prefix.length : 0) +
      20 * (suffix ? commonPrefix(text.slice(m.end, m.end + suffix.length), suffix) / suffix.length : 0) +
      2 * (1 - Math.min(1, Math.abs(m.start - near) / Math.max(1, text.length))) }));
  // The matcher can return several equally good alignments that overlap the
  // same passage. Treat those as one location before applying the ambiguity
  // margin, or harmless alignment variants can orphan an unambiguous quote.
  const byLocation = [...scored].sort((a, b) => a.match.start - b.match.start || a.match.end - b.match.end);
  const locations: typeof scored[] = [];
  let locationEnd = -1;
  for (const candidate of byLocation) {
    const lastLocation = locations[locations.length - 1];
    if (lastLocation && candidate.match.start < locationEnd) {
      lastLocation.push(candidate);
      locationEnd = Math.max(locationEnd, candidate.match.end);
    } else {
      locations.push([candidate]);
      locationEnd = candidate.match.end;
    }
  }
  const representatives = locations.map((location) => location.reduce((best, candidate) => candidate.score > best.score ? candidate : best));
  representatives.sort((a, b) => b.score - a.score);
  // Several places: a clearly better score decides; among about equally good ones, the
  // clearly nearest to the old position (`nearest`, #10).
  const top = representatives[0]!;
  const contenders = representatives.filter((r) => top.score - r.score < FUZZY_SCORE_MARGIN);
  const chosen = representatives.length === 1 || (contenders.length === 1 && top.score >= FUZZY_SCORE_MIN) ? top : nearest(contenders, (c) => c.match.start, known);
  // Still undecided: don't let the broader partial search turn the same ambiguous text into
  // a plausible-looking highlight.
  if (!chosen) return { status: "orphan" };
  const best = chosen.match;
  return { status: "anchored", method: "fuzzy", start: best.start, end: best.end, errors: best.errors, candidates: locations.length };
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
