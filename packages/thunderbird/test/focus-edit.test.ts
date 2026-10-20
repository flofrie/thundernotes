/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Opening a note for editing from outside the email (task view, the popup's "Note on this
// email"): open, focus the message pane, open again in the focused pane.

import { afterEach, describe, expect, it, vi } from "vitest";
import { openForEditing } from "../src/focus-edit.js";

afterEach(() => vi.useRealTimers());

describe("openForEditing", () => {
  it("opens the card, has the pane focused, then opens it again for editing", async () => {
    const steps: string[] = [];
    openForEditing(() => (steps.push("open"), true), async () => void steps.push("focus"));
    await Promise.resolve();
    await Promise.resolve();
    expect(steps).toEqual(["open", "focus", "open"]);
  });

  it("from the popup: moves the focus only after the popup had time to close", async () => {
    vi.useFakeTimers();
    const steps: string[] = [];
    openForEditing(() => (steps.push("open"), true), async () => void steps.push("focus"), 150);
    expect(steps).toEqual(["open"]); // not yet: the closing popup would take the focus back
    await vi.advanceTimersByTimeAsync(150);
    expect(steps).toEqual(["open", "focus", "open"]);
  });

  it("opens again even when focusing fails, and does nothing for a note that isn't there", async () => {
    const steps: string[] = [];
    openForEditing(() => (steps.push("open"), true), () => Promise.reject(new Error("no Experiment")));
    await Promise.resolve();
    await Promise.resolve();
    expect(steps).toEqual(["open", "open"]);
    const focus = vi.fn(async () => {});
    expect(openForEditing(() => false, focus)).toBe(false);
    expect(focus).not.toHaveBeenCalled();
  });
});
