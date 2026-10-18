/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Restoring deleted notes (D33). Its own module without the YAML parser, so the message
// display script, which asks what can be restored, stays small (D22).

import type { Annotation, AnnotationSet } from "./index.js";

/** What can be restored on an email: deleted annotations with a copy, and the emptied whole-email note. */
export function restorable(set: AnnotationSet | null | undefined): { annotations: Annotation[]; emailNote: string | null } {
  if (!set) return { annotations: [], emailNote: null };
  const live = new Set(set.annotations.map((a) => a.id));
  // A tombstone of a restored annotation can come back with a merge; it no longer counts.
  // Copies purged (deleted up to purgedBefore) don't count, should one still be there.
  const kept = (deleted: string) => !set.purgedBefore || deleted > set.purgedBefore;
  const annotations = (set.tombstones ?? []).filter((t) => t.annotation && !live.has(t.id) && kept(t.deleted)).map((t) => t.annotation!);
  const den = set.deletedEmailNote;
  const emailNote = den?.md !== undefined && kept(den.deleted) && !set.emailNoteMd?.trim() ? den.md : null;
  return { annotations, emailNote };
}

/**
 * Deletes the copies of everything deleted on this email for good (they can't be restored
 * then), on all devices: what was deleted up to now stays purged whichever copy a merge
 * brings. The tombstones stay, so the deletions still reach the other devices.
 */
export function purgeDeleted(set: AnnotationSet, now = new Date().toISOString()): AnnotationSet {
  const next: AnnotationSet = { ...set, rev: set.rev + 1, updated: now, purgedBefore: now };
  if (set.tombstones?.length) next.tombstones = set.tombstones.map((t) => ({ id: t.id, deleted: t.deleted }));
  if (set.deletedEmailNote) next.deletedEmailNote = { deleted: set.deletedEmailNote.deleted }; // the record stays
  return next;
}

/**
 * Brings back everything deleted on this email in the last 30 days (not older versions of
 * notes that still exist). Restored annotations count as changed now, so other devices take
 * them back too despite their tombstones.
 */
export function restoreDeleted(set: AnnotationSet, now = new Date().toISOString()): AnnotationSet {
  const { annotations, emailNote } = restorable(set);
  if (!annotations.length && emailNote === null) return set;
  const ids = new Set(annotations.map((a) => a.id));
  const next: AnnotationSet = {
    ...set,
    annotations: [...set.annotations, ...annotations.map((a) => ({ ...a, updated: now }))],
    rev: set.rev + 1,
    updated: now,
  };
  const tombstones = (set.tombstones ?? []).filter((t) => !ids.has(t.id));
  if (tombstones.length) next.tombstones = tombstones;
  else delete next.tombstones;
  if (emailNote !== null) {
    next.emailNoteMd = emailNote;
    next.emailNoteUpdated = now;
    delete next.deletedEmailNote;
  }
  return next;
}

/** Empties the whole-email note, keeping a copy for restoring (D33). */
export function deleteEmailNote(set: AnnotationSet, now = new Date().toISOString()): AnnotationSet {
  const next: AnnotationSet = { ...set, rev: set.rev + 1, updated: now, emailNoteUpdated: now };
  if (set.emailNoteMd?.trim()) next.deletedEmailNote = { md: set.emailNoteMd, deleted: now };
  delete next.emailNoteMd;
  return next;
}
