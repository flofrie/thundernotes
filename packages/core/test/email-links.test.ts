/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { emailLink, linkText, linkedMessageIds, messageIdOf, midUrl, renderMarkdown, senderName } from "../src/index.js";

describe("links between emails (D37)", () => {
  it("writes a readable Markdown link to the Message-ID", () => {
    const link = emailLink(
      { messageId: "<abc(1)/x@example.com>", subject: "Contract [draft]", author: "Anna Meier <anna@example.com>", date: "2026-10-12T09:00:00Z" },
      "en-GB"
    );
    expect(link).toBe("[Contract [draft] – Anna Meier, 12 Oct 2026](mid:abc%281%29%2Fx@example.com)");
    expect(linkedMessageIds(`see ${link} and <mid:other@x>`)).toEqual(["abc(1)/x@example.com", "other@x"]);
  });

  it("escapes only brackets without a partner", () => {
    expect(linkText("[tn-spike] C")).toBe("[tn-spike] C");
    expect(linkText("a ] b [ c")).toBe("a \\] b \\[ c");
    expect(renderMarkdown(`[${linkText("[x] y")}](mid:a@b)`)).toContain(">[x] y</a>");
  });

  it("round-trips Message-IDs and finds sender names", () => {
    expect(messageIdOf(midUrl("a b+c@x"))).toBe("a b+c@x");
    expect(messageIdOf("https://example.com")).toBeNull();
    expect(senderName('"Meier, Anna" <anna@x>')).toBe("Meier, Anna");
    expect(senderName("anna@x")).toBe("anna@x");
  });

  it("keeps mid: links when rendering", () => {
    expect(renderMarkdown("[mail](mid:abc@x)")).toContain('href="mid:abc@x"');
  });
});
