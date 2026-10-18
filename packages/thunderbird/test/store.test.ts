/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The local store (D42): keyed by account and Message-ID; a database from before (keyed by
// Message-ID only) is migrated without losing a note.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationSet } from "@thundernotes/core";

const set = (messageId: string, accountId: string | undefined, text: string): AnnotationSet => ({
  version: 1,
  email: { messageId, subject: "Test", ...(accountId ? { accountId } : {}) },
  rev: 1,
  created: "2026-10-18T10:00:00.000Z",
  updated: "2026-10-18T10:00:00.000Z",
  annotations: [{ id: "a1", selectors: [{ type: "TextQuoteSelector", exact: "q" }], bodyMd: text, created: "2026-10-18T10:00:00.000Z", updated: "2026-10-18T10:00:00.000Z" }],
});

/** A database as version 1 left it. */
function oldDatabase(sets: AnnotationSet[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("thundernotes", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("sets", { keyPath: "email.messageId" });
      for (const s of sets) store.put(s);
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
});

describe("store keyed by account and Message-ID (D42)", () => {
  it("migrates every note from the old store, under the account it synced through", async () => {
    await oldDatabase([set("one@x", "account1", "work note"), set("<two@x>", undefined, "made before sync")]);
    const store = await import("../src/store.js");
    expect((await store.getSet("account1", "one@x"))?.annotations[0]!.bodyMd).toBe("work note");
    expect((await store.getSet(undefined, "two@x"))?.annotations[0]!.bodyMd).toBe("made before sync");
    expect(await store.getAllSets()).toHaveLength(2);
  });

  it("keeps the newer of two old entries that now share a key (with and without angle brackets)", async () => {
    const older = { ...set("<dup@x>", "account1", "older"), updated: "2026-10-01T00:00:00.000Z" };
    const newer = { ...set("dup@x", "account1", "newer"), updated: "2026-10-05T00:00:00.000Z" };
    await oldDatabase([newer, older]);
    const store = await import("../src/store.js");
    expect((await store.getSet("account1", "dup@x"))?.annotations[0]!.bodyMd).toBe("newer");
    expect(await store.getAllSets()).toHaveLength(1);
  });

  it("keeps the same email's notes in two accounts apart", async () => {
    const store = await import("../src/store.js");
    await store.putSet(set("m@x", "work", "work note"));
    await store.putSet(set("m@x", "private", "private note"));
    expect((await store.getSet("work", "m@x"))?.annotations[0]!.bodyMd).toBe("work note");
    expect((await store.getSet("private", "m@x"))?.annotations[0]!.bodyMd).toBe("private note");
    await store.deleteSet("work", "m@x");
    expect(await store.getSet("work", "m@x")).toBeNull();
    expect(await store.getSet("private", "m@x")).not.toBeNull();
  });

  it("moves a set to another account, leaving nothing behind", async () => {
    const store = await import("../src/store.js");
    await store.putSet(set("m@x", "work", "note"));
    await store.putSet(set("m@x", "private", "note"), "work");
    expect(await store.getSet("work", "m@x")).toBeNull();
    expect(await store.getSet("private", "m@x")).not.toBeNull();
    expect(await store.getAllSets()).toHaveLength(1);
  });
});
