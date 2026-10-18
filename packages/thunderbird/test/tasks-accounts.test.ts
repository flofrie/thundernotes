/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// D42: tasks from several accounts, each with its account; a filter narrows to one; labels in
// their account's colours.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationSet } from "@thundernotes/core";

const set = (accountId: string, md: string): AnnotationSet => ({
  version: 1,
  email: { messageId: "same@x", subject: "Offer", from: "Anna <anna@x>", date: "2026-10-10T08:00:00Z", accountId },
  rev: 1,
  created: "2026-10-10T08:00:00Z",
  updated: "2026-10-10T08:00:00Z",
  emailNoteMd: md,
  annotations: [],
});

vi.mock("../src/store.js", () => ({ getAllSets: async () => [set("work", "- [ ] send contract #urgent"), set("home", "- [ ] buy paint #urgent")] }));

describe("tasks from several accounts (D42)", () => {
  it("shows each task's account, filters by account, and colours labels by account", async () => {
    const body = /<body>([\s\S]*)<\/body>/.exec(readFileSync(new URL("../tasks.html", `file://${__filename}`), "utf8"))![1]!;
    document.body.innerHTML = body.replace(/<script[^>]*><\/script>/, "");
    const labelSettings = {
      work: { version: 1, labelColours: { urgent: { colour: "red", updated: "2026-10-18T10:00:00Z" } } },
      home: { version: 1, labelColours: { urgent: { colour: "blue", updated: "2026-10-18T10:00:00Z" } } },
    };
    (globalThis as any).messenger = {
      runtime: { sendMessage: async () => true, onMessage: { addListener() {} } },
      storage: { local: { get: async (k: string) => (k === "labelSettings" ? { labelSettings } : {}) }, onChanged: { addListener() {} } },
      tabs: { getCurrent: async () => ({ id: 1, windowId: 1 }) },
      windows: { openDefaultBrowser: async () => {} },
      accounts: { list: async () => [{ id: "work", name: "Work" }, { id: "home", name: "Home" }] },
    };
    await import("../src/tasks.js");
    await new Promise((r) => setTimeout(r, 0));
    const rows = () => [...document.querySelectorAll<HTMLElement>("li.entry")];
    expect(rows().map((r) => r.dataset.account).sort()).toEqual(["home", "work"]);
    expect(rows().map((r) => r.querySelector(".account")?.textContent).sort()).toEqual([" · Home", " · Work"]);
    // Each row's label in its account's colour; the label row in the first account's (Work).
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toMatch(/li\.entry\[data-account="work"\] \.tn-chip\.tn-label\[data-label="urgent"\][^{]*\{ background: rgba\(183, 35, 35/);
    expect(css).toMatch(/li\.entry\[data-account="home"\] \.tn-chip\.tn-label\[data-label="urgent"\][^{]*\{ background: rgba\(116, 192, 252/);
    // Coloured differently in the two accounts: the chip at the top split in two, the tooltip saying whose is which.
    expect(css).toMatch(/#labels \.label-chip\.label-chip\[data-label="urgent"\][^{]*\{ background: linear-gradient\(90deg, rgba\(183, 35, 35, 0\.3\) 0% 50%, rgba\(116, 192, 252, 0\.3\) 50% 100%\)/);
    expect(document.querySelector<HTMLElement>('#labels .label-chip[data-label="urgent"]')!.title).toContain("Colours: Work: red, Home: blue");
    // Only Home: one task, no account names (no need).
    const home = [...document.querySelectorAll<HTMLButtonElement>("#controls .switch button")].find((b) => b.textContent === "Home")!;
    home.click();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.dataset.account).toBe("home");
    expect(rows()[0]!.querySelector(".account")).toBeNull();
  });
});
