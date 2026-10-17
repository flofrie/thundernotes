/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { hasInvalidRegex, highlightTerms, matchesFilter, normaliseFilter, parseFilter } from "../src/filter-expr.js";

const tasks = ["send offer to anna", "send offer to ben", "call back ben", "lunch with carl"];
const hits = (filter: string) => tasks.filter((t) => matchesFilter(parseFilter(filter), t));

describe("the filter as an expression (D38)", () => {
  it("ANDs terms, ORs with OR (binding more tightly), groups with brackets", () => {
    expect(hits("offer ben")).toEqual(["send offer to ben"]);
    expect(hits("anna OR carl")).toEqual(["send offer to anna", "lunch with carl"]);
    expect(hits("offer anna OR ben")).toEqual(["send offer to anna", "send offer to ben"]); // offer AND (anna OR ben)
    expect(hits("(offer anna) OR carl")).toEqual(["send offer to anna", "lunch with carl"]);
    expect(hits("ben AND call")).toEqual(["call back ben"]); // AND: the default, ignored
    expect(hits("anna or carl")).toEqual(["send offer to anna", "lunch with carl"]); // "or" in any case
    expect(hits('send "or"')).toEqual([]); // the word itself: in quotes
  });

  it("excludes terms and groups with a minus; phrases in quotes", () => {
    expect(hits("ben -call")).toEqual(["send offer to ben"]);
    expect(hits('-"send offer"')).toEqual(["call back ben", "lunch with carl"]);
    expect(hits("-(anna OR ben)")).toEqual(["lunch with carl"]);
  });

  it("reads incomplete input leniently", () => {
    expect(hits("offer (anna OR")).toEqual(["send offer to anna"]); // open bracket, dangling OR
    expect(hits("ben ) call")).toEqual(["call back ben"]); // stray ")"
    expect(hits("OR ben ()")).toEqual(["send offer to ben", "call back ben"]); // OR without a left side, empty brackets
    expect(hits("-")).toEqual(tasks); // a lone minus: nothing yet
    expect(parseFilter("  ")).toBeNull();
  });

  it("writes it out as understood", () => {
    expect(normaliseFilter("offer anna OR ben")).toBe("offer (anna OR ben)");
    expect(normaliseFilter("anna OR ben")).toBe("anna OR ben"); // the only expression: no brackets
    expect(normaliseFilter("offer (anna OR")).toBe("offer anna");
    expect(normaliseFilter("offer (anna OR ben")).toBe("offer (anna OR ben)");
    expect(normaliseFilter("(anna)  AND   ben )")).toBe("anna ben");
    expect(normaliseFilter('"call back" OR -"lunch')).toBe('"call back" OR -"lunch"'); // quote closed, kept as typed
    expect(normaliseFilter("(offer anna) OR carl")).toBe("(offer anna) OR carl");
    expect(normaliseFilter("-(anna OR ben) x")).toBe("-(anna OR ben) x");
    expect(normaliseFilter("@2026-10 OR @2026-11")).toBe("@2026-10 OR @2026-11");
    expect(normaliseFilter("x OR")).toBe("x");
    expect(normaliseFilter("offer anna or Ben and x")).toBe("offer (anna OR Ben) x"); // written out in capitals, "and" left out
  });

  it("takes /regex/ as a term: case ignored, mixable, invalid counts as nothing", () => {
    expect(hits("/\\bben\\b/")).toEqual(["send offer to ben", "call back ben"]);
    expect(hits("/^send .* (anna|ben)$/")).toEqual(["send offer to anna", "send offer to ben"]);
    expect(hits("offer -/ANNA/")).toEqual(["send offer to ben"]);
    expect(hits("/lunch")).toEqual(["lunch with carl"]); // still open: closed at the end
    expect(hits("ben /(unclosed/")).toEqual(["send offer to ben", "call back ben"]); // invalid: nothing
    expect(hasInvalidRegex("ben /(unclosed/")).toBe(true);
    expect(hasInvalidRegex("ben /b+/")).toBe(false);
    expect(normaliseFilter("x /a b")).toBe("x /a b/");
    expect(normaliseFilter("/a\\/b/ OR c")).toBe("/a\\/b/ OR c"); // an escaped slash stays inside
  });

  it("names what to mark: terms that must or may be there, not excluded ones", () => {
    const h = highlightTerms('offer (anna OR ben) -carl -(x OR y) /inv-\\d+/ -/z/');
    expect(h.words).toEqual(["offer", "anna", "ben"]);
    expect(h.patterns.map((p) => p.source)).toEqual(["inv-\\d+"]);
  });
});
