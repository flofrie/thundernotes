/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { TextBuilder, normaliseText } from "../src/index.js";

const norm = (s: string) => normaliseText(s).text;

describe("normaliseText", () => {
  it("collapses whitespace runs, line breaks and no-break spaces", () => {
    expect(norm("  a \t b\n\nc  d  ")).toBe("a b c d");
  });

  it("drops quote markers at line start only", () => {
    expect(norm("> one\n>> two\n> with a > sign")).toBe("one two with a > sign");
    expect(norm("a > b")).toBe("a > b");
  });

  it("drops soft hyphens and zero-width characters", () => {
    expect(norm("Soft­hyphen zero​width﻿")).toBe("Softhyphen zerowidth");
  });

  it("drops bracketed URLs but keeps bare ones", () => {
    expect(norm("link text <https://example.com/x?y=1>. More")).toBe("link text. More");
    expect(norm("mail <mailto:a@b.c> and https://bare.example")).toBe("mail and https://bare.example");
  });

  it("maps source offsets to text offsets, also after dropping URLs", () => {
    const source = "ab <https://x.y> cd";
    const n = normaliseText(source);
    expect(n.text).toBe("ab cd");
    const map = n.maps.get(0)!;
    expect(n.text[map[source.indexOf("cd")]!]).toBe("c");
    expect(map[source.length]).toBe(n.text.length);
    // Each text character points back at its source character.
    n.refs.forEach((_, i) => expect(n.text[i] === " " || source[n.offsets[i]!] === n.text[i]).toBe(true));
  });
});

describe("TextBuilder", () => {
  it("joins sources without inventing spaces, separates them at boundaries", () => {
    const b = new TextBuilder<string>();
    b.append("x", "Hig");
    b.append("y", "hl");
    b.append("z", "ight");
    b.boundary("w");
    b.append("w", "next");
    expect(b.finish().text).toBe("Highlight next");
  });
});
