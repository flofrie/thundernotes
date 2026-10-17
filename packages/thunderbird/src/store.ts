/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Local annotation store: one AnnotationSet per email (D4), keyed by Message-ID (D2),
// in the add-on's IndexedDB.

import type { AnnotationSet } from "@thundernotes/core";

const DB_NAME = "thundernotes";
const DB_VERSION = 1;
const SETS = "sets";

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SETS, { keyPath: "email.messageId" });
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

export async function getSet(messageId: string): Promise<AnnotationSet | null> {
  return (await run<AnnotationSet | undefined>("readonly", (s) => s.get(messageId))) ?? null;
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

export async function putSet(set: AnnotationSet): Promise<void> {
  await run("readwrite", (s) => s.put(set));
  changed();
}

export async function deleteSet(messageId: string): Promise<void> {
  await run("readwrite", (s) => s.delete(messageId));
  changed();
}

export async function getAllSets(): Promise<AnnotationSet[]> {
  return run<AnnotationSet[]>("readonly", (s) => s.getAll());
}
