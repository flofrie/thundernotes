/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { CARRIER_NOTICE, buildCarrier, fromMarkdown, parseCarrierHeaders, type AnnotationSet } from "../src/index.js";

const set: AnnotationSet = {
  version: 1,
  email: { messageId: "CAF3xQ9b1k@mail.example.com", subject: "Grüße – Vertrag v3", date: "2026-10-12T07:14:00.000Z" },
  rev: 7,
  created: "2026-10-13T08:02:11.000Z",
  updated: "2026-10-13T08:20:45.000Z",
  emailNoteMd: "Note on the whole email.",
  emailNoteUpdated: "2026-10-13T08:20:45.000Z",
  annotations: [
    {
      id: "a1",
      selectors: [{ type: "TextQuoteSelector", exact: "Kündigungsfrist von 6 Monaten", prefix: "eine ", suffix: " zum" }],
      bodyMd: "Wir hatten **3 Monate** vereinbart.",
      created: "2026-10-13T08:02:11.000Z",
      updated: "2026-10-13T08:20:45.000Z",
    },
  ],
  tombstones: [{ id: "old", deleted: "2026-10-12T00:00:00.000Z" }],
};

/** Minimal MIME reader for the test: unfolded headers, parts split by boundary. */
function readEml(eml: string) {
  expect(eml).not.toMatch(/[^\r]\n/); // CRLF only
  const [head, ...rest] = eml.split("\r\n\r\n");
  const headers: Record<string, string[]> = {};
  for (const line of head!.split("\r\n")) {
    const i = line.indexOf(":");
    (headers[line.slice(0, i).toLowerCase()] ??= []).push(line.slice(i + 1).trim());
  }
  const boundary = /boundary="([^"]+)"/.exec(headers["content-type"]![0]!)![1]!;
  const parts = rest.join("\r\n\r\n").split(`--${boundary}`).slice(1, -1).map((p) => {
    const [h, ...b] = p.replace(/^\r\n/, "").split("\r\n\r\n");
    return { head: h!, body: b.join("\r\n\r\n").trim() };
  });
  return { headers, parts };
}

describe("carrier messages", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const { eml, messageId } = buildCarrier(set, { client: "tb-test", now });
  const { headers, parts } = readEml(eml);

  it("has the X-Annot headers and a fresh Message-ID", () => {
    expect(parseCarrierHeaders(headers)).toEqual({
      version: 1,
      ref: "CAF3xQ9b1k@mail.example.com",
      rev: 7,
      updated: "2026-10-13T08:20:45.000Z",
      client: "tb-test",
    });
    expect(headers["message-id"]![0]).toBe(`<${messageId}>`);
    expect(buildCarrier(set, { client: "tb-test", now }).messageId).not.toBe(messageId);
    expect(headers["date"]![0]).toBe("Thu, 15 Oct 2026 12:00:00 +0000");
  });

  it("encodes a non-ASCII subject", () => {
    const encoded = headers["subject"]![0]!;
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded.slice(10, -2)), (c) => c.charCodeAt(0)));
    expect(decoded).toBe("[ThunderNotes] Grüße – Vertrag v3");
  });

  it("starts with the notice and carries the full set as Markdown", () => {
    expect(parts[0]!.head).toContain("text/plain");
    expect(parts[0]!.body).toBe(CARRIER_NOTICE);
    expect(parts[1]!.head).toContain("text/markdown");
    expect(parts[1]!.head).toMatch(/filename="2026-10-12_gruesse-vertrag-v3_[0-9a-f]{8}\.md"/);
    const md = new TextDecoder().decode(Uint8Array.from(atob(parts[1]!.body.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)));
    expect(fromMarkdown(md)).toEqual(set);
  });

  it("ignores messages that aren't carriers", () => {
    expect(parseCarrierHeaders({ subject: ["hello"] })).toBeNull();
    expect(parseCarrierHeaders({ "x-annot-version": "1", "x-annot-ref": "<a@b>", "x-annot-rev": "x" })).toBeNull();
  });
});
