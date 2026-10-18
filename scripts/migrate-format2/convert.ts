/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// File format 1 -> 2 (D25: sections framed by a boundary line). Reads with the frozen format-1
// reader, writes with the current core, and checks that reading the result gives the same notes.
//
//   node convert.ts carriers            JSON on stdin: [{ id, markdown, client }]; JSON out:
//                                       [{ id, status: "converted" | "current" | "failed", eml?, messageId?, error? }]
//                                       (used by migrate.py; eml is a whole new carrier message)
//   node convert.ts export in.zip out.zip   an export from the options page, notes converted, the rest as it was
//
// Needs packages/core built (npm run build -w @thundernotes/core).

import { deepStrictEqual } from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildCarrier, fromMarkdown, toMarkdown, FORMAT_VERSION, type AnnotationSet } from "../../packages/core/dist/index.js";
import { fromMarkdown as fromMarkdownV1 } from "./legacy/format-v1.ts";

type Result = { status: "converted"; markdown: string; set: AnnotationSet } | { status: "current" } | { status: "failed"; error: string };

/** One file's text in format 2; checked by reading it back. */
function convert(markdown: string): Result {
  const version = /^﻿?---\r?\n(?:[\s\S]*?\r?\n)?thundernotes:\s*(\d+)\s*\r?\n/.exec(markdown)?.[1];
  if (Number(version) === FORMAT_VERSION) return { status: "current" };
  if (version !== "1") return { status: "failed", error: `format version ${version ?? "missing"}, expected 1` };
  try {
    const set = fromMarkdownV1(markdown);
    const converted = toMarkdown(set);
    deepStrictEqual(normalise(fromMarkdown(converted)), normalise(set), "the converted file reads back differently");
    return { status: "converted", markdown: converted, set };
  } catch (e) {
    return { status: "failed", error: (e as Error).message };
  }
}

/** For comparing: plain data, keys in a stable order. */
const normalise = (set: AnnotationSet) => JSON.parse(JSON.stringify(set));

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "carriers") {
  const input = JSON.parse(await stdin()) as { id: string; markdown: string; client: string }[];
  const out = input.map(({ id, markdown, client }) => {
    const r = convert(markdown);
    if (r.status !== "converted") return { id, ...r };
    // The same revision, as the device that wrote it: a fresh Message-ID, as every new revision (D7).
    const carrier = buildCarrier(r.set, { client });
    return { id, status: r.status, eml: carrier.eml, messageId: carrier.messageId };
  });
  process.stdout.write(JSON.stringify(out));
} else if (mode === "export" && args.length === 2) {
  const [from, to] = args as [string, string];
  const entries = unzipSync(new Uint8Array(readFileSync(from)));
  const counts = { converted: 0, current: 0, failed: 0 };
  for (const [name, data] of Object.entries(entries)) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    const r = convert(strFromU8(data));
    counts[r.status]++;
    if (r.status === "converted") entries[name] = strToU8(r.markdown);
    if (r.status === "failed") console.error(`${name}: ${r.error} (left as it was)`);
  }
  writeFileSync(to, zipSync(entries, { level: 6 }));
  console.log(`${to}: ${counts.converted} converted, ${counts.current} already format ${FORMAT_VERSION}, ${counts.failed} failed`);
  if (counts.failed) process.exitCode = 1;
} else {
  console.error("usage: node convert.ts carriers < in.json  |  node convert.ts export in.zip out.zip");
  process.exitCode = 2;
}
