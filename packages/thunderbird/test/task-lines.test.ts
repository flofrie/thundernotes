/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { bracketPath, laneLeftOf } from "../src/task-lines.js";

describe("lines from a selected task to its sub-tasks (D38)", () => {
  it("goes out to the lane, along it, and into each row with an arrow", () => {
    expect(bracketPath({ x: 0, y: 10 }, [{ x: 0, y: 40 }], -8)).toBe("M-1 10H-8M-8 10V40M-8 40H-2M-6 36L-2 40L-6 44");
  });
  it("spans the trunk over targets above and below, into indented rows", () => {
    const d = bracketPath({ x: 0, y: 50 }, [{ x: 0, y: 20 }, { x: 24, y: 80 }], -15);
    expect(d).toContain("M-15 20V80");
    expect(d).toContain("M-15 80H22");
  });
  it("draws nothing without targets", () => {
    expect(bracketPath({ x: 0, y: 10 }, [], -8)).toBe("");
  });
  it("keeps the lane left of rows it passes, not only those it joins", () => {
    // A sub-task (x 48) to its parent (x 24), passing a row further out (x 0, its own parent hidden).
    const rows = [{ x: 24, y: 10 }, { x: 0, y: 30 }, { x: 48, y: 50 }, { x: 0, y: 70 }];
    expect(laneLeftOf([{ x: 48, y: 50 }, { x: 24, y: 10 }], rows)).toBe(0);
    expect(laneLeftOf([{ x: 48, y: 50 }], rows)).toBe(48);
  });
});
