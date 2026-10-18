/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// Deleting a label from the label row: asked again, then taken out of every note, with Undo.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationSet } from "@thundernotes/core";

const set: AnnotationSet = {
  version: 1,
  email: { messageId: "m@x", subject: "Offer", from: "Anna <anna@x>", date: "2026-10-10T08:00:00Z", accountId: "work" },
  rev: 1,
  created: "2026-10-10T08:00:00Z",
  updated: "2026-10-10T08:00:00Z",
  emailNoteMd: "- [ ] call #urgent\n- [ ] write #urgent",
  annotations: [],
};
vi.mock("../src/store.js", () => ({ getAllSets: async () => [set] }));

describe("deleting a label (task view)", () => {
  it("asks first, deletes on Delete, offers Undo; Cancel does nothing", async () => {
    const body = /<body>([\s\S]*)<\/body>/.exec(readFileSync(new URL("../tasks.html", `file://${__filename}`), "utf8"))![1]!;
    document.body.innerHTML = body.replace(/<script[^>]*><\/script>/, "");
    const sent: { type: string }[] = [];
    const changes = [{ messageId: "m@x", noteId: "email-note", before: "a", after: "b" }];
    (globalThis as any).messenger = {
      runtime: {
        sendMessage: async (m: { type: string }) => (sent.push(m), m.type === "deleteLabel" ? { emails: 1, changes } : true),
        onMessage: { addListener() {} },
      },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
      tabs: { getCurrent: async () => ({ id: 1, windowId: 1 }) },
      windows: { openDefaultBrowser: async () => {} },
      accounts: { list: async () => [] },
    };
    await import("../src/tasks.js");
    await new Promise((r) => setTimeout(r, 0));
    const menuItem = (text: string) => [...document.querySelectorAll<HTMLElement>(".edit-menu li")].find((b) => b.textContent?.includes(text));
    const openChipMenu = () =>
      document.querySelector('#labels .label-chip[data-label="urgent"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("#notice button")];

    openChipMenu();
    menuItem("Delete label")!.click();
    expect(document.querySelector("#notice")!.textContent).toContain("Delete #urgent from every note it is in, in all accounts (2 tasks)?");
    buttons().find((b) => b.textContent === "Cancel")!.click();
    expect(sent.some((m) => m.type === "deleteLabel")).toBe(false);

    openChipMenu();
    menuItem("Delete label")!.click();
    buttons().find((b) => b.textContent === "Delete")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.at(-1)).toMatchObject({ type: "deleteLabel", label: "urgent" });
    expect(document.querySelector("#notice")!.textContent).toContain("#urgent deleted from 1 note on 1 email.");
    buttons().find((b) => b.textContent === "Undo")!.click();
    expect(sent.at(-1)).toEqual({ type: "restoreNotes", changes });
  });
});
