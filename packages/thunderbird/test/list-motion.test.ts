/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { animateFrom, measure } from "../src/list-motion.js";

/** An element with a key at a given height, recording its animations. */
function row(root: HTMLElement, key: string, top: number) {
  const el = document.createElement("div");
  el.dataset.key = key;
  el.getBoundingClientRect = () => ({ left: 0, top, right: 100, bottom: top + 20, width: 100, height: 20, x: 0, y: top, toJSON() {} }) as DOMRect;
  const animate = vi.fn();
  (el as unknown as { animate: typeof animate }).animate = animate;
  root.append(el);
  return { el, animate };
}

describe("rows moving to their new places", () => {
  it("slides a row from where it was, fades a new one in, leaves unmoved ones", () => {
    const root = document.createElement("div");
    row(root, "a", 0);
    row(root, "b", 30);
    const before = measure(root);
    root.replaceChildren();
    const b = row(root, "b", 0); // b moved up
    const a = row(root, "a", 30); // a moved down
    const c = row(root, "c", 60); // new
    const same = row(root, "x", 90);
    before.set("x", same.el.getBoundingClientRect());
    animateFrom(root, before);
    expect(b.animate.mock.calls[0][0][0]).toEqual({ transform: "translate(0px, 30px)" });
    expect(a.animate.mock.calls[0][0][0]).toEqual({ transform: "translate(0px, -30px)" });
    expect(c.animate.mock.calls[0][0][0]).toEqual({ opacity: 0 });
    expect(same.animate).not.toHaveBeenCalled();
  });

  it("doesn't move anything with 'reduce motion'", () => {
    const root = document.createElement("div");
    row(root, "a", 0);
    const before = measure(root);
    root.replaceChildren();
    const a = row(root, "a", 40);
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce") })) as unknown as typeof window.matchMedia;
    animateFrom(root, before);
    window.matchMedia = original;
    expect(a.animate).not.toHaveBeenCalled();
  });
});
