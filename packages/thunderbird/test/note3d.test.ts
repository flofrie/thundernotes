/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// The settings page's 3D post-it (note3d.ts): its shape, and the flat icon kept without WebGL.

import { describe, expect, it, vi } from "vitest";
import { OUTLINE, angerAt, leanToward, repoke, buildMesh, foldedCorner, mountNote3d, rotateAbout } from "../src/note3d.js";

describe("the 3D post-it's shape", () => {
  it("folds the cut-off corner over the sheet, standing a little off it", () => {
    const [a, b, tip] = foldedCorner();
    // Over the sheet, near where the corner lands when folded flat (mirrored over the cut).
    expect(tip[0]).toBeLessThan(a[0]);
    expect(tip[1]).toBeGreaterThan(b[1]);
    expect(tip[2]).toBeGreaterThan(a[2]); // towards the viewer, not into the sheet
    // The fold keeps the corner's distance from the cut's ends.
    const dist = (p: number[], q: number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
    expect(dist(tip, a)).toBeCloseTo(dist([1, -1, a[2]], a), 6);
    expect(dist(tip, b)).toBeCloseTo(dist([1, -1, b[2]], b), 6);
  });

  it("rotates about a line", () => {
    const p = rotateAbout([1, 0, 0], [0, 0, 0], [0, 0, 1], Math.PI / 2);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(1);
  });

  it("is made of whole triangles with unit normals, the outline convex and counter-clockwise", () => {
    const mesh = buildMesh();
    expect((mesh.length / 9) % 3).toBe(0);
    for (let i = 0; i < mesh.length; i += 9) expect(Math.hypot(mesh[i + 3]!, mesh[i + 4]!, mesh[i + 5]!)).toBeCloseTo(1, 5);
    for (let i = 0; i < OUTLINE.length; i++) {
      const [p, q, r] = [OUTLINE[i]!, OUTLINE[(i + 1) % OUTLINE.length]!, OUTLINE[(i + 2) % OUTLINE.length]!];
      expect((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])).toBeGreaterThan(0);
    }
  });
});

describe("a poke (right-click)", () => {
  it("makes it angry gradually, for a moment, then calm again", () => {
    expect(angerAt(-1)).toBe(0); // never poked
    // Growing over about half a second, without a jump at the start.
    expect(angerAt(30)).toBeLessThan(0.05);
    expect(angerAt(225)).toBeCloseTo(0.5);
    for (let ms = 0; ms < 450; ms += 15) expect(angerAt(ms + 15) - angerAt(ms)).toBeLessThan(0.08);
    expect(angerAt(800)).toBe(1);
    expect(angerAt(1500)).toBeGreaterThan(0);
    expect(angerAt(1500)).toBeLessThan(1);
    expect(angerAt(1900)).toBe(0);
  });

  it("poked again: never a jump in anger", () => {
    const now = 10_000;
    expect(repoke(5000, now)).toBe(now); // calm: starts over
    expect(repoke(300, now)).toBe(now - 300); // still growing: goes on
    const fading = angerAt(1500);
    const again = angerAt(now - repoke(1500, now));
    expect(Math.abs(again - fading)).toBeLessThan(0.03); // from where it was, growing again
  });
});

describe("leaning towards the pointer", () => {
  // The note near the top left of a wide window, as on the settings page.
  const centre = { x: 40, y: 50 };
  const view = { width: 1400, height: 900 };

  it("turns as far left as right, and as far up as down, at the window's edges", () => {
    expect(leanToward(0, 50, centre, view)).toEqual({ x: -1, y: 0 });
    expect(leanToward(1400, 50, centre, view)).toEqual({ x: 1, y: 0 });
    expect(leanToward(40, 0, centre, view)).toEqual({ x: 0, y: -1 });
    expect(leanToward(40, 900, centre, view)).toEqual({ x: 0, y: 1 });
  });

  it("turns halfway when the pointer is halfway to an edge, either side", () => {
    expect(leanToward(20, 50, centre, view).x).toBeCloseTo(-0.5);
    expect(leanToward(720, 50, centre, view).x).toBeCloseTo(0.5);
  });
});

describe("mountNote3d", () => {
  it("leaves the flat icon where WebGL isn't available", () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    document.body.innerHTML = `<h1><img src="icons/icon.svg" alt=""> ThunderNotes</h1>`;
    expect(mountNote3d(document.querySelector("img")!)).toBe(false);
    expect(document.querySelector("h1 img")).not.toBeNull();
    expect(document.querySelector("h1 canvas")).toBeNull();
    spy.mockRestore();
  });
});
