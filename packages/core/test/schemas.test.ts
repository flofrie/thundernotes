/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { schemaExample, schemaValidator } from "../../../test/schemas.js";
import { buildSettingsCarrier, fromMarkdown, parseSettings, toMarkdown, type AnnotationSet, type Settings } from "../src/index.js";

const front = (md: string) => parse(/^---\n([\s\S]*?)\n---(?:\n|$)/.exec(md)![1]!);
const fixtures = new URL("./format-fixtures/", import.meta.url);
const validateFront = schemaValidator("format-2-front-matter.schema.json");
const validateSettings = schemaValidator("settings-carrier-1.schema.json");
const at = "2026-10-18T09:00:00.000Z";

describe("format 2 front-matter schema", () => {
  for (const name of readdirSync(fixtures).filter((name) => name.endsWith(".md"))) {
    it(`validates the ${name} reference file and regenerated front matter`, () => {
      const md = readFileSync(new URL(name, fixtures), "utf8");
      expect(validateFront(front(md)), JSON.stringify(validateFront.errors)).toBe(true);
      expect(validateFront(front(toMarkdown(fromMarkdown(md)))), JSON.stringify(validateFront.errors)).toBe(true);
    });
  }

  it("validates generated optional fields, restored copies and compact deletions", () => {
    const base = fromMarkdown(readFileSync(new URL("basic.md", fixtures), "utf8"));
    const a = {
      ...base.annotations[0]!, tags: ["contract"], textUpdated: at, colourUpdated: at,
      textBy: "Laptop", textBase: "1234abcd", textBases: ["1234abcd", "5678abcd"],
    };
    const set: AnnotationSet = {
      ...base,
      email: { ...base.email, account: "you@example.com" },
      annotations: [a],
      emailNoteUpdated: at, emailNoteColour: "green", emailNoteColourUpdated: at,
      emailNoteBy: "Laptop", emailNoteBase: "1234abcd", emailNoteBases: ["1234abcd", "5678abcd"],
      tombstones: [{ id: "deleted-copy", deleted: at, annotation: { ...a, id: "deleted-copy" } }, { id: "compact", deleted: at }],
      deletedEmailNote: { md: "old email note", deleted: at },
      purgedBefore: at,
      folded: { [a.id]: { folded: true, at } },
    };
    expect(validateFront(front(toMarkdown(set))), JSON.stringify(validateFront.errors)).toBe(true);
    set.deletedEmailNote = { deleted: at };
    expect(validateFront(front(toMarkdown(set))), JSON.stringify(validateFront.errors)).toBe(true);
  });

  it("allows documented minimal files and unknown extension fields", () => {
    expect(validateFront({ thundernotes: 2, message_id: "a@b", body_boundary: 0, future: true, annotations: [{ id: "a", quote: "", future: true }] })).toBe(true);
  });

  it.each([
    { thundernotes: 3 },
    { message_id: "" },
    { body_boundary: -1 },
    { body_boundary: 0.5 },
    { body_boundary: Number.MAX_SAFE_INTEGER + 1 },
    { annotations: [{ id: "bad id", quote: "text" }] },
    { annotations: [{ id: "a" }] },
    { annotations: [{ id: "a", quote: "text", position: [1, 2, 3] }] },
    { annotations: [{ id: "a", quote: "text", text_bases: ["not-a-hash"] }] },
    { tombstones: [{ id: "a" }] },
    { deleted_email_note: { note: "missing time" } },
    { folded: { a: { folded: "yes", at } } },
    { email_note_bases: [123] },
    { email_note_updated: "not-a-time" },
  ])("rejects malformed known fields: %j", (fields) => {
    expect(validateFront({ thundernotes: 2, message_id: "a@b", body_boundary: 0, ...fields })).toBe(false);
  });

  it.each(["thundernotes", "message_id", "body_boundary"])("requires %s", (field) => {
    const minimal: Record<string, unknown> = { thundernotes: 2, message_id: "a@b", body_boundary: 0 };
    delete minimal[field];
    expect(validateFront(minimal)).toBe(false);
  });
});

describe("settings carrier schema", () => {
  it("validates the reference and the JSON attachment generated from it", () => {
    const reference = schemaExample("settings-carrier.json") as Settings;
    expect(validateSettings(reference), JSON.stringify(validateSettings.errors)).toBe(true);
    const { eml } = buildSettingsCarrier(reference, { client: "test", now: new Date(at) });
    const encoded = eml.split('filename="thundernotes-settings.json"\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1]!.split("\r\n--")[0]!;
    const json = new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)));
    expect(validateSettings(JSON.parse(json)), JSON.stringify(validateSettings.errors)).toBe(true);
    expect(parseSettings(json)).toEqual(reference);
  });

  it("allows empty settings and unknown fields, rejects invalid versions, colours and order", () => {
    expect(validateSettings({ version: 1, labelColours: {}, future: true })).toBe(true);
    for (const invalid of [
      { version: 2, labelColours: {} },
      { version: 1 },
      { version: 1, labelColours: { work: { colour: "teal", updated: at } } },
      { version: 1, labelColours: {}, labelOrder: { mode: "sideways", custom: [], updated: at } },
      { version: 1, labelColours: {}, labelOrder: { mode: "az", custom: [1], updated: at } },
    ]) expect(validateSettings(invalid)).toBe(false);
  });
});
