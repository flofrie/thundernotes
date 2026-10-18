/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// An email moved to another account takes its notes along (D42). Pure: the background applies it.

import { deleteAnnotation, deleteEmailNote, mergeSets, purgeDeleted, type AnnotationSet } from "@thundernotes/core";

/**
 * The notes of an email moved from one account to another: `moved`, stored in the new account
 * (merged with what is there already) and synced there; `left`, what stays in the old account:
 * every note deleted, without copies of the text (they went along, and the old account's server
 * shouldn't keep them), so the old account's other devices remove them too. With a copy of the
 * email still in the old account (`keepOld`), the notes stay there as well (`left` is null).
 */
export function moveNotes(
  set: AnnotationSet,
  toAccountId: string,
  existing: AnnotationSet | null,
  keepOld: boolean,
  now = new Date().toISOString(),
): { moved: AnnotationSet; left: AnnotationSet | null } {
  // Carried notes count as changed now: they win over deletion records the new account may have
  // of them (an email moved back: the records its earlier move left there would delete them).
  const carried: AnnotationSet = {
    ...set,
    email: { ...set.email, accountId: toAccountId },
    rev: set.rev + 1,
    updated: now,
    annotations: set.annotations.map((a) => ({ ...a, updated: now })),
    ...(set.emailNoteMd ? { emailNoteUpdated: now } : {}),
  };
  delete carried.email.account; // an address from an import names the old account: never sent to the new one
  delete carried.syncHistory; // the new account's merges start fresh
  const moved = existing ? mergeSets(existing, carried, now, "import").set : carried;
  if (keepOld) return { moved, left: null };
  let left = set;
  for (const a of set.annotations) left = deleteAnnotation(left, a.id, now);
  if (left.emailNoteMd) left = deleteEmailNote(left, now);
  left = purgeDeleted(left, now);
  return { moved, left };
}
