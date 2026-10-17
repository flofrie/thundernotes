/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { linkForPaste } from "../src/links.js";

describe("pasting a URL", () => {
  it("writes a Markdown link with a short label", () => {
    expect(linkForPaste("https://www.example.com/", "")).toBe("[example.com](https://www.example.com/)");
    expect(linkForPaste(" https://example.com/a?b=1\n", "")).toBe("[example.com/a?b=1](https://example.com/a?b=1)");
    expect(linkForPaste("www.example.com/x", "")).toBe("[example.com/x](https://www.example.com/x)"); // www.: https:// added
    expect(linkForPaste("example.com", "")).toBeNull(); // a bare domain isn't taken for an address
    expect(linkForPaste("mailto:anna@example.com?subject=x", "")).toBe("[anna@example.com](mailto:anna@example.com?subject=x)");
  });

  it("uses the selected text as label", () => {
    expect(linkForPaste("https://example.com", "the [offer]")).toBe("[the [offer]](https://example.com)");
  });

  it("keeps brackets in the URL from ending the link", () => {
    expect(linkForPaste("https://en.wikipedia.org/wiki/Foo_(bar)", "Foo")).toBe("[Foo](https://en.wikipedia.org/wiki/Foo_%28bar%29)");
  });

  it("pastes as is when it isn't a URL or is already inside a link", () => {
    expect(linkForPaste("see https://example.com", "")).toBeNull();
    expect(linkForPaste("https://example.com", "", "[text](")).toBeNull();
    expect(linkForPaste("https://example.com", "", "<")).toBeNull();
  });
});

describe("line markup stays outside the link", () => {
  it("keeps heading, list and task markers and surrounding space out of the label", () => {
    expect(linkForPaste("https://example.com", "## Big title\n")).toBe("## [Big title](https://example.com)\n");
    expect(linkForPaste("https://example.com", "- [ ] buy milk")).toBe("- [ ] [buy milk](https://example.com)");
    expect(linkForPaste("https://example.com", "> quoted")).toBe("> [quoted](https://example.com)");
  });

  it("only at the start of a line", () => {
    expect(linkForPaste("https://example.com", "# not a heading", "see ")).toBe("[# not a heading](https://example.com)");
  });
});
