/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  purgeDeleted,
  restorable,
  deleteEmailNote,
  hasDeletions,
  hasConflict,
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
    expect(md.startsWith("---\nthundernotes: 2\n")).toBe(true);
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
thundernotes: 2
body_boundary: 0
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

<!-- thundernotes:boundary:0 -->
## “first” <!--   tn:a1   -->

Edited in Obsidian.

<!-- thundernotes:boundary:0 -->
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

  // Design review (issue #1): in sync, equal times are two edits, not a hand-edited file.
  it("turns two different texts with equal times and no known base into a conflict box when syncing", () => {
    const theirs = fromMarkdown(toMarkdown(set).replace("Push back.", "Push back hard."));
    const mine: AnnotationSet = { ...set, annotations: [{ ...set.annotations[0]!, bodyMd: set.annotations[0]!.bodyMd.replace("Push back.", "Accept.") }, set.annotations[1]!] };
    const { set: merged } = mergeSets(mine, theirs, "2026-10-20T12:00:00.000Z", "sync");
    expect(hasConflict(merged.annotations[0]!.bodyMd)).toBe(true);
    expect(merged.annotations[0]!.bodyMd).toContain("Push back hard.");
    expect(merged.annotations[0]!.bodyMd).toContain("Accept.");
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

  it("drops a deleted note's copy after 30 days and the record of its deletion after a year", () => {
    const empty = deleteAnnotation(deleteAnnotation(set, a1.id, "2026-10-01T00:00:00.000Z"), a2.id, "2026-10-20T00:00:00.000Z");
    const withoutNote = { ...empty, emailNoteMd: undefined };
    delete withoutNote.emailNoteMd;
    expect(hasContent(withoutNote)).toBe(false);
    expect(hasDeletions(withoutNote)).toBe(true);
    // a1 deleted over 30 days ago: no longer restorable, but still recorded as deleted.
    expect(gcTombstones(withoutNote, "2026-11-05T00:00:00.000Z").tombstones).toEqual([
      { id: a1.id, deleted: "2026-10-01T00:00:00.000Z" },
      { id: a2.id, deleted: "2026-10-20T00:00:00.000Z", annotation: a2 },
    ]);
    expect(gcTombstones(withoutNote, "2027-06-01T00:00:00.000Z").tombstones).toEqual([
      { id: a1.id, deleted: "2026-10-01T00:00:00.000Z" },
      { id: a2.id, deleted: "2026-10-20T00:00:00.000Z" },
    ]);
    const gone = gcTombstones(withoutNote, "2027-11-01T00:00:00.000Z");
    expect(gone.tombstones).toBeUndefined();
    expect(hasDeletions(gone)).toBe(false);
  });

  it("doesn't let a copy that was away longer than 30 days bring a deleted note back", () => {
    const stale = set; // a device that still has a1, offline since before the deletion
    const deleted = gcTombstones(deleteAnnotation(set, a1.id, "2026-10-20T00:00:00.000Z"), "2026-12-01T00:00:00.000Z");
    expect(deleted.tombstones).toEqual([{ id: a1.id, deleted: "2026-10-20T00:00:00.000Z" }]);
    const { set: merged } = mergeSets(stale, fromMarkdown(toMarkdown(deleted)), "2026-12-01T00:00:00.000Z", "sync");
    expect(merged.annotations.map((a) => a.id)).not.toContain(a1.id);
  });

  it("keeps the record of a deleted whole-email note after its copy goes, also through a purge", () => {
    const deleted = deleteEmailNote({ ...set, emailNoteMd: "Call back" }, "2026-10-01T00:00:00.000Z");
    const aged = gcTombstones(deleted, "2026-11-05T00:00:00.000Z");
    expect(aged.deletedEmailNote).toEqual({ deleted: "2026-10-01T00:00:00.000Z" });
    expect(restorable(aged).emailNote).toBeNull();
    expect(fromMarkdown(toMarkdown(aged)).deletedEmailNote).toEqual({ deleted: "2026-10-01T00:00:00.000Z" });
    expect(purgeDeleted(deleted, "2026-10-02T00:00:00.000Z").deletedEmailNote).toEqual({ deleted: "2026-10-01T00:00:00.000Z" });
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

// Issue #4: a literal marked heading in a note (an example of the format) must stay text.
describe("marked headings inside a note", () => {
  const withBody = (bodyMd: string): AnnotationSet => ({
    version: 1,
    email: { messageId: "m@x" },
    rev: 1,
    created: "2026-10-18T10:00:00.000Z",
    updated: "2026-10-18T10:00:00.000Z",
    emailNoteMd: bodyMd,
    annotations: [{ id: "a", selectors: [{ type: "TextQuoteSelector", exact: "q" }], bodyMd, created: "2026-10-18T10:00:00.000Z", updated: "2026-10-18T10:00:00.000Z" }],
  });
  for (const fence of ["```", "~~~", "````"]) {
    it(`keeps everything after an example in a ${fence} block`, () => {
      const body = `Before\n\n${fence}markdown\n## example <!-- tn:example -->\nexample body\n## “q” <!-- tn:a -->\n${fence}\n\nAfter`;
      const back = fromMarkdown(toMarkdown(withBody(body)));
      expect(back.annotations[0]!.bodyMd).toBe(body);
      expect(back.emailNoteMd).toBe(body);
    });
  }
  it("keeps the note whole when a line with text after the backticks (not a closing fence) comes before a marker", () => {
    const body = "Before\n\n```markdown\n``` still code\n## q <!-- tn:a -->\n```\n\nAfter";
    expect(fromMarkdown(toMarkdown(withBody(body))).annotations[0]!.bodyMd).toBe(body);
  });

  it("doesn't let a note with an unclosed code block swallow the notes after it", () => {
    const set = withBody("```\nunclosed code");
    set.annotations.push({ ...set.annotations[0]!, id: "b", bodyMd: "second note" });
    const back = fromMarkdown(toMarkdown(set));
    expect(back.annotations.map((a) => a.bodyMd)).toEqual(["```\nunclosed code", "second note"]);
  });

  it("rejects old development formats rather than guessing section boundaries", () => {
    const old = toMarkdown(withBody("note")).replace("thundernotes: 2", "thundernotes: 1");
    expect(() => fromMarkdown(old)).toThrow(/unsupported format version 1/);
  });

  it("preserves a marker for a different annotation after a quote-prefixed fence inside code", () => {
    const body = "Before\n\n```markdown\n> ```\n## literal <!-- tn:b -->\n```\n\nAfter";
    const set = withBody(body);
    set.annotations.push({ ...set.annotations[0]!, id: "b", bodyMd: "second note" });
    const back = fromMarkdown(toMarkdown(set));
    expect(back.annotations.map((a) => a.bodyMd)).toEqual([body, "second note"]);
    expect(back.emailNoteMd).toBe(body);
  });

  it("preserves the old generated-closure suffix when written literally", () => {
    const body = "Code sample:\n\n```\nhello\n```\n<!-- tn:code-closed -->";
    const back = fromMarkdown(toMarkdown(withBody(body)));
    expect(back.annotations[0]!.bodyMd).toBe(body);
    expect(back.emailNoteMd).toBe(body);
  });


  it("preserves code indentation and Markdown hard-break spaces in both note kinds", () => {
    const body = "    indented code\n\nline with break  \nlast line  ";
    const back = fromMarkdown(toMarkdown(withBody(body)));
    expect(back.annotations[0]!.bodyMd).toBe(body);
    expect(back.emailNoteMd).toBe(body);
  });

  it("chooses a boundary absent from note text, even when it contains format examples", () => {
    const body = "<!-- thundernotes:boundary:0 -->\n<!-- thundernotes:boundary:1 -->\n## literal <!-- tn:a -->";
    const md = toMarkdown(withBody(body));
    expect(md).toContain("body_boundary: 2\n");
    expect(fromMarkdown(md).annotations[0]!.bodyMd).toBe(body);
  });

  it("rejects duplicate and unknown section headers instead of discarding text", () => {
    const md = toMarkdown(withBody("note"));
    expect(() => fromMarkdown(md.replace("<!-- tn:a -->", "<!-- tn:unknown -->"))).toThrow(/unknown/);
    const duplicate = md.replace(/\n<!-- thundernotes:boundary:0 -->\s*$/, "\n<!-- thundernotes:boundary:0 -->\n## duplicate <!-- tn:a -->\ntext\n<!-- thundernotes:boundary:0 -->\n");
    expect(() => fromMarkdown(duplicate)).toThrow(/duplicate annotation section/);
  });

  it("rejects truncated frames and invalid boundary metadata", () => {
    const md = toMarkdown(withBody("note"));
    expect(() => fromMarkdown(md.replace(/\n<!-- thundernotes:boundary:0 -->\s*$/, ""))).toThrow(/final body boundary/);
    for (const value of ["-1", "1.5", "null", "9007199254740992", "'x'"]) {
      expect(() => fromMarkdown(md.replace("body_boundary: 0", `body_boundary: ${value}`))).toThrow(/body_boundary/);
    }
  });

  // An edited export being imported: nothing dropped, nothing failed; each problem said.
  it("on import keeps each section it can't place as a note of its own, and says so", () => {
    const md = toMarkdown(withBody("note"));
    const read = (text: string) => {
      const problems: string[] = [];
      const set = fromMarkdown(text, { onProblem: (p) => problems.push(p) });
      return { set, problems };
    };
    const quote = withBody("note").annotations[0]!.selectors.find((s) => s.type === "TextQuoteSelector")!.exact;

    // A marked heading for a note the file doesn't list: its own note, anchored at the quote it names.
    const unknown = read(md.replace("<!-- tn:a -->", "<!-- tn:unknown -->"));
    expect(unknown.problems).toEqual(["section for an unknown note unknown: kept as a note of its own"]);
    expect(unknown.set.emailNoteMd).toBe("note"); // untouched
    const [a, recovered] = unknown.set.annotations;
    expect(a!.bodyMd).toBe("");
    expect(recovered!.id).toMatch(/^recovered-[0-9a-f]{8}$/);
    expect(recovered!.bodyMd).toBe("note");
    expect(recovered!.selectors).toEqual([{ type: "TextQuoteSelector", exact: quote }]);
    // Imported again: the same note, not a second copy.
    expect(read(md.replace("<!-- tn:a -->", "<!-- tn:unknown -->")).set.annotations[1]!.id).toBe(recovered!.id);

    // A heading without a marker is the user's text: kept in the note, which has no quote to anchor at.
    const unmarked = read(md.replace(/ <!-- tn:a -->/, ""));
    expect(unmarked.problems).toEqual(["section without a note marker: kept as a note of its own"]);
    expect(unmarked.set.annotations[1]!.bodyMd).toMatch(/^## “.*”\n\nnote$/);
    expect(unmarked.set.annotations[1]!.selectors).toEqual([{ type: "TextQuoteSelector", exact: "" }]);

    // A second section for the same note: a note of its own on the same passage.
    const duplicate = read(md.replace(/\n<!-- thundernotes:boundary:0 -->\s*$/, "\n<!-- thundernotes:boundary:0 -->\n## again <!-- tn:a -->\nmore\n<!-- thundernotes:boundary:0 -->\n"));
    expect(duplicate.problems).toEqual(["duplicate annotation section a: kept as a note of its own on the same passage"]);
    expect(duplicate.set.annotations.map((x) => x.bodyMd)).toEqual(["note", "more"]);
    expect(duplicate.set.annotations[1]!.selectors).toEqual(duplicate.set.annotations[0]!.selectors);

    const truncated = read(md.replace(/\n<!-- thundernotes:boundary:0 -->\s*$/, ""));
    expect(truncated.problems).toEqual(["missing final body boundary"]);
    expect(truncated.set.annotations[0]!.bodyMd).toBe("note");
    // What can't be read at all still fails.
    expect(() => read(md.replace("body_boundary: 0", "body_boundary: -1"))).toThrow(/body_boundary/);
  });

  // PR #7 review: every unplaceable frame needs an independent note, including the first.
  it.each(["", "## Edited subject\n"])("recovers a malformed first frame with heading %j as an unanchored note", (heading) => {
    const md = toMarkdown(withBody("keep this text")).replace(/^# .*\n/m, heading);
    expect(() => fromMarkdown(md)).toThrow(/body title missing/);
    const problems: string[] = [];
    const incoming = fromMarkdown(md, { onProblem: (p) => problems.push(p) });
    expect(problems).toEqual(["body title missing"]);
    expect(incoming.emailNoteMd).toBeUndefined();
    const recovered = incoming.annotations.find((a) => a.id.startsWith("recovered-"))!;
    expect(recovered.bodyMd).toBe([heading.trimEnd(), "keep this text"].filter(Boolean).join("\n\n"));
    expect(recovered.selectors).toEqual([{ type: "TextQuoteSelector", exact: "" }]);
    expect(fromMarkdown(md, { onProblem: () => {} }).annotations.find((a) => a.id === recovered.id)).toEqual(recovered);
    expect(fromMarkdown(toMarkdown(incoming)).annotations.find((a) => a.id === recovered.id)).toEqual(recovered);
  });

  it("does not invent a recovery note for an empty malformed first frame", () => {
    const file = withBody("annotation text");
    delete file.emailNoteMd;
    const md = toMarkdown(file).replace(/^# .*\n/m, "");
    const problems: string[] = [];
    const incoming = fromMarkdown(md, { onProblem: (p) => problems.push(p) });
    expect(problems).toEqual(["body title missing"]);
    expect(incoming.annotations).toEqual(file.annotations);
    expect(incoming.emailNoteMd).toBeUndefined();
  });

  // Added to another note, repaired text could lose the import merge to a newer local note.
  it("keeps a repaired section through the import merge, whatever is newer locally", () => {
    const file = withBody("note");
    const md = toMarkdown(file).replace("<!-- tn:a -->", "<!-- tn:unknown -->");
    const incoming = fromMarkdown(md, { onProblem: () => {} });
    const later = "2099-01-01T00:00:00.000Z";
    const local = { ...file, updated: later, emailNoteMd: "edited here", emailNoteUpdated: later, annotations: file.annotations.map((x) => ({ ...x, bodyMd: "edited here", updated: later })) };
    const merged = mergeSets(local, incoming, undefined, "import").set;
    expect(merged.emailNoteMd).toBe("edited here");
    expect(merged.annotations.map((x) => x.bodyMd)).toEqual(["edited here", "note"]);
  });

  it("round-trips combinations of literal markers, quotes, lists and unfinished code", () => {
    const fragments = ["plain", "```", "~~~", "> ```", "    code", "## literal <!-- tn:b -->", "<!-- tn:code-closed -->", "<!-- thundernotes:boundary:0 -->", "- [ ] task", "Grüße 👋"];
    for (const left of fragments) for (const right of fragments) {
      const body = `${left}\n\n${right}`;
      const set = withBody(body);
      set.annotations.push({ ...set.annotations[0]!, id: "b", bodyMd: right });
      const back = fromMarkdown(toMarkdown(set));
      expect(back.annotations.map((a) => a.bodyMd)).toEqual([body, right]);
      expect(back.emailNoteMd).toBe(body);
    }
  });

  it("keeps a marked heading for a note the file doesn't have as text", () => {
    const body = "Before\n## stray <!-- tn:nobody -->\nAfter";
    expect(fromMarkdown(toMarkdown(withBody(body))).annotations[0]!.bodyMd).toBe(body);
  });

  // docs/SYNC.md: two devices choosing a colour at the same moment agree on one, whichever merges whose.
  it("decides equal-time colour changes the same way on both devices in sync", () => {
    const at = "2026-10-18T10:00:00.000Z";
    const set = (colour: string): AnnotationSet => ({
      version: 1, email: { messageId: "m@x" }, rev: 2, created: at, updated: at, emailNoteMd: "n", emailNoteColour: colour, emailNoteColourUpdated: at,
      annotations: [{ id: "a", selectors: [{ type: "TextQuoteSelector", exact: "q" }], bodyMd: "x", created: at, updated: at, colour, colourUpdated: at }],
    });
    const onA = mergeSets(set("red"), set("blue"), undefined, "sync").set;
    const onB = mergeSets(set("blue"), set("red"), undefined, "sync").set;
    expect(onA.annotations[0]!.colour).toBe(onB.annotations[0]!.colour);
    expect(onA.emailNoteColour).toBe(onB.emailNoteColour);
  });
});
