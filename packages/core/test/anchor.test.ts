/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// Cross-view scenarios from the highlight spike (spike README, runs 1 and 2):
// a highlight made in one view must be found in another.

import { describe, expect, it } from "vitest";
import { anchor, describe as describeSelection, extractText, normaliseText, type AnchorResult } from "../src/index.js";
import { htmlB, htmlBSimple, htmlD, plainA, plainBView, plainDView } from "./fixtures.js";

// Into the live document: DOMParser documents have no window, so no computed styles.
const html = (source: string) => {
  document.documentElement.innerHTML = source;
  return extractText(document.body).text;
};

const views = {
  bOriginal: html(htmlB),
  bSimple: html(htmlBSimple),
  bPlain: normaliseText(plainBView).text,
  dOriginal: html(htmlD),
  dPlain: normaliseText(plainDView).text,
};

/** Selects `phrase` (the nth occurrence) in `from`, then anchors it in `to`. */
function carry(from: string, to: string, phrase: string, nth = 0): { result: AnchorResult; found: string } {
  let start = -1;
  for (let i = 0; i <= nth; i++) start = from.indexOf(phrase, start + 1);
  expect(start, `"${phrase}" not in source view`).toBeGreaterThanOrEqual(0);
  const [quote, position] = describeSelection(from, start, start + phrase.length);
  const result = anchor(to, quote, position);
  const found = result.status === "orphan" ? "" : to.slice(result.start, result.end);
  return { result, found };
}

describe("anchor within one view", () => {
  it("uses the position when the text is unchanged", () => {
    const text = views.bOriginal;
    expect(carry(text, text, "anchor there").result).toMatchObject({ method: "position" });
  });

  it("orphans text that is gone", () => {
    const [quote, position] = describeSelection("completely different words", 0, 10);
    expect(anchor(views.bOriginal, quote, position)).toEqual({ status: "orphan" });
  });
});

describe("Original -> Plain (B)", () => {
  it("finds table text by quote", () => {
    const { result, found } = carry(views.bOriginal, views.bPlain, "ell two Cell th");
    expect(result).toMatchObject({ status: "anchored" });
    expect(found).toBe("ell two Cell th");
  });

  it("finds link text although Plain adds the URL (spike orphan, fixed by dropping bracketed URLs)", () => {
    const { result, found } = carry(views.bOriginal, views.bPlain, "k: example link text. Umlauts:");
    expect(result).toMatchObject({ status: "anchored", method: "quote" });
    expect(found).toBe("k: example link text. Umlauts:");
  });

  it("bridges /emphasis/ loosely", () => {
    const { result, found } = carry(views.bOriginal, views.bPlain, "list item with emphasis");
    expect(result).toMatchObject({ method: "loose" });
    expect(found).toBe("list item with /emphasis");
  });

  it("picks the right one of two equal phrases by context", () => {
    const { result, found } = carry(views.bOriginal, views.bPlain, "anchor", 2); // "anchor there"
    expect(result).toMatchObject({ status: "anchored" });
    expect(result.status !== "orphan" && views.bPlain.slice(result.end, result.end + 6)).toBe(" there");
    expect(found).toBe("anchor");
  });
});

describe("Plain -> Original (B)", () => {
  it("bridges `*` bullets loosely", () => {
    const { result, found } = carry(views.bPlain, views.bOriginal, "first list item * second");
    expect(result).toMatchObject({ method: "loose" });
    expect(found).toBe("first list item second");
  });
});

describe("Simple -> Original (B)", () => {
  it("anchors partly when part of the highlight is hidden in Original", () => {
    const { result, found } = carry(views.bSimple, views.bOriginal, "preheader text that should not count. Softhyphen an");
    expect(result).toMatchObject({ status: "partial", method: "partial" });
    expect(found).toContain("Softhyphen an");
  });
});

describe("Original -> Plain (D)", () => {
  it("finds the right column among two hits", () => {
    const { result, found } = carry(views.dOriginal, views.dPlain, "olumn. Right column Text in th");
    expect(result).toMatchObject({ status: "anchored" });
    expect(found).toBe("olumn. Right column Text in th");
    const right = carry(views.dOriginal, views.dPlain, "Text in the", 1);
    expect(right.result).toMatchObject({ method: "context", candidates: 2 });
    expect(right.result.status !== "orphan" && views.dPlain.slice(right.result.end, right.result.end + 6)).toBe(" right");
  });
});

describe("fuzzy", () => {
  it("tolerates small wording changes", () => {
    const from = "The word anchor appears twice: anchor here, and anchor there.";
    const to = "Intro. The word anchor appear twice: anchors here, and anchor there!";
    const { result, found } = carry(from, to, from);
    expect(result).toMatchObject({ status: "anchored", method: "fuzzy" });
    expect(found.startsWith("The word anchor appear")).toBe(true);
  });

  it("does not accept a match with too many changes", () => {
    const [quote, position] = describeSelection("abcdefghijklmnop", 0, 16);
    expect(anchor("zyxwvutsrqponmlk", quote, position)).toEqual({ status: "orphan" });
  });
});

describe("plain text (A)", () => {
  it("anchors across hard line wraps and quote markers", () => {
    const text = normaliseText(plainA).text;
    expect(text).toContain("a sentence that spans a line break must still anchor");
    expect(text).toContain("Quoted line two, with a > sign inside. Doubly quoted line.");
  });
});
