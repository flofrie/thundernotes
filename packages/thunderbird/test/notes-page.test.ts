/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// The notes overview page (D48): its right-click menu, as on the settings page (D47).

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationSet } from "@thundernotes/core";

const set: AnnotationSet = {
  version: 1,
  email: { messageId: "a@x", subject: "Contract", from: "Anna <anna@x>", date: "2026-10-10T08:00:00Z" },
  rev: 1,
  created: "2026-10-10T08:00:00Z",
  updated: "2026-10-10T08:00:00Z",
  emailNoteMd: "Ask Anna about the offer",
  annotations: [],
};

vi.mock("../src/store.js", () => ({ getAllSets: async () => [set] }));

const rightClick = (target: Element) => {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
  target.dispatchEvent(e);
  return e;
};

describe("notes overview page (D48)", () => {
  it("has no browser menu on a right-click; Copy with text selected; text fields keep theirs", async () => {
    const body = /<body>([\s\S]*)<\/body>/.exec(readFileSync(new URL("../notes.html", `file://${__filename}`), "utf8"))![1]!;
    document.body.innerHTML = body.replace(/<script[^>]*><\/script>/, "");
    (globalThis as any).messenger = {
      runtime: { sendMessage: async () => true, onMessage: { addListener() {} } },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
      tabs: { getCurrent: async () => ({ id: 1, windowId: 1 }) },
      accounts: { list: async () => [] },
      windows: { openDefaultBrowser: async () => {} },
    };
    await import("../src/notes.js");
    await new Promise((r) => setTimeout(r, 0));
    const note = document.querySelector("li.note .text")!;
    expect(note.textContent).toContain("Ask Anna");

    expect(rightClick(note).defaultPrevented).toBe(true);
    expect(document.querySelector(".copy-menu")).toBeNull();

    document.getSelection()!.selectAllChildren(note);
    expect(rightClick(note).defaultPrevented).toBe(true);
    expect(document.querySelector(".copy-menu")!.textContent).toContain("Copy");

    expect(rightClick(document.getElementById("search")!).defaultPrevented).toBe(false);
  });
});
