/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { hasContent, hasDeletions, restorable, type AnnotationSet } from "@thundernotes/core";
import { moveNotes } from "../src/move.js";

const at = "2026-10-18T10:00:00.000Z";
const set: AnnotationSet = {
  version: 1,
  email: { messageId: "m@x", subject: "Offer", accountId: "work" },
  rev: 3,
  created: at,
  updated: at,
  emailNoteMd: "call back",
  annotations: [{ id: "a1", selectors: [{ type: "TextQuoteSelector", exact: "price" }], bodyMd: "too high", created: at, updated: at }],
};

describe("an email moved to another account takes its notes along (D42)", () => {
  it("carries the notes to the new account and leaves only deletion records, without text, in the old one", () => {
    const { moved, left } = moveNotes(set, "private", null, false, "2026-10-18T11:00:00.000Z");
    expect(moved.email.accountId).toBe("private");
    expect(moved.annotations.map((a) => a.bodyMd)).toEqual(["too high"]);
    expect(moved.emailNoteMd).toBe("call back");
    expect(left!.email.accountId).toBe("work");
    expect(hasContent(left)).toBe(false);
    expect(hasDeletions(left)).toBe(true); // the old account's other devices remove them too
    expect(restorable(left)).toEqual({ annotations: [], emailNote: null }); // no copies left behind
    expect(JSON.stringify(left)).not.toContain("too high");
  });

  it("merges into notes the new account already has on the email", () => {
    const there: AnnotationSet = { ...set, email: { ...set.email, accountId: "private" }, emailNoteMd: undefined, annotations: [{ ...set.annotations[0]!, id: "p1", bodyMd: "private" }] };
    const { moved } = moveNotes(set, "private", there, false);
    expect(moved.annotations.map((a) => a.id).sort()).toEqual(["a1", "p1"]);
  });

  // Review finding: an email moved back (Thunderbird's Undo) met the deletion records its first
  // move had left there, and every note was gone in both accounts.
  it("brings the notes back when the email is moved back to the account it came from", () => {
    const away = moveNotes(set, "private", null, false, "2026-10-18T11:00:00.000Z");
    const back = moveNotes(away.moved, "work", away.left, false, "2026-10-18T11:05:00.000Z");
    expect(back.moved.email.accountId).toBe("work");
    expect(back.moved.annotations.map((a) => a.bodyMd)).toEqual(["too high"]);
    expect(back.moved.emailNoteMd).toBe("call back");
    expect(hasContent(back.left)).toBe(false);
  });

  it("keeps the notes in the old account too while a copy of the email is still there", () => {
    expect(moveNotes(set, "private", null, true).left).toBeNull();
  });
});
