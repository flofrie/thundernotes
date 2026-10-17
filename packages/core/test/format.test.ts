/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  FormatError,
  deleteAnnotation,
  fileName,
  fromMarkdown,
  gcTombstones,
  hash8,
  hasContent,
  mergeSets,
  slug,
  toMarkdown,
  type AnnotationSet,
} from "../src/index.js";

const set: AnnotationSet = {
  version: 1,
  email: {
    messageId: "<CAF3xQ9b1k@mail.example.com>",
    subject: "Contract renewal – draft v3",
    from: "Anna Weber <anna@example.com>",
    date: "2026-10-12T07:14:00.000Z",
    folderHint: "/INBOX/Clients",
  },
  rev: 4,
  created: "2026-10-13T08:02:11.000Z",
  updated: "2026-10-13T08:20:45.000Z",
  emailNoteMd: "General note on the whole email.",
  annotations: [
    {
      id: "7f3c9a10-0000-4000-8000-000000000001",
      selectors: [
        { type: "TextQuoteSelector", exact: "termination period of 6 months", prefix: "agreed that the contract has a ", suffix: " from the end of each calendar" },
        { type: "TextPositionSelector", start: 1043, end: 1073 },
      ],
      bodyMd: "We agreed **3 months** in the call. Push back.\n\n## Background\n\n- [ ] Reply to Anna",
      created: "2026-10-13T08:02:11.000Z",
      updated: "2026-10-13T08:20:45.000Z",
    },
    {
      id: "7f3c9a10-0000-4000-8000-000000000002",
      selectors: [{ type: "TextQuoteSelector", exact: "plain\nhighlight: with --> odd chars" }],
      bodyMd: "",
      created: "2026-10-13T08:05:00.000Z",
      updated: "2026-10-13T08:05:00.000Z",
    },
  ],
};

describe("toMarkdown / fromMarkdown", () => {
  it("round-trips a set without loss", () => {
    expect(fromMarkdown(toMarkdown(set))).toEqual(set);
  });

  it("writes a readable file: title, email note, one section per note", () => {
    const md = toMarkdown(set);
    expect(md.startsWith("---\nthundernotes: 1\n")).toBe(true);
    expect(md).toContain("# Contract renewal – draft v3\n\nGeneral note on the whole email.");
    expect(md).toContain("## “termination period of 6 months” <!-- tn:7f3c9a10-0000-4000-8000-000000000001 -->");
    // Plain highlights have no section, only front matter.
    expect(md.match(/<!-- tn:/g)).toHaveLength(1);
  });

  it("keeps headings inside a note as part of that note", () => {
    expect(fromMarkdown(toMarkdown(set)).annotations[0]!.bodyMd).toContain("## Background");
  });

  it("reads hand-edited files: other YAML style, edited note, deleted section", () => {
    const edited = `---
thundernotes: 1
message_id: '<CAF3xQ9b1k@mail.example.com>'
subject: Contract renewal
created: 2026-10-13T08:02:11.000Z
updated: 2026-10-13T08:20:45.000Z
rev: 4
annotations:
  - {id: a1, quote: first, position: [1, 6], created: 2026-10-13T08:02:11.000Z, updated: 2026-10-13T08:02:11.000Z}
  - id: a2
    quote: second
    created: 2026-10-13T08:02:11.000Z
    updated: 2026-10-13T08:02:11.000Z
---

# Contract renewal

## “first” <!--   tn:a1   -->

Edited in Obsidian.
`;
    const parsed = fromMarkdown(edited);
    expect(parsed.annotations.map((a) => a.bodyMd)).toEqual(["Edited in Obsidian.", ""]);
    expect(parsed.annotations[0]!.selectors[1]).toEqual({ type: "TextPositionSelector", start: 1, end: 6 });
    expect(parsed.emailNoteMd).toBeUndefined();
  });

  it("accepts CRLF line endings and a BOM", () => {
    const md = "﻿" + toMarkdown(set).replace(/\n/g, "\r\n");
    expect(fromMarkdown(md)).toEqual(set);
  });

  it("rejects files that aren't ours", () => {
    expect(() => fromMarkdown("# Just a note")).toThrow(FormatError);
    expect(() => fromMarkdown("---\ntitle: x\n---\nbody")).toThrow(FormatError);
    expect(() => fromMarkdown("---\nthundernotes: 99\nmessage_id: x\n---\n")).toThrow(/newer/);
  });
});

describe("file names", () => {
  it("follow YYYY/MM/YYYY-MM-DD_slug_hash8.md", () => {
    expect(fileName(set)).toBe(`2026/10/2026-10-12_contract-renewal-draft-v3_${hash8(set.email.messageId)}.md`);
  });

  it("slugs umlauts, prefixes and empty subjects", () => {
    expect(slug("AW: Grüße aus München – Straße")).toBe("gruesse-aus-muenchen-strasse");
    expect(slug("")).toBe("no-subject");
    expect(slug("Café déjà vu")).toBe("cafe-deja-vu");
  });

  it("hashes stably to 8 hex characters", () => {
    expect(hash8("<a@b>")).toMatch(/^[0-9a-f]{8}$/);
    expect(hash8("<a@b>")).toBe(hash8("<a@b>"));
    expect(hash8("<a@b>")).not.toBe(hash8("<a@c>"));
  });
});

describe("mergeSets", () => {
  const a1 = set.annotations[0]!;
  const a2 = set.annotations[1]!;

  it("adds new annotations and takes newer versions", () => {
    const local: AnnotationSet = { ...set, annotations: [a1] };
    const newer = { ...a1, bodyMd: "newer text", updated: "2026-10-14T00:00:00.000Z" };
    const incoming: AnnotationSet = { ...set, updated: "2026-10-14T00:00:00.000Z", annotations: [newer, a2] };
    const { set: merged, added, updated } = mergeSets(local, incoming);
    expect(merged.annotations.map((a) => a.bodyMd)).toEqual(["newer text", ""]);
    expect([added, updated]).toEqual([1, 1]);
    expect(merged.rev).toBe(5);
  });

  it("keeps the local version when it is newer or equal", () => {
    const older = { ...a1, bodyMd: "old text", updated: "2026-10-01T00:00:00.000Z" };
    const { set: merged, added, updated } = mergeSets(set, { ...set, annotations: [older] });
    expect(merged.annotations[0]!.bodyMd).toBe(a1.bodyMd);
    expect([added, updated]).toEqual([0, 0]);
    expect(merged.rev).toBe(set.rev);
  });

  // Reported: editing a note in an exported file and re-importing changed nothing,
  // because editors don't touch the `updated` timestamps.
  it("takes hand edits from a re-imported file (same timestamps, different text)", () => {
    const edited = toMarkdown(set)
      .replace("Push back.", "Push back hard.")
      .replace("General note on the whole email.", "Edited email note.");
    const now = "2026-10-20T12:00:00.000Z";
    const { set: merged, updated } = mergeSets(set, fromMarkdown(edited), now);
    expect(merged.annotations[0]!.bodyMd).toContain("Push back hard.");
    expect(merged.annotations[0]!.updated).toBe(now);
    expect(merged.emailNoteMd).toBe("Edited email note.");
    expect(updated).toBe(2);
    expect(merged.updated).toBe(now);
  });

  it("keeps notes changed in the add-on after the export over an older file", () => {
    const local: AnnotationSet = {
      ...set,
      updated: "2026-10-15T00:00:00.000Z",
      annotations: [{ ...set.annotations[0]!, bodyMd: "changed later", updated: "2026-10-15T00:00:00.000Z" }, set.annotations[1]!],
    };
    const { set: merged, updated } = mergeSets(local, fromMarkdown(toMarkdown(set)));
    expect(merged.annotations[0]!.bodyMd).toBe("changed later");
    expect(updated).toBe(0);
  });

  it("reports nothing for an unchanged re-import", () => {
    expect(mergeSets(set, fromMarkdown(toMarkdown(set)))).toMatchObject({ added: 0, updated: 0 });
  });
});

describe("sync: tombstones and the whole-email note", () => {
  const a1 = set.annotations[0]!;
  const a2 = set.annotations[1]!;

  it("round-trips tombstones and the email note timestamp", () => {
    const withMeta: AnnotationSet = {
      ...set,
      emailNoteUpdated: "2026-10-13T08:20:00.000Z",
      tombstones: [{ id: "gone-1", deleted: "2026-10-14T00:00:00.000Z" }],
    };
    expect(fromMarkdown(toMarkdown(withMeta))).toEqual(withMeta);
  });

  it("carries a deletion to the other device", () => {
    const deviceA = deleteAnnotation(set, a2.id, "2026-10-16T00:00:00.000Z");
    const { set: onB, updated } = mergeSets(set, deviceA, "2026-10-16T00:01:00.000Z");
    expect(onB.annotations.map((a) => a.id)).toEqual([a1.id]);
    expect(onB.tombstones).toEqual([{ id: a2.id, deleted: "2026-10-16T00:00:00.000Z", annotation: a2 }]);
    expect(updated).toBe(1);
  });

  it("does not resurrect a deleted annotation from an older copy", () => {
    const local = deleteAnnotation(set, a2.id, "2026-10-16T00:00:00.000Z");
    const { set: merged } = mergeSets(local, set);
    expect(merged.annotations.map((a) => a.id)).toEqual([a1.id]);
  });

  it("keeps an annotation edited after it was deleted elsewhere", () => {
    const deleted = deleteAnnotation(set, a1.id, "2026-10-16T00:00:00.000Z");
    const editedLater: AnnotationSet = {
      ...set,
      annotations: [{ ...a1, bodyMd: "edited later", updated: "2026-10-17T00:00:00.000Z" }, a2],
    };
    const { set: merged } = mergeSets(deleted, editedLater);
    expect(merged.annotations.find((a) => a.id === a1.id)?.bodyMd).toBe("edited later");
  });

  it("keeps a newer email note when the other device changed something else later", () => {
    const deviceA: AnnotationSet = {
      ...set,
      emailNoteMd: "A's new email note",
      emailNoteUpdated: "2026-10-16T00:00:00.000Z",
      updated: "2026-10-16T00:00:00.000Z",
    };
    const deviceB: AnnotationSet = {
      ...set,
      updated: "2026-10-17T00:00:00.000Z",
      annotations: [...set.annotations, { ...a2, id: "new-on-b", created: "2026-10-17T00:00:00.000Z", updated: "2026-10-17T00:00:00.000Z" }],
    };
    const { set: merged } = mergeSets(deviceA, deviceB);
    expect(merged.emailNoteMd).toBe("A's new email note");
    expect(merged.annotations.map((a) => a.id)).toContain("new-on-b");
    expect(mergeSets(deviceB, deviceA).set.emailNoteMd).toBe("A's new email note");
  });

  it("drops tombstones after 30 days; a set with only tombstones has no content", () => {
    const empty = deleteAnnotation(deleteAnnotation(set, a1.id, "2026-10-01T00:00:00.000Z"), a2.id, "2026-10-20T00:00:00.000Z");
    const withoutNote = { ...empty, emailNoteMd: undefined };
    delete withoutNote.emailNoteMd;
    expect(hasContent(withoutNote)).toBe(false);
    expect(gcTombstones(withoutNote, "2026-11-05T00:00:00.000Z").tombstones).toEqual([{ id: a2.id, deleted: "2026-10-20T00:00:00.000Z", annotation: a2 }]);
    expect(gcTombstones(withoutNote, "2026-12-01T00:00:00.000Z").tombstones).toBeUndefined();
  });
});


describe("card folding (D30)", () => {
  const base = fromMarkdown(toMarkdown({
    version: 1,
    email: { messageId: "m@x" },
    rev: 1,
    created: "2026-10-16T10:00:00.000Z",
    updated: "2026-10-16T10:00:00.000Z",
    annotations: [
      { id: "a1", selectors: [{ type: "TextQuoteSelector", exact: "q" }], bodyMd: "note", created: "2026-10-16T10:00:00.000Z", updated: "2026-10-16T10:00:00.000Z" },
    ],
  }));

  it("round-trips through the file", () => {
    const set = { ...base, folded: { a1: { folded: true, at: "2026-10-16T11:00:00.000Z" } } };
    expect(fromMarkdown(toMarkdown(set)).folded).toEqual(set.folded);
  });

  it("merges by its own time and never overrides a note edit", () => {
    const folded = { ...base, rev: 2, folded: { a1: { folded: true, at: "2026-10-16T12:00:00.000Z" } } };
    const edited = {
      ...base,
      rev: 2,
      annotations: [{ ...base.annotations[0]!, bodyMd: "edited", updated: "2026-10-16T11:00:00.000Z" }],
      folded: { a1: { folded: false, at: "2026-10-16T09:00:00.000Z" } },
    };
    for (const [a, b] of [[folded, edited], [edited, folded]] as const) {
      const { set } = mergeSets(a, b, "2026-10-16T13:00:00.000Z");
      expect(set.annotations[0]!.bodyMd).toBe("edited");
      expect(set.folded).toEqual({ a1: { folded: true, at: "2026-10-16T12:00:00.000Z" } });
    }
  });

  it("goes with a deleted annotation", () => {
    const set = { ...base, folded: { a1: { folded: true, at: "2026-10-16T11:00:00.000Z" } } };
    expect(deleteAnnotation(set, "a1").folded).toBeUndefined();
  });
});

describe("whole-email note colour", () => {
  const set = {
    version: 1 as const,
    email: { messageId: "m@x" },
    rev: 1,
    created: "2026-10-16T10:00:00.000Z",
    updated: "2026-10-16T10:00:00.000Z",
    annotations: [],
    emailNoteMd: "note",
    emailNoteUpdated: "2026-10-16T10:00:00.000Z",
  };

  it("round-trips and merges with the note", () => {
    const blue = { ...set, emailNoteColour: "blue", emailNoteUpdated: "2026-10-16T11:00:00.000Z" };
    expect(fromMarkdown(toMarkdown(blue)).emailNoteColour).toBe("blue");
    expect(mergeSets(set, blue).set.emailNoteColour).toBe("blue");
    expect(mergeSets(blue, set).set.emailNoteColour).toBe("blue");
  });
});
