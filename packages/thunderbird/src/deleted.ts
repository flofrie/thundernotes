/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Deleted emails are left alone (D43): an email whose copies in its account are all in the Trash,
// or that was deleted for good, has its notes kept (back from the Trash, they're back) but
// ignored: no tasks in the task view or the overdue count, no suggestions or backlinks from it.
// Kept as a list in storage (the background writes it, the task view reads it).

import type { AnnotationSet } from "@thundernotes/core";

export const IGNORED_KEY = "deletedEmails";

/**
 * "<account id>|<Message-ID>" → its state: in the Trash or deleted for good (ignored), or not found
 * ("missing": removed by other means, e.g. on the server; shown with "email not found", D44).
 */
export type Ignored = Record<string, "trash" | "deleted" | "missing">;

export const ignoredKey = (accountId: string | undefined, messageId: string) => `${accountId ?? ""}|${messageId.trim().replace(/^<|>$/g, "")}`;

/** Whether a set's email is deleted (its notes then ignored). */
export const isIgnored = (ignored: Ignored, set: AnnotationSet) => {
  const state = ignored[ignoredKey(set.email.accountId, set.email.messageId)];
  return state === "trash" || state === "deleted";
};

/** Whether a set's email can't be found (its notes shown, marked, deletable, D44). */
export const isMissing = (ignored: Ignored, set: AnnotationSet) => ignored[ignoredKey(set.email.accountId, set.email.messageId)] === "missing";

/**
 * An email's state now, from its copies in the account (carrier folders aside): all in the Trash
 * ("trash"); none left after a deletion for good ("deleted"); none found otherwise ("missing": never
 * hidden for that, a failed lookup must not hide notes, only marked).
 */
export function deletedState(copies: { folder?: { specialUse?: string[] } }[], afterDeletion = false): "trash" | "deleted" | "missing" | null {
  if (!copies.length) return afterDeletion ? "deleted" : "missing";
  return copies.every((c) => c.folder?.specialUse?.includes("trash")) ? "trash" : null;
}
