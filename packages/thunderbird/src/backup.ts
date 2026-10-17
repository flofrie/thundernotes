/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Notes on emails in IMAP accounts are synced to the server (D27). Notes on emails in local
// folders or POP accounts exist only in the add-on's database, which Thunderbird deletes when
// the add-on is removed. For those: remember the last export and remind when they changed
// since and that export is getting old.

import { hasContent, type AnnotationSet } from "@thundernotes/core";
import { getAllSets } from "./store.js";

const KEY = "lastExport";
const REMIND_AFTER_DAYS = 7;

export async function recordExport(): Promise<void> {
  await messenger.storage.local.set({ [KEY]: new Date().toISOString() });
}

export async function lastExport(): Promise<string | null> {
  const { [KEY]: at } = await messenger.storage.local.get(KEY);
  return typeof at === "string" ? at : null;
}

/** Notes the server doesn't keep: no account known yet, or not an IMAP account. */
async function localOnly(sets: AnnotationSet[]): Promise<AnnotationSet[]> {
  const types = new Map<string, string>();
  for (const account of await messenger.accounts.list(false)) types.set(account.id, account.type);
  return sets.filter((s) => hasContent(s) && types.get(s.email.accountId ?? "") !== "imap");
}

/** True when local-only notes changed since the last export and that export is old (or missing). */
export async function exportDue(): Promise<{ due: boolean; lastExport: string | null }> {
  const at = await lastExport();
  if (at && Date.now() - Date.parse(at) < REMIND_AFTER_DAYS * 86_400_000) return { due: false, lastExport: at };
  const sets = await localOnly(await getAllSets());
  const changed = sets.some((s) => !at || s.updated > at);
  return { due: changed, lastExport: at };
}

export function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "never";
}
