/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Local annotation store: one AnnotationSet per email (D4) in one account (D42), keyed by the
// account and the Message-ID (D2), in the add-on's IndexedDB. A set's account is
// `set.email.accountId` (local only: Thunderbird's own account id, never synced); sets that
// don't know their account yet are kept under "" until they get one (sync.ts assignAccounts).

import type { AnnotationSet } from "@thundernotes/core";

const DB_NAME = "thundernotes";
/** 1: keyed by Message-ID only; 2: by account and Message-ID (D42). */
const DB_VERSION = 2;
const OLD_SETS = "sets";
const SETS = "setsByAccount";

/** A set's key: its account and Message-ID. */
export function setKey(accountId: string | undefined, messageId: string): string {
  return `${accountId ?? ""}\u001f${messageId.trim().replace(/^<|>$/g, "")}`;
}
const keyOf = (set: AnnotationSet) => setKey(set.email.accountId, set.email.messageId);

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const sets = database.createObjectStore(SETS);
      if (event.oldVersion < 1 || !database.objectStoreNames.contains(OLD_SETS)) return;
      // From version 1: every set keeps the account it synced through (D42).
      const old = request.transaction!.objectStore(OLD_SETS);
      old.openCursor().onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor) return void database.deleteObjectStore(OLD_SETS);
        const set = cursor.value as AnnotationSet;
        // "<x>" and "x" (an import with angle brackets) now share a key: the later one is kept.
        const key = keyOf(set);
        sets.get(key).onsuccess = (got) => {
          const there = (got.target as IDBRequest<AnnotationSet | undefined>).result;
          if (!there || there.updated < set.updated) sets.put(set, key);
          cursor.continue();
        };
      };
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const request = op(database.transaction(SETS, mode).objectStore(SETS));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

/** The notes on an email in one account (null: none). */
export async function getSet(accountId: string | undefined, messageId: string): Promise<AnnotationSet | null> {
  return (await run<AnnotationSet | undefined>("readonly", (s) => s.get(setKey(accountId, messageId)))) ?? null;
}

let onChange: (() => void) | null = null;

/** Called after every write in this page (the background: the Tasks button's count, D38). */
export function onSetsChanged(listener: () => void): void {
  onChange = listener;
}

/** Tells the add-on's other pages (the task view, D38) that notes changed. */
function changed(): void {
  onChange?.();
  if (typeof messenger === "undefined") return; // tests
  messenger.runtime.sendMessage({ type: "setsChanged" }).catch(() => {}); // no page open
}

/**
 * Stores a set under its account. `from`: the account it was stored under before, when that
 * changed (it got its account, or its email moved to another one, D42): removed there.
 */
export async function putSet(set: AnnotationSet, from?: string): Promise<void> {
  await run("readwrite", (s) => s.put(set, keyOf(set)));
  if (from !== undefined && from !== (set.email.accountId ?? "")) await run("readwrite", (s) => s.delete(setKey(from, set.email.messageId)));
  changed();
}

export async function deleteSet(accountId: string | undefined, messageId: string): Promise<void> {
  await run("readwrite", (s) => s.delete(setKey(accountId, messageId)));
  changed();
}

/** Every set, all accounts. */
export async function getAllSets(): Promise<AnnotationSet[]> {
  return run<AnnotationSet[]>("readonly", (s) => s.getAll());
}
