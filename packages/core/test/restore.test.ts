/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  deleteAnnotation,
  deleteEmailNote,
  fromMarkdown,
  gcTombstones,
  mergeSets,
  purgeDeleted,
  restorable,
  restoreDeleted,
  toMarkdown,
  type Annotation,
  type AnnotationSet,
} from "../src/index.js";

const note: Annotation = {
  id: "a1",
  selectors: [{ type: "TextQuoteSelector", exact: "the offer", prefix: "see ", suffix: " below" }],
  bodyMd: "Ask about **pricing**",
  colour: "blue",
  created: "2026-10-17T08:00:00.000Z",
  updated: "2026-10-17T08:00:00.000Z",
};
const set: AnnotationSet = {
  version: 1,
  email: { messageId: "m@x" },
  rev: 1,
  created: "2026-10-17T08:00:00.000Z",
  updated: "2026-10-17T08:00:00.000Z",
  annotations: [note],
  emailNoteMd: "Whole email",
  emailNoteUpdated: "2026-10-17T08:00:00.000Z",
};

describe("restoring deleted notes (D33)", () => {
  const deleted = deleteEmailNote(deleteAnnotation(set, "a1", "2026-10-17T09:00:00.000Z"), "2026-10-17T09:00:00.000Z");

  it("keeps a copy of what was deleted, also through the file", () => {
    expect(restorable(deleted)).toEqual({ annotations: [note], emailNote: "Whole email" });
    expect(restorable(fromMarkdown(toMarkdown(deleted)))).toEqual({ annotations: [note], emailNote: "Whole email" });
  });

  it("restores everything deleted on the email; other devices take it back", () => {
    const restored = restoreDeleted(deleted, "2026-10-17T10:00:00.000Z");
    expect(restored.annotations.map((a) => a.bodyMd)).toEqual(["Ask about **pricing**"]);
    expect(restored.emailNoteMd).toBe("Whole email");
    expect(restorable(restored)).toEqual({ annotations: [], emailNote: null });
    // The other device still has the tombstone; the restore wins and stays restored.
    const other = mergeSets(deleted, restored, "2026-10-17T10:01:00.000Z", "sync").set;
    expect(other.annotations.map((a) => a.id)).toEqual(["a1"]);
    expect(other.emailNoteMd).toBe("Whole email");
    expect(restorable(other).annotations).toEqual([]);
  });

  it("forgets copies after 30 days", () => {
    const later = gcTombstones(deleted, "2026-11-20T00:00:00.000Z");
    expect(restorable(later)).toEqual({ annotations: [], emailNote: null });
  });
});

describe("purging deleted notes (D33)", () => {
  const deleted = deleteEmailNote(deleteAnnotation(set, "a1", "2026-10-17T09:00:00.000Z"), "2026-10-17T09:00:00.000Z");
  const purged = purgeDeleted(deleted, "2026-10-17T10:00:00.000Z");

  it("leaves nothing to restore, but keeps the tombstones (the deletion still syncs)", () => {
    expect(restorable(purged)).toEqual({ annotations: [], emailNote: null });
    expect(purged.tombstones).toEqual([{ id: "a1", deleted: "2026-10-17T09:00:00.000Z" }]);
    expect(purged.rev).toBe(deleted.rev + 1);
    expect(fromMarkdown(toMarkdown(purged)).purgedBefore).toBe("2026-10-17T10:00:00.000Z");
  });

  it("stays purged when another device still has the copies", () => {
    const merged = mergeSets(purged, deleted, "2026-10-17T11:00:00.000Z", "sync").set;
    expect(restorable(merged)).toEqual({ annotations: [], emailNote: null });
    const other = mergeSets(deleted, purged, "2026-10-17T11:00:00.000Z", "sync");
    expect(restorable(other.set)).toEqual({ annotations: [], emailNote: null });
    expect(other.set.rev).toBeGreaterThan(deleted.rev); // a change for the other device, so it uploads it
  });

  it("only what was deleted before: later deletions can be restored", () => {
    const later = deleteAnnotation({ ...purged, annotations: [{ ...note, id: "a2" }] }, "a2", "2026-10-17T12:00:00.000Z");
    expect(restorable(later).annotations.map((a) => a.id)).toEqual(["a2"]);
  });
});
