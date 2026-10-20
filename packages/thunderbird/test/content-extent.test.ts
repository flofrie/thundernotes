/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// Where the email's content ends (content-extent.ts, 0.76.1): what counts as content. jsdom has no
// layout, so each element's box is given by a data-right attribute (its right edge), and a text's
// lines by its parent's data-text-right.

import { beforeAll, describe, expect, it } from "vitest";
import { contentRight } from "../src/content-extent.js";

const box = (right: number) => new DOMRect(0, 0, right, 20);

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return box(Number(this.getAttribute("data-right") ?? 0));
  };
  (Range.prototype as Range & { getClientRects: () => DOMRect[] }).getClientRects = function (this: Range) {
    const right = (this.startContainer.parentNode as Element | null)?.getAttribute("data-text-right");
    return (right ? [box(Number(right))] : []) as unknown as DOMRectList;
  };
});

const right = (html: string) => {
  document.body.innerHTML = html;
  return contentRight(document.body);
};

describe("contentRight", () => {
  it("counts text and pictures, not the boxes around them", () => {
    expect(right(`<table data-right="1200" style="background: #eee"><tr><td data-right="900"><p data-right="900" data-text-right="700">Hello</p></td></tr></table>`)).toBe(700);
    expect(right(`<div data-right="1200"><p data-text-right="500">Hi</p><img data-right="760"></div>`)).toBe(760);
  });

  it("counts boxes drawn with a background image (banners), and media and form fields", () => {
    expect(right(`<div data-right="820" style="background-image: url(banner.png)"></div><p data-text-right="600">x</p>`)).toBe(820);
    expect(right(`<p data-text-right="600">x</p><video data-right="810"></video>`)).toBe(810);
    expect(right(`<p data-text-right="600">x</p><input data-right="640">`)).toBe(640);
  });

  it("leaves out what isn't shown, and empty text", () => {
    expect(right(`<p data-text-right="600">x</p><div style="display:none" data-text-right="1100">preview text</div>`)).toBe(600);
    expect(right(`<p data-text-right="600">x</p><span style="visibility:hidden" data-text-right="1100">hidden</span>`)).toBe(600);
    expect(right(`<p data-text-right="600">x</p><p data-text-right="1100">   </p>`)).toBe(600);
  });

  it("is -Infinity for an email with nothing in it", () => {
    expect(right(`<div data-right="1200" style="background: red"></div>`)).toBe(-Infinity);
  });
});
