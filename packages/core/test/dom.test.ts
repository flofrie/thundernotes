/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { extractText, offsetsToRange, pointToOffset, rangeToOffsets } from "../src/index.js";
import { htmlB, htmlBSimple, htmlD } from "./fixtures.js";

// Into the live document: DOMParser documents have no window, so no computed styles.
function load(html: string): Document {
  document.documentElement.innerHTML = html;
  return document;
}

describe("extractText", () => {
  it("joins inline markup, separates blocks and cells", () => {
    const { text } = extractText(load(htmlB).body);
    expect(text).toContain("A word split by markup: Highlighting. Non-breaking spaces here.");
    expect(text).toContain("first list item second list item with emphasis");
    expect(text).toContain("Cell one Cell two Cell three Cell four");
    expect(text).toContain("Soft" + "hyphen and zerowidth test.");
  });

  it("skips hidden elements and counts them", () => {
    const original = extractText(load(htmlB).body);
    expect(original.text).not.toContain("Hidden preheader");
    expect(original.hiddenChars).toBeGreaterThan(0);
    // Simple HTML drops the style attribute, so the text shows there.
    expect(extractText(load(htmlBSimple).body).text).toContain("Hidden preheader");
  });

  it("skips style elements and hidden spans styled by a stylesheet", () => {
    const { text } = extractText(load(htmlD).body);
    expect(text).not.toContain("font-family");
    expect(text).not.toContain("Preheader:");
    expect(text).toContain("Left column Text in the left column. Right column Text in the right column.");
  });

  it("leaves out excluded elements", () => {
    const doc = load("<body><p>keep</p><div id='ui'>panel text</div></body>");
    const { text } = extractText(doc.body, { exclude: (el) => el.id === "ui" });
    expect(text).toBe("keep");
  });
});

describe("selection mapping", () => {
  it("round-trips a selection across markup boundaries", () => {
    const doc = load(htmlB);
    const ex = extractText(doc.body);
    const start = ex.text.indexOf("Highlighting");
    const end = start + "Highlighting".length;
    const range = offsetsToRange(ex, start, end);
    expect(range.toString()).toBe("Highlighting");
    expect(pointToOffset(ex, range.startContainer, range.startOffset)).toBe(start);
    expect(pointToOffset(ex, range.endContainer, range.endOffset)).toBe(end);
  });

  it("maps element-container points to the next text", () => {
    const doc = load("<body><p>one</p><p>two</p></body>");
    const ex = extractText(doc.body);
    expect(ex.text).toBe("one two");
    // Point before the second <p>: offset 1 in <body>.
    expect(pointToOffset(ex, doc.body, 1)).toBe(ex.text.indexOf("two"));
  });

  it("maps element-container end points to the end of the previous text", () => {
    const doc = load("<body><p>one</p><p>two</p></body>");
    const ex = extractText(doc.body);
    expect(pointToOffset(ex, doc.body, 1, "end")).toBe(3);
  });

  // Triple-click selects a block up to the start of the next one (reported for B and D).
  it("does not carry a triple-click selection into the next cell", () => {
    const doc = load(htmlB);
    const ex = extractText(doc.body);
    const cells = doc.querySelectorAll("td");
    const range = doc.createRange();
    range.setStart(cells[0]!.firstChild!, 0);
    range.setEnd(cells[1]!, 0);
    const { start, end } = rangeToOffsets(ex, range);
    expect(ex.text.slice(start, end)).toBe("Cell one");
    expect(offsetsToRange(ex, start, end).toString()).toBe("Cell one");
    // Also when the end is given as (next text node, 0).
    range.setEnd(cells[1]!.firstChild!, 0);
    const second = rangeToOffsets(ex, range);
    expect(ex.text.slice(second.start, second.end)).toBe("Cell one");
  });

  it("does not carry a heading selection into the next row", () => {
    const doc = load(htmlD);
    const ex = extractText(doc.body);
    const heading = [...doc.querySelectorAll("h3")].find((h) => h.textContent === "Left column")!;
    const range = doc.createRange();
    range.selectNodeContents(heading);
    range.setEnd(heading.nextElementSibling!, 0);
    const { start, end } = rangeToOffsets(ex, range);
    expect(ex.text.slice(start, end)).toBe("Left column");
    expect(offsetsToRange(ex, start, end).toString()).toBe("Left column");
  });

  it("leaves boundary spaces out of ranges built from offsets", () => {
    const doc = load(htmlB);
    const ex = extractText(doc.body);
    const start = ex.text.indexOf("Cell one");
    // Offsets that include the boundary space before "Cell two".
    expect(offsetsToRange(ex, start, start + "Cell one ".length).toString()).toBe("Cell one");
  });
});
