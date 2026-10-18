/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationSet } from "@thundernotes/core";

const note: AnnotationSet = {
  version: 1,
  email: { messageId: "a@x", subject: "Contract", from: "Anna <anna@x>", date: "2026-10-10T08:00:00Z" },
  rev: 1,
  created: "2026-10-10T08:00:00Z",
  updated: "2026-10-10T08:00:00Z",
  emailNoteMd: "- [ ] Prepare offer\n  - [ ] call Anna\n  - [x] send draft\n- Project Falcon\n  - [ ] kick-off",
  annotations: [],
};

vi.mock("../src/store.js", () => ({ getAllSets: async () => [note] }));

describe("sub-tasks in the task view (D38)", () => {
  it("shows what a task is part of, its sub-tasks' count, and lines from the selected one", async () => {
    const body = /<body>([\s\S]*)<\/body>/.exec(readFileSync(new URL("../tasks.html", `file://${__filename}`), "utf8"))![1]!;
    document.body.innerHTML = body.replace(/<script[^>]*><\/script>/, "");
    (globalThis as any).messenger = {
      runtime: { sendMessage: async () => true, onMessage: { addListener() {} } },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
      tabs: { getCurrent: async () => ({ id: 1, windowId: 1 }) },
      accounts: { list: async () => [] },
      windows: { openDefaultBrowser: async () => {} },
    };
    await import("../src/tasks.js");
    await new Promise((r) => setTimeout(r, 0));
    const row = (text: string) => [...document.querySelectorAll<HTMLElement>("li.entry")].find((r) => r.querySelector(".text")!.textContent!.includes(text))!;
    expect(row("Prepare offer").querySelector(".subcount")!.textContent).toBe("1/2");
    expect(row("call Anna").querySelector(".partof")!.textContent).toBe("↳ part of “Prepare offer”");
    expect(row("kick-off").querySelector("span.partof")!.textContent).toBe("↳ part of “Project Falcon”"); // a bullet: text only
    // Selecting the parent: a line to its shown sub-task; from the sub-task, one to the parent.
    row("Prepare offer").querySelector<HTMLElement>(".text")!.click();
    expect(document.querySelector("svg.task-lines path.sub")).not.toBeNull();
    expect(document.querySelector("svg.task-lines path.parent")).toBeNull();
    row("call Anna").querySelector<HTMLAnchorElement>("a.partof")!.click(); // selects the parent
    expect(row("Prepare offer").classList.contains("selected")).toBe(true);
    row("call Anna").querySelector<HTMLElement>(".text")!.click();
    expect(document.querySelector("svg.task-lines path.parent")).not.toBeNull();
    expect(document.querySelector("svg.task-lines path.sub")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector("svg.task-lines path")).toBeNull();
  });
});
