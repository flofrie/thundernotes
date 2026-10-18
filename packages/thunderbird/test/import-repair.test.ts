/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { toMarkdown, type AnnotationSet } from "@thundernotes/core";

const stored = new Map<string, AnnotationSet>();
const putSet = vi.fn(async (set: AnnotationSet) => { stored.set(set.email.messageId, set); });
vi.mock("../src/store.js", () => ({
  getSet: async (_accountId: string | undefined, id: string) => stored.get(id) ?? null,
  putSet: (set: AnnotationSet) => putSet(set),
  getAllSets: async () => [...stored.values()],
}));
vi.mock("../src/tags.js", () => ({ tagCopies: async () => {} }));

function anything(): any {
  return new Proxy(() => {}, {
    get: (_, k) => k === "then" ? undefined : anything(),
    apply: () => Promise.resolve({}),
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

it("saves a malformed first frame despite a newer local email note, without duplicating it on reimport", async () => {
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(readFileSync(new URL("../options.html", `file://${__filename}`), "utf8"))![1]!.replace(/<script[^>]*><\/script>/g, "");
  vi.stubGlobal("messenger", new Proxy(anything(), {
    get: (base, k) => k === "accounts" ? {
      list: async () => [{ id: "work", name: "Work", type: "imap", identities: [{ email: "work@example.com" }] }],
    } : k === "storage" ? {
      local: { get: async () => ({}), set: async () => {} }, onChanged: anything(),
    } : k === "tabs" ? { query: async () => [] } : base[k],
  }));
  const old = "2026-10-01T00:00:00.000Z";
  const later = "2026-10-18T00:00:00.000Z";
  const original: AnnotationSet = {
    version: 1, email: { messageId: "recovery@example.com", subject: "Offer", account: "work@example.com" },
    rev: 1, created: old, updated: old, emailNoteUpdated: old,
    emailNoteMd: "RECOVER THIS TEXT", annotations: [],
  };
  stored.set(original.email.messageId, {
    ...original, email: { messageId: original.email.messageId, subject: "Offer", accountId: "work" },
    updated: later, emailNoteUpdated: later, emailNoteMd: "Newer local note",
  });
  const damaged = toMarkdown(original).replace(/^# Offer\n/m, "");
  await import("../src/options.js");
  const input = document.getElementById("file") as HTMLInputElement;
  const importing = async () => {
    document.getElementById("status")!.textContent = "";
    const files = [new File([damaged], "damaged.md", { type: "text/markdown" })];
    Object.defineProperty(input, "files", { value: Object.assign(files, { item: (i: number) => files[i] }), configurable: true });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.getElementById("status")!.textContent).toMatch(/^Read /));
  };
  await importing();
  const saved = stored.get(original.email.messageId)!;
  expect(putSet).toHaveBeenCalledTimes(1);
  expect(saved.email.accountId).toBe("work");
  expect(saved.emailNoteMd).toBe("Newer local note");
  expect(saved.annotations).toHaveLength(1);
  expect(saved.annotations[0]!.bodyMd).toBe("RECOVER THIS TEXT");
  expect(saved.annotations[0]!.selectors).toEqual([{ type: "TextQuoteSelector", exact: "" }]);
  expect(document.getElementById("status")!.textContent).toContain("body title missing");
  await importing();
  expect(putSet).toHaveBeenCalledTimes(1);
  expect(stored.get(original.email.messageId)!.annotations).toEqual(saved.annotations);
  expect(document.getElementById("status")!.textContent).toContain("1 unchanged");
});
