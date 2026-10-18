/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Requests from an email reaching the background: the email's account decides (D42).

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AnnotationSet } from "@thundernotes/core";

const setLabelColour = vi.fn(async () => {});
vi.mock("../src/sync.js", async (original) => ({ ...(await original<typeof import("../src/sync.js")>()), setLabelColour, schedulePush: () => {} }));
const stored = new Map<string, AnnotationSet>();
const key = (accountId: string | undefined, id: string) => `${accountId ?? ""}|${id}`;
vi.mock("../src/store.js", () => ({
  getSet: async (accountId: string | undefined, id: string) => stored.get(key(accountId, id)) ?? null,
  putSet: async (set: AnnotationSet, from?: string) => {
    stored.set(key(set.email.accountId, set.email.messageId), set);
    if (from !== undefined && from !== (set.email.accountId ?? "")) stored.delete(key(from, set.email.messageId));
  },
  deleteSet: async (accountId: string | undefined, id: string) => void stored.delete(key(accountId, id)),
  getAllSets: async () => [...stored.values()],
  onSetsChanged: () => {},
}));

/** Any API: listeners registered and forgotten, calls answering an empty object. */
function anything(path: string[] = []): any {
  return new Proxy(() => {}, {
    get: (_, k) => (k === "then" ? undefined : anything([...path, String(k)])),
    apply: () => (path.at(-1) === "getURL" ? "moz-extension://x/tasks.html" : Promise.resolve({})),
  });
}

let listener: (request: unknown, sender: unknown) => unknown = () => {};
const header = { id: 7, headerMessageId: "mail@x", subject: "Offer", author: "a@x", date: 0, tags: [] as string[], folder: { accountId: "work", path: "/INBOX", name: "INBOX" } };
const accounts = [
  { id: "private", name: "Personal", type: "imap", identities: [{ email: "personal@example.com" }] },
  { id: "work", name: "Work", type: "imap", identities: [{ email: "work@example.com" }] },
];

beforeAll(async () => {
  (globalThis as any).messenger = new Proxy(anything(), {
    get: (base, k) =>
      k === "runtime"
        ? { onMessage: { addListener: (l: typeof listener) => (listener = l) }, getURL: () => "moz-extension://x/tasks.html", getManifest: () => ({ version: "0" }), sendMessage: async () => {}, onInstalled: anything(), onStartup: anything() }
        : k === "messageDisplay"
          ? { getDisplayedMessages: async () => ({ messages: [header] }), onMessagesDisplayed: anything() }
          : k === "accounts"
            ? { list: async () => accounts, get: async (id: string) => accounts.find((a) => a.id === id) }
            : base[k],
  });
  await import("../src/background.js");
});

describe("from an email", () => {
  // Dev issue #3.
  it("changes a label's colour only in the account of the email it was changed in", async () => {
    await listener({ type: "setLabelColour", label: "urgent", colour: "red", ref: "mail@x", refAccount: "work" }, { tab: { id: 3 } });
    expect(setLabelColour).toHaveBeenLastCalledWith("urgent", "red", ["work"]);
    // From the task view: the accounts it names.
    await listener({ type: "setLabelColour", label: "urgent", colour: "blue", accountIds: ["work", "home"] }, { tab: { id: 4 } });
    expect(setLabelColour).toHaveBeenLastCalledWith("urgent", "blue", ["work", "home"]);
  });

  // Dev issue #4.
  it("shows notes imported for another account only in that account's copy of the email", async () => {
    const waiting: AnnotationSet = {
      version: 1,
      email: { messageId: "mail@x", subject: "Offer", account: "work@example.com" },
      rev: 1,
      created: "2026-10-10T08:00:00Z",
      updated: "2026-10-10T08:00:00Z",
      emailNoteMd: "work note",
      annotations: [],
    };
    stored.set(key(undefined, "mail@x"), waiting);
    const load = async () => (await listener({ type: "load", ref: "mail@x", refAccount: header.folder.accountId }, { tab: { id: 3 } })) as { set: AnnotationSet | null };
    header.folder.accountId = "private";
    expect((await load()).set).toBeNull();
    expect(stored.get(key(undefined, "mail@x"))).toBe(waiting);
    header.folder.accountId = "work";
    expect((await load()).set?.emailNoteMd).toBe("work note");
    expect(stored.get(key("work", "mail@x"))?.email.account).toBeUndefined();
    expect(stored.has(key(undefined, "mail@x"))).toBe(false);
  });

  // D22: the card asks; the background has the Markdown parser.
  it("converts the k-th @ date with that text outside code", async () => {
    const md = "```\n@24.10.27\n```\n@24.10.27 and @24.10.27";
    expect(await listener({ type: "convertLooseDate", md, text: "@24.10.27", k: 1, ref: "mail@x", refAccount: "work" }, { tab: { id: 3 } })).toBe("```\n@24.10.27\n```\n@24.10.27 and @2027-10-24");
    expect(await listener({ type: "convertLooseDate", md, text: "@24.10.27", k: 2, ref: "mail@x", refAccount: "work" }, { tab: { id: 3 } })).toBeNull();
  });
});
