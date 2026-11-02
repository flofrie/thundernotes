/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The notes overview's list (note-list.ts, D48): every note, newest change first, searched and filtered.

import { describe, expect, it } from "vitest";
import type { Annotation, AnnotationSet } from "@thundernotes/core";
import { changedLabel, collectNotes, filterNotes, type NoteFilter } from "../src/note-list.js";
import { EMAIL_NOTE_ID } from "../src/protocol.js";

const note = (id: string, bodyMd: string, at: string, extra: Partial<Annotation> = {}): Annotation => ({
  id,
  selectors: [{ type: "TextQuoteSelector", exact: `passage of ${id}` }],
  bodyMd,
  created: at,
  updated: at,
  ...extra,
});
const set = (messageId: string, accountId: string, subject: string, from: string, annotations: Annotation[], email?: { md: string; at: string; colour?: string }): AnnotationSet => ({
  version: 1,
  email: { messageId, accountId, subject, from, date: "2026-10-10T08:00:00.000Z" },
  rev: 1,
  created: "2026-10-10T08:00:00.000Z",
  updated: "2026-10-20T08:00:00.000Z",
  annotations,
  ...(email && { emailNoteMd: email.md, emailNoteUpdated: email.at, ...(email.colour && { emailNoteColour: email.colour }) }),
});

const sets = [
  set("a@x", "account1", "Contract renewal", "Anna Weber <anna@example.com>", [
    note("n1", "Check against the **2025** version #legal", "2026-10-28T10:00:00.000Z", { colour: "red" }),
    note("h1", "", "2026-10-29T10:00:00.000Z"), // a plain highlight
  ], { md: "Call Anna about the contract", at: "2026-10-27T09:00:00.000Z", colour: "green" }),
  set("b@x", "account2", "Confirm your tax information", "Coinbase <no-reply@coinbase.com>", [], { md: "Phone check failed", at: "2026-10-29T12:00:00.000Z" }),
];
const all: NoteFilter = { text: "", account: null, colours: [], highlights: true };
const ids = (notes: { noteId: string; messageId: string }[]) => notes.map((n) => `${n.messageId}/${n.noteId}`);

describe("collectNotes", () => {
  it("lists every note of every email, newest change first, with what it is on and its email", () => {
    const notes = collectNotes(sets);
    expect(ids(notes)).toEqual([`b@x/${EMAIL_NOTE_ID}`, "a@x/h1", "a@x/n1", `a@x/${EMAIL_NOTE_ID}`]);
    const n1 = notes.find((n) => n.noteId === "n1")!;
    expect(n1).toMatchObject({ quote: "passage of n1", colour: "red", subject: "Contract renewal", sender: "Anna Weber", senderAddress: "anna@example.com", accountId: "account1" });
    const emailNote = notes.find((n) => n.messageId === "a@x" && n.noteId === EMAIL_NOTE_ID)!;
    expect(emailNote.quote).toBeUndefined(); // on the whole email
    expect(emailNote.colour).toBe("green");
    expect(notes.find((n) => n.messageId === "b@x")!.colour).toBe("yellow"); // none chosen
  });

  it("orders by the text's own change, not the email's", () => {
    const edited = note("old", "edited later", "2026-10-01T00:00:00.000Z", { textUpdated: "2026-10-30T00:00:00.000Z" });
    expect(collectNotes([set("c@x", "account1", "S", "x@y", [edited]), ...sets])[0]!.noteId).toBe("old");
  });
});

describe("filterNotes", () => {
  const notes = collectNotes(sets);

  it("searches the note, its passage, the subject and the sender, in any case", () => {
    expect(ids(filterNotes(notes, { ...all, text: "2025" }))).toEqual(["a@x/n1"]);
    expect(ids(filterNotes(notes, { ...all, text: "#legal" }))).toEqual(["a@x/n1"]); // a label is a word
    expect(ids(filterNotes(notes, { ...all, text: "passage of h1" }))).toEqual(["a@x/h1"]);
    expect(filterNotes(notes, { ...all, text: "TAX" })).toHaveLength(1); // the subject
    expect(filterNotes(notes, { ...all, text: "anna@example.com" })).toHaveLength(3); // the sender
  });

  it("takes the task view's expressions: phrases, exclusions, or", () => {
    expect(ids(filterNotes(notes, { ...all, text: '"call anna"' }))).toEqual([`a@x/${EMAIL_NOTE_ID}`]);
    expect(filterNotes(notes, { ...all, text: "anna -contract" })).toHaveLength(0); // every Anna note is on "Contract renewal"
    expect(filterNotes(notes, { ...all, text: "phone or 2025" })).toHaveLength(2);
  });

  it("filters by account and colour, and leaves plain highlights out if asked", () => {
    expect(ids(filterNotes(notes, { ...all, account: "account2" }))).toEqual([`b@x/${EMAIL_NOTE_ID}`]);
    expect(ids(filterNotes(notes, { ...all, colours: ["red", "green"] }))).toEqual(["a@x/n1", `a@x/${EMAIL_NOTE_ID}`]);
    expect(ids(filterNotes(notes, { ...all, highlights: false }))).not.toContain("a@x/h1");
  });
});

describe("changedLabel", () => {
  const now = new Date(2026, 9, 30, 15, 0);
  it("says briefly when", () => {
    expect(changedLabel(new Date(2026, 9, 30, 14, 59, 40).toISOString(), now)).toBe("just now");
    expect(changedLabel(new Date(2026, 9, 30, 14, 35).toISOString(), now)).toBe("25 min ago");
    expect(changedLabel(new Date(2026, 9, 30, 9, 0).toISOString(), now)).toBe("6 h ago");
    expect(changedLabel(new Date(2026, 9, 29, 23, 0).toISOString(), now)).toBe("yesterday");
    expect(changedLabel(new Date(2026, 9, 12).toISOString(), now)).toMatch(/12/);
    expect(changedLabel(new Date(2025, 2, 3).toISOString(), now)).toMatch(/2025/);
  });
});
