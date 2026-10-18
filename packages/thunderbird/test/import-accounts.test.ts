/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// Dev issue #4: an import goes to the account its file names (D42), never to another one; files
// naming no account go where the email is.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { toMarkdown, type AnnotationSet } from "@thundernotes/core";

const stored = new Map<string, AnnotationSet>();
const key = (accountId: string | undefined, id: string) => `${accountId ?? ""}|${id}`;
vi.mock("../src/store.js", () => ({
  getSet: async (accountId: string | undefined, id: string) => stored.get(key(accountId, id)) ?? null,
  putSet: async (set: AnnotationSet) => void stored.set(key(set.email.accountId, set.email.messageId), set),
  getAllSets: async () => [...stored.values()],
}));
const tagged: (string | undefined)[] = [];
vi.mock("../src/tags.js", () => ({ tagCopies: async (_id: string, _on: boolean, _skip: string, accountId?: string) => void tagged.push(accountId) }));

/** Any API: listeners registered and forgotten, calls answering an empty object. */
function anything(path: string[] = []): any {
  return new Proxy(() => {}, {
    get: (_, k) => (k === "then" ? undefined : anything([...path, String(k)])),
    apply: () => Promise.resolve({}),
  });
}

const file = (messageId: string, account: string | undefined, note: string) => {
  const set: AnnotationSet = {
    version: 1,
    email: { messageId, subject: "Offer", ...(account ? { account } : {}) },
    rev: 1,
    created: "2026-10-10T08:00:00Z",
    updated: "2026-10-10T08:00:00Z",
    emailNoteMd: note,
    annotations: [],
  };
  return new File([toMarkdown(set)], `${messageId}.md`, { type: "text/markdown" });
};

describe("import into the account the file names", () => {
  it("never puts notes for a missing account into another one", async () => {
    document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(readFileSync(new URL("../options.html", `file://${__filename}`), "utf8"))![1]!.replace(/<script[^>]*><\/script>/g, "");
    const accounts = [
      { id: "private", name: "Personal", type: "imap", identities: [{ email: "personal@example.com" }] },
      { id: "work", name: "Work", type: "imap", identities: [{ email: "work@example.com" }, { email: "sales@example.com" }] },
    ];
    // Every email is in the personal account.
    const copy = (id: string) => ({ id: 1, headerMessageId: id, tags: [], folder: { accountId: "private", name: "INBOX", path: "/INBOX" } });
    (globalThis as any).messenger = new Proxy(anything(), {
      get: (base, k) =>
        k === "accounts"
          ? { list: async () => accounts }
          : k === "messages"
            ? { query: async ({ headerMessageId }: { headerMessageId: string }) => ({ id: null, messages: [copy(headerMessageId)] }) }
            : k === "storage"
              ? { local: { get: async () => ({}), set: async () => {} }, onChanged: anything() }
              : k === "runtime"
                ? { sendMessage: async () => {}, onMessage: anything(), getManifest: () => ({ version: "0" }) }
                : k === "tabs"
                  ? { query: async () => [] }
                  : base[k],
    });
    await import("../src/options.js");

    const input = document.getElementById("file") as HTMLInputElement;
    const importing = (files: File[]) => {
      Object.defineProperty(input, "files", { value: Object.assign(files, { item: (i: number) => files[i] }), configurable: true });
      input.dispatchEvent(new Event("change"));
      return vi.waitFor(() => expect(document.getElementById("status")!.textContent).toMatch(/^Read /));
    };
    await importing([
      file("none@x", undefined, "no account named"),
      file("named@x", "work@example.com", "work note"),
      file("alias@x", "SALES@example.com", "sales note"),
      file("shared@x", "gone@example.com", "confidential work note"),
    ]);
    // Named none: where the email is. Named: that account, by any of its addresses.
    expect(stored.get(key("private", "none@x"))?.emailNoteMd).toBe("no account named");
    expect(stored.get(key("work", "named@x"))?.emailNoteMd).toBe("work note");
    expect(stored.get(key("work", "alias@x"))?.emailNoteMd).toBe("sales note");
    // Named but not in Thunderbird (unknown, or removed): waits for it, not in the personal account.
    expect(stored.get(key("private", "shared@x"))).toBeUndefined();
    expect(stored.get(key(undefined, "shared@x"))?.email.account).toBe("gone@example.com");
    expect(stored.get(key("work", "named@x"))?.email.account).toBeUndefined();
    expect(document.getElementById("status")!.textContent).toContain("for an account that isn't in Thunderbird (gone@example.com)");
    expect(tagged).not.toContain(undefined); // nothing tagged in every account
  });
});
