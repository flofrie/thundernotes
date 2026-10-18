/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Reference files for file format 2 (D25): what a compatible client must read and write. Each
// `<name>.md` reads to `<name>.json` (the AnnotationSet), and that set writes the same file back.
//   basic    notes, a plain highlight, colours, a task in the whole-email note
//   tricky   a note quoting the format (marker, separator line), unfinished code: body_boundary 1
//   deleted  a deleted note kept for restoring (tombstone)

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromMarkdown, toMarkdown, type AnnotationSet } from "../src/index.js";

const file = (name: string) => readFileSync(new URL(`./format-fixtures/${name}`, import.meta.url), "utf8");

describe("format 2 reference files", () => {
  for (const name of ["basic", "tricky", "deleted"]) {
    it(`${name}: reads to its set and writes back the same file`, () => {
      const md = file(`${name}.md`);
      const set = JSON.parse(file(`${name}.json`)) as AnnotationSet;
      expect(fromMarkdown(md)).toEqual(set);
      expect(toMarkdown(set)).toBe(md);
    });
  }
});
