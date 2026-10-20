/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// Notes on pictures (D46): the stored address, finding the picture again, the file format.

import { describe, expect, it } from "vitest";
import { anchorImage, describeImage, extractText, fromMarkdown, quoteLabel, toMarkdown, imageKey, type AnnotationSet, type ImageSelector } from "../src/index.js";

const show = (html: string) => {
  document.body.innerHTML = html;
  return extractText(document.body);
};
const img = (n: number) => document.body.getElementsByTagName("img")[n]!;
/** The selector for picture `n` of `html`. */
const selectorIn = (html: string, n: number) => describeImage(document.body, show(html), img(n));
/** Which picture (by place) the selector finds in `html`, and how. */
function find(html: string, selector: ImageSelector): { at: number; method?: string } {
  const { element, result } = anchorImage(document.body, show(html), selector);
  return { at: element ? [...document.body.getElementsByTagName("img")].indexOf(element) : -1, ...(result.status !== "orphan" && { method: result.method }) };
}

describe("imageKey", () => {
  it("keeps only the MIME part of an attached picture, whose address names this computer's folder", () => {
    expect(imageKey("mailbox:///Users/x/Profiles/Mail/Local%20Folders/Inbox?number=12&part=1.2&filename=logo.png")).toBe("part:1.2");
    expect(imageKey("imap://me@mail.example.com:993/fetch%3EUID%3E/INBOX%3E345?part=1.3.2&filename=a.jpg")).toBe("part:1.3.2");
  });

  it("keeps web addresses (shortened) and hashes embedded data", () => {
    expect(imageKey("https://example.com/a.png?part=2")).toBe("https://example.com/a.png?part=2");
    expect(imageKey(`https://t.example.com/${"x".repeat(1000)}`)).toHaveLength(300);
    expect(imageKey("data:image/png;base64,AAAA")).toMatch(/^data:[0-9a-f]{8}$/);
    expect(imageKey("data:image/png;base64,AAAA")).not.toBe(imageKey("data:image/png;base64,AAAB"));
  });
});

const EMAIL = `<p>Hello Anna,</p><p><img src="https://x.example/team.png" alt=" Our  team "></p>
  <p>Here is the plan.</p><p><img src="https://x.example/plan.png"></p><p>Regards</p>`;

describe("describing and finding a picture", () => {
  it("records address, place, alt text and the text around it", () => {
    expect(selectorIn(EMAIL, 1)).toEqual({
      type: "ImageSelector",
      src: "https://x.example/plan.png",
      index: 1,
      prefix: "Hello Anna, Here is the plan. ",
      suffix: "Regards",
    });
    expect(selectorIn(EMAIL, 0).alt).toBe("Our team");
  });

  it("finds it at its place in the same email", () => {
    expect(find(EMAIL, selectorIn(EMAIL, 1))).toEqual({ at: 1, method: "position" });
  });

  it("finds it by its address when its place changed", () => {
    const s = selectorIn(EMAIL, 1);
    expect(find(`<p><img src="https://x.example/new.png"></p>${EMAIL}`, s)).toEqual({ at: 2, method: "quote" });
  });

  it("tells the same picture used twice apart by the text around it", () => {
    const twice = `<p>One</p><img src="s.gif"><p>Two</p><img src="s.gif"><p>Three</p>`;
    const s = selectorIn(twice, 1);
    expect(find(`<img src="other.gif">${twice}`, s)).toEqual({ at: 2, method: "context" });
  });

  it("finds it by the text around it when its address changed, if that text is unique", () => {
    const s = selectorIn(EMAIL, 1);
    expect(find(EMAIL.replace("plan.png", "plan-v2.png"), s)).toEqual({ at: 1, method: "context" });
  });

  it("finds nothing when address and surroundings are gone", () => {
    const s = selectorIn(EMAIL, 1);
    expect(find("<p>A different email</p><img src='z.png'>", s)).toEqual({ at: -1 });
    expect(find("<p>No pictures here.</p>", s)).toEqual({ at: -1 });
  });
});

describe("quoteLabel", () => {
  it("is the quote, the picture's label, or nothing for the whole-email note", () => {
    expect(quoteLabel({ selectors: [{ type: "TextQuoteSelector", exact: "the clause" }] })).toBe("the clause");
    expect(quoteLabel({ selectors: [{ type: "ImageSelector", src: "a", index: 0, alt: "Logo" }] })).toBe("🖼 Logo");
    expect(quoteLabel({ selectors: [{ type: "ImageSelector", src: "a", index: 0 }] })).toBe("🖼 Picture");
    expect(quoteLabel({ selectors: [] })).toBeUndefined();
  });
});

describe("a picture note in the file format", () => {
  const at = "2026-10-19T09:00:00.000Z";
  const set: AnnotationSet = {
    version: 1,
    email: { messageId: "<pic@example.com>", subject: "Photos" },
    rev: 1,
    created: at,
    updated: at,
    annotations: [
      {
        id: "p1",
        selectors: [{ type: "ImageSelector", src: "part:1.2", index: 3, alt: "Site plan", prefix: "see below: ", suffix: "Regards" }],
        bodyMd: "Check the north gate.",
        colour: "green",
        created: at,
        updated: at,
      },
    ],
  };

  it("survives writing and reading", () => {
    expect(fromMarkdown(toMarkdown(set))).toEqual(set);
  });

  it("writes an empty quote (older versions place it nowhere) and the picture's label as the heading", () => {
    const md = toMarkdown(set);
    expect(md).toContain("quote: \"\"");
    expect(md).toContain("image:\n      src: part:1.2\n      index: 3\n");
    expect(md).toContain("## “🖼 Site plan” <!-- tn:p1 -->");
  });

  it("keeps it in a deleted note's copy", () => {
    const deleted: AnnotationSet = { ...set, annotations: [], tombstones: [{ id: "p1", deleted: at, annotation: set.annotations[0]! }] };
    expect(fromMarkdown(toMarkdown(deleted)).tombstones![0]!.annotation!.selectors).toEqual(set.annotations[0]!.selectors);
  });
});
