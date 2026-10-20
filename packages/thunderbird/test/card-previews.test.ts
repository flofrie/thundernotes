/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The previews handed to the Experiment for the message list's cards (card-previews.ts, D26).

import { describe, expect, it } from "vitest";
import type { AnnotationSet } from "@thundernotes/core";
import { cardKey, cardPreviews } from "../src/card-previews.js";

const at = "2026-10-19T09:00:00.000Z";
const set = (messageId: string, accountId: string, emailNoteMd?: string, annotations = 0): AnnotationSet => ({
  version: 1,
  email: { messageId, accountId },
  rev: 1,
  created: at,
  updated: at,
  ...(emailNoteMd !== undefined && { emailNoteMd }),
  annotations: Array.from({ length: annotations }, (_, i) => ({ id: `a${i}`, selectors: [{ type: "TextQuoteSelector" as const, exact: "x" }], bodyMd: "note", created: at, updated: at })),
});

describe("cardPreviews", () => {
  it("one line per email with a whole-email note, keyed by account and Message-ID without brackets", () => {
    const previews = cardPreviews([set("<a@x>", "account1", "**Call** Anna\n- [ ] offer"), set("b@x", "account2", "Later")]);
    expect(Object.fromEntries(Object.entries(previews).map(([k, p]) => [k, p.text]))).toEqual({
      "account1|a@x": "Call Anna · ☐ offer",
      "account2|b@x": "Later",
    });
  });

  it("brings the note's colour for its lozenge: yellow by default, else the one chosen (D29)", () => {
    const yellow = cardPreviews([set("a@x", "account1", "Note")])["account1|a@x"]!;
    const green = cardPreviews([{ ...set("a@x", "account1", "Note"), emailNoteColour: "green" }])["account1|a@x"]!;
    expect(yellow.background).toMatch(/^rgba\(/);
    expect(green.background).not.toBe(yellow.background);
    expect(["#000000", "#ffffff"]).toContain(green.color);
  });

  it("none for emails with only highlight notes, or none at all", () => {
    expect(cardPreviews([set("a@x", "account1", undefined, 2), set("b@x", "account1", "   ")])).toEqual({});
  });

  it("keys the way the Experiment builds them from a message header", () => {
    expect(cardKey("account1", "<a@x>")).toBe("account1|a@x");
    expect(cardKey(undefined, "a@x")).toBe("|a@x");
  });
});
