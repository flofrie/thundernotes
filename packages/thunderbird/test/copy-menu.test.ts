/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// The settings page's right-click menu (copy-menu.ts, D47): none, or "Copy" with text selected.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installCopyMenu } from "../src/copy-menu.js";

let copied: string[];
let remove: () => void;
beforeEach(() => {
  document.body.innerHTML = `<p id="text">Use the last colour for new highlights</p><input id="field" value="MacBook">`;
  copied = [];
  remove = installCopyMenu(document, (t) => void copied.push(t));
});
afterEach(() => remove());

const rightClick = (target: Element) => {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 40 });
  target.dispatchEvent(e);
  return e;
};
const select = (el: Element) => {
  const range = document.createRange();
  range.selectNodeContents(el);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
};
const menu = () => document.querySelector(".copy-menu");

describe("the settings page's right-click menu", () => {
  it("shows no menu at all without a selection", () => {
    document.getSelection()!.removeAllRanges();
    expect(rightClick(document.getElementById("text")!).defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
  });

  it("offers Copy with text selected, which copies it and closes", () => {
    select(document.getElementById("text")!);
    expect(rightClick(document.getElementById("text")!).defaultPrevented).toBe(true);
    const items = [...menu()!.querySelectorAll("button")];
    expect(items.map((b) => b.querySelector("span")!.textContent)).toEqual(["Copy"]);
    items[0]!.click();
    expect(copied).toEqual(["Use the last colour for new highlights"]);
    expect(menu()).toBeNull();
  });

  it("closes on Esc or a click elsewhere", () => {
    select(document.getElementById("text")!);
    rightClick(document.getElementById("text")!);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu()).toBeNull();
    rightClick(document.getElementById("text")!);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu()).toBeNull();
  });

  it("leaves text fields their usual menu (paste)", () => {
    expect(rightClick(document.getElementById("field")!).defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });
});
