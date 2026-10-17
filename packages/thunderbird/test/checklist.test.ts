/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { isoDate } from "@thundernotes/core";
import { cycleTask, expandTaskShortcut, toggleChecklist } from "../src/checklist.js";

const done = ` ✅ ${isoDate(new Date())}`;

describe("cycleTask (Cmd/Ctrl+L)", () => {
  it("cycles plain -> unchecked -> checked -> unchecked", () => {
    expect(cycleTask("buy milk")).toBe("- [ ] buy milk");
    expect(cycleTask("- [ ] buy milk")).toBe(`- [x] buy milk${done}`); // with the day it was finished (D38)
    expect(cycleTask(`- [x] buy milk${done}`)).toBe("- [ ] buy milk");
  });
  it("with the setting, goes from checked back to plain text", () => {
    expect(cycleTask(`- [x] buy milk${done}`, true)).toBe("buy milk");
    expect(cycleTask("- [ ] buy milk", true)).toBe(`- [x] buy milk${done}`);
    expect(cycleTask("2. [x] step", true)).toBe("2. step");
  });
  it("keeps indentation and existing list markers", () => {
    expect(cycleTask("  - item")).toBe("  - [ ] item");
    expect(cycleTask("3. step")).toBe("3. [ ] step");
    expect(cycleTask("")).toBe("- [ ] ");
  });
});

describe("toggleChecklist (Cmd/Ctrl+Shift+L)", () => {
  it("makes lines a checklist, skipping empty ones", () => {
    expect(toggleChecklist(["one", "", "- two", "- [x] three"])).toEqual(["- [ ] one", "", "- [ ] two", "- [x] three"]);
  });
  it("turns a checklist back into plain text", () => {
    expect(toggleChecklist(["- [ ] one", "- [x] two", "", "  - [ ] three"])).toEqual(["one", "two", "", "  three"]);
    expect(toggleChecklist(["1. [ ] step"])).toEqual(["1. step"]);
  });
});

describe("expandTaskShortcut ([] + space)", () => {
  it("expands at the start of a line, after indentation or a bullet", () => {
    expect(expandTaskShortcut("[]")).toBe("- [ ] ");
    expect(expandTaskShortcut("[ ]")).toBe("- [ ] ");
    expect(expandTaskShortcut("  []")).toBe("  - [ ] ");
    expect(expandTaskShortcut("- []")).toBe("- [ ] ");
    expect(expandTaskShortcut("2. []")).toBe("2. [ ] ");
  });
  it("leaves other text alone", () => {
    expect(expandTaskShortcut("see []")).toBeNull();
    expect(expandTaskShortcut("[x]")).toBeNull();
  });
});
