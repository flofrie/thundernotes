/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  hasConflict,
  hash8,
  mergeSets,
  mergeText,
  parseConflicts,
  rememberSynced,
  resolveConflict,
  withBases,
  type AnnotationSet,
} from "../src/index.js";

const base = "Agreed with Anna:\n- [ ] call back on Monday\n- [ ] send the offer\nThanks";

describe("mergeText (D32)", () => {
  it("combines edits of different lines", () => {
    const mine = { text: base.replace("send the offer", "send the offer today"), at: "2026-10-17T09:12:00Z", by: "MacBook" };
    const theirs = { text: base.replace("Thanks", "Thanks, F."), at: "2026-10-17T09:14:00Z", by: "Work laptop" };
    expect(mergeText(base, mine, theirs)).toEqual({
      text: "Agreed with Anna:\n- [ ] call back on Monday\n- [ ] send the offer today\nThanks, F.",
      conflict: false,
    });
  });

  it("ticks of neighbouring tasks on two devices don't clash", () => {
    const mine = { text: base.replace("[ ] call", "[x] call"), at: "2026-10-17T09:12:00Z" };
    const theirs = { text: base.replace("[ ] send", "[x] send"), at: "2026-10-17T09:14:00Z" };
    expect(mergeText(base, mine, theirs)).toEqual({ text: base.replace(/\[ \]/g, "[x]"), conflict: false });
  });

  it("puts lines changed on both sides in a conflict box, newer first, the same on both devices", () => {
    const mine = { text: base.replace("Monday", "Friday, after the review"), at: "2026-10-17T09:12:00Z", by: "MacBook" };
    const theirs = { text: base.replace("Monday", "Tuesday"), at: "2026-10-17T09:14:00Z", by: "Work laptop" };
    const merged = mergeText(base, mine, theirs);
    expect(merged.conflict).toBe(true);
    expect(merged.text).toBe(
      [
        "Agreed with Anna:",
        "> [!conflict] Changed on two devices — keep one",
        "> **Work laptop · 2026-10-17 09:14 UTC**",
        "> - [ ] call back on Tuesday",
        ">",
        "> **MacBook · 2026-10-17 09:12 UTC**",
        "> - [ ] call back on Friday, after the review",
        "",
        "- [ ] send the offer",
        "Thanks",
      ].join("\n")
    );
    expect(mergeText(base, theirs, mine).text).toBe(merged.text);
    expect(hasConflict(merged.text)).toBe(true);
  });

  it("without a base keeps what both have and additions of either side", () => {
    const mine = { text: "one\ntwo", at: "2026-10-17T09:12:00Z" };
    const theirs = { text: "one\ntwo\nthree", at: "2026-10-17T09:14:00Z" };
    expect(mergeText(undefined, mine, theirs)).toEqual({ text: "one\ntwo\nthree", conflict: false });
  });
});

describe("conflict boxes", () => {
  const text = mergeText(
    base,
    { text: base.replace("Monday", "Friday"), at: "2026-10-17T09:12:00Z", by: "MacBook" },
    { text: base.replace("- [ ] call back on Monday\n", ""), at: "2026-10-17T09:14:00Z", by: "Work laptop" }
  ).text;

  it("reads the versions, including a removed one", () => {
    const [box] = parseConflicts(text);
    expect(box!.versions).toEqual([
      { by: "Work laptop", time: "2026-10-17 09:14 UTC", text: "" },
      { by: "MacBook", time: "2026-10-17 09:12 UTC", text: "- [ ] call back on Friday" },
    ]);
  });

  it("resolves to one version or both, restoring the text around the box", () => {
    expect(resolveConflict(text, 0, 1)).toBe(base.replace("Monday", "Friday"));
    expect(resolveConflict(text, 0, 0)).toBe(base.replace("- [ ] call back on Monday\n", ""));
    expect(resolveConflict(text, 0, "both")).toBe(base.replace("Monday", "Friday"));
  });
});

describe("mergeSets in sync (D32)", () => {
  const set = (body: string, at: string, by: string, colour?: string, colourAt?: string): AnnotationSet => ({
    version: 1,
    email: { messageId: "m@x" },
    rev: 2,
    created: "2026-10-17T08:00:00Z",
    updated: at,
    annotations: [
      {
        id: "a1",
        selectors: [{ type: "TextQuoteSelector", exact: "q" }],
        bodyMd: body,
        created: "2026-10-17T08:00:00Z",
        updated: at,
        textUpdated: at,
        textBy: by,
        ...(colour && { colour, colourUpdated: colourAt }),
      },
    ],
  });

  it("merges three-way with the base the incoming carrier names", () => {
    // Both devices synced `base`; then each edited a different line.
    const synced = rememberSynced(set(base, "2026-10-17T09:00:00Z", "MacBook"), set(base, "2026-10-17T09:00:00Z", "MacBook"));
    const mine = { ...synced, annotations: [{ ...synced.annotations[0]!, bodyMd: base.replace("Thanks", "Thanks!"), textUpdated: "2026-10-17T09:12:00Z", updated: "2026-10-17T09:12:00Z" }] };
    const theirs = withBases(rememberSynced(set(base, "2026-10-17T09:00:00Z", "Work laptop"), set(base, "2026-10-17T09:00:00Z", "Work laptop")));
    theirs.annotations[0] = { ...theirs.annotations[0]!, bodyMd: base.replace("Monday", "Tuesday"), textUpdated: "2026-10-17T09:14:00Z", updated: "2026-10-17T09:14:00Z" };
    expect(theirs.annotations[0]!.textBase).toBe(hash8(base));
    const { set: merged, conflicts } = mergeSets(mine, theirs, "2026-10-17T10:00:00Z", "sync");
    expect(conflicts).toBe(0);
    expect(merged.annotations[0]!.bodyMd).toBe(base.replace("Monday", "Tuesday").replace("Thanks", "Thanks!"));
  });

  it("never lets a colour change win over a text edit", () => {
    const text = set("edited text", "2026-10-17T09:10:00Z", "MacBook", "yellow", "2026-10-17T08:00:00Z");
    const colour = set("old text", "2026-10-17T09:20:00Z", "Work laptop", "blue", "2026-10-17T09:20:00Z");
    colour.annotations[0]!.textUpdated = "2026-10-17T08:00:00Z";
    for (const [a, b] of [[text, colour], [colour, text]] as const) {
      const merged = mergeSets(a, b, "2026-10-17T10:00:00Z", "import").set.annotations[0]!;
      expect(merged.bodyMd).toBe("edited text");
      expect(merged.colour).toBe("blue");
    }
  });

  it("treats the whole-email note like any other note", () => {
    const note = (md: string, at: string, by: string): AnnotationSet => ({
      ...set(base, "2026-10-17T08:00:00Z", by),
      annotations: [],
      emailNoteMd: md,
      emailNoteUpdated: at,
      emailNoteBy: by,
    });
    const mine = note("first\nmine", "2026-10-17T09:12:00Z", "MacBook");
    const theirs = note("first\ntheirs", "2026-10-17T09:14:00Z", "Work laptop");
    const merged = mergeSets(mine, theirs, "2026-10-17T10:00:00Z", "sync");
    expect(merged.conflicts).toBe(1);
    expect(parseConflicts(merged.set.emailNoteMd!)[0]!.versions.map((v) => v.text)).toEqual(["theirs", "mine"]);
  });
});
