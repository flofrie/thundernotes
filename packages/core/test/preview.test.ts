/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { notePreview } from "../src/index.js";

describe("notePreview (one line of a note, for the message list's cards)", () => {
  it("keeps plain text as it is", () => {
    expect(notePreview("Call Anna about the contract")).toBe("Call Anna about the contract");
  });

  it("drops Markdown marks and joins lines with a dot", () => {
    const md = "# Contract\n\nThe **termination** period is _six_ months.\n\n> quoted line\n\n---\n\n1. first\n2. `code` second";
    expect(notePreview(md)).toBe("Contract · The termination period is six months. · quoted line · first · code second");
  });

  it("shows checklist items as boxes, ticked or not, with dates and labels as typed", () => {
    expect(notePreview("- [ ] send the offer @friday #client\n- [x] read it")).toBe("☐ send the offer @friday #client · ☑ read it");
  });

  it("shows links as their text, and bare addresses without brackets", () => {
    expect(notePreview("See [the offer – Anna, 12 Oct](mid:abc@x) and <https://example.com>")).toBe("See the offer – Anna, 12 Oct and https://example.com");
  });

  it("keeps the lines of a code block, without its fences", () => {
    expect(notePreview("```\nnpm ci\n```")).toBe("npm ci");
  });

  it("shortens long notes, ending in an ellipsis", () => {
    const preview = notePreview("word ".repeat(200), 50);
    expect(preview).toHaveLength(50);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("is empty for an empty note", () => {
    expect(notePreview("  \n\n")).toBe("");
  });
});
