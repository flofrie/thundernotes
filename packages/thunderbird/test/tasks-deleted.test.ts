/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// D43: an email in the Trash is left alone: its tasks aren't listed.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationSet } from "@thundernotes/core";

const set = (messageId: string, md: string): AnnotationSet => ({
  version: 1,
  email: { messageId, subject: "Offer", from: "Anna <anna@x>", date: "2026-10-10T08:00:00Z", accountId: "work" },
  rev: 1,
  created: "2026-10-10T08:00:00Z",
  updated: "2026-10-10T08:00:00Z",
  emailNoteMd: md,
  annotations: [],
});

vi.mock("../src/store.js", () => ({ getAllSets: async () => [set("kept@x", "- [ ] still to do"), set("binned@x", "- [ ] in the trash"), set("lost@x", "- [ ] email gone")] }));

describe("deleted emails in the task view (D43)", () => {
  it("doesn't list the tasks of an email in the Trash", async () => {
    const sent: { type: string }[] = [];
    const stored: Record<string, unknown>[] = [];
    const opened: boolean[] = [];
    const body = /<body>([\s\S]*)<\/body>/.exec(readFileSync(new URL("../tasks.html", `file://${__filename}`), "utf8"))![1]!;
    document.body.innerHTML = body.replace(/<script[^>]*><\/script>/, "");
    (globalThis as any).messenger = {
      runtime: { sendMessage: async (m: { type: string }) => (sent.push(m), true), onMessage: { addListener() {} }, openOptionsPage: async () => void opened.push(true) },
      storage: {
        local: {
          get: async (k: string) => (k === "deletedEmails" ? { deletedEmails: { "work|binned@x": "trash", "work|lost@x": "missing" } } : {}),
          set: async (items: Record<string, unknown>) => void stored.push(items),
        },
        onChanged: { addListener() {} },
      },
      tabs: { getCurrent: async () => ({ id: 1, windowId: 1 }) },
      windows: { openDefaultBrowser: async () => {} },
      accounts: { list: async () => [] },
    };
    await import("../src/tasks.js");
    await new Promise((r) => setTimeout(r, 0));
    const texts = () => [...document.querySelectorAll("li.entry .text")].map((t) => t.textContent!.trim()).sort();
    expect(texts()).toEqual(["email gone", "still to do"]);
    // D44: an email that can't be found: marked in red; hovering explains, with a link to the settings.
    const lost = [...document.querySelectorAll<HTMLElement>("li.entry")].find((r) => r.textContent!.includes("email gone"))!;
    const marker = lost.querySelector<HTMLElement>(".meta .missing")!;
    expect(marker.firstChild!.textContent).toBe("email not found");
    expect(marker.querySelector(".missing-tip")!.textContent).toBe(
      "This task comes from a note in an email that's not on the server anymore. The recommended action is to delete the notes that relate to that email in the settings."
    );
    // No "delete the notes" on a task's own menu: a task's menu acting on a whole note was unexpected.
    lost.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect([...document.querySelectorAll(".edit-menu li")].some((li) => li.textContent!.includes("Delete the notes"))).toBe(false);
    // The link in the explanation, and the marker itself: straight to the orphaned notes in the settings.
    marker.querySelector<HTMLElement>(".missing-tip a")!.click();
    expect(sent.at(-1)).toEqual({ type: "openOptionsAt", section: "missing", key: "work|lost@x" });
    sent.length = 0;
    marker.click();
    expect(sent).toEqual([{ type: "openOptionsAt", section: "missing", key: "work|lost@x" }]);
  });
});
