/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Combining a note's text edited on two devices (D32): line by line against the version
 * both started from, as Git does. Lines changed differently on both sides become a
 * conflict box, plain Markdown in the note (an Obsidian/GitHub-style callout), that lists
 * both versions; the user keeps one (or both) on the card, or edits it away by hand.
 *
 *   > [!conflict] Changed on two devices — keep one
 *   > **Work laptop · 2026-10-17 09:14 UTC**
 *   > - [ ] call her back on Monday
 *   >
 *   > **MacBook · 2026-10-17 09:12 UTC**
 *   > - [ ] call her back on Friday
 *
 * The result must be the same on every device that combines the same two versions, so the
 * order of the versions is fixed (newer first) and times are written in UTC.
 */

import { diff3Merge, diffComm } from "node-diff3";

/** Key of the whole-email note in an AnnotationSet's `syncHistory`. */
export const EMAIL_NOTE_KEY = "#email";

/** One side of a merge: its text, when it was written and on which device. */
export interface TextSide {
  text: string;
  at: string;
  by?: string;
}

export interface TextMerge {
  text: string;
  conflict: boolean;
}

const TITLE = "> [!conflict] Changed on two devices — keep one";
const TITLE_RE = /^> \[!conflict\]/;
const HEADER_RE = /^> \*\*(.*) · (\d{4}-\d\d-\d\d \d\d:\d\d UTC)\*\*$/;
const REMOVED = "*(removed)*";
const UNKNOWN_DEVICE = "Another device";

/** `2026-10-17 09:14 UTC`: the same on every device. */
export function conflictTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "1970-01-01 00:00 UTC";
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/** Newer first; ties by device name, then text, so every device orders alike. */
function ordered(a: TextSide, b: TextSide): [TextSide, TextSide] {
  if (a.at !== b.at) return a.at > b.at ? [a, b] : [b, a];
  const ka = `${a.by ?? ""}\n${a.text}`;
  const kb = `${b.by ?? ""}\n${b.text}`;
  return ka <= kb ? [a, b] : [b, a];
}

/** The conflict box for two versions of some lines, followed by one blank line (see below). */
function conflictLines(first: { lines: string[]; side: TextSide }, second: { lines: string[]; side: TextSide }): string[] {
  const version = (v: { lines: string[]; side: TextSide }) => [
    `> **${(v.side.by || UNKNOWN_DEVICE).replace(/\*/g, "")} · ${conflictTime(v.side.at)}**`,
    ...(v.lines.length ? v.lines : [REMOVED]).map((l) => (l ? `> ${l}` : ">")),
  ];
  return [TITLE, ...version(first), ">", ...version(second)];
}

/**
 * Three-way merge of a note's text. `base` is the version both sides started from;
 * without it (unknown), lines both have are kept and the rest is treated as changed on
 * both sides, so nothing is lost.
 */
export function mergeText(base: string | undefined, mine: TextSide, theirs: TextSide): TextMerge {
  if (mine.text === theirs.text) return { text: mine.text, conflict: false };
  if (base !== undefined) {
    if (mine.text === base) return { text: theirs.text, conflict: false };
    if (theirs.text === base) return { text: mine.text, conflict: false };
  }
  // An empty text has no lines (not one empty line).
  const lines = (text: string) => (text === "" ? [] : text.split("\n"));
  const a = lines(mine.text);
  const b = lines(theirs.text);
  const o =
    base !== undefined
      ? lines(base)
      : diffComm(a, b).flatMap((c: { common?: string[] }) => c.common ?? []);
  const [newer] = ordered(mine, theirs);
  const chunks = diff3Merge(a, o, b, { excludeFalseConflicts: true }) as Array<
    { ok: string[] } | { conflict: { a: string[]; o: string[]; b: string[] } }
  >;
  // Segments: lines both agree on, or lines that differ (a conflict box).
  const segments: Array<{ ok: string[] } | { mine: string[]; theirs: string[] }> = [];
  const ok = (lines: string[]) => {
    const last = segments[segments.length - 1];
    if (last && "ok" in last) last.ok.push(...lines);
    else segments.push({ ok: [...lines] });
  };
  const clash = (m: string[], t: string[]) => {
    const last = segments[segments.length - 1];
    if (last && "mine" in last) {
      last.mine.push(...m);
      last.theirs.push(...t);
    } else segments.push({ mine: [...m], theirs: [...t] });
  };
  for (const chunk of chunks) {
    if ("ok" in chunk) {
      ok(chunk.ok);
      continue;
    }
    const { a: m, b: t, o: bl } = chunk.conflict;
    // Without a base, a hunk only one side has is an addition: keep it.
    if (base === undefined && (!m.length || !t.length) && !bl.length) {
      ok(m.length ? m : t);
    } else if (m.length === bl.length && t.length === bl.length) {
      // Only lines replaced on both sides (e.g. two neighbouring tasks ticked on two
      // devices): decided line by line; only lines changed differently on both clash.
      for (let k = 0; k < bl.length; k++) {
        if (m[k] === t[k] || t[k] === bl[k]) ok([m[k]!]);
        else if (m[k] === bl[k]) ok([t[k]!]);
        else clash([m[k]!], [t[k]!]);
      }
    } else {
      clash(m, t);
    }
  }
  const out: string[] = [];
  let conflict = false;
  segments.forEach((s, i) => {
    if ("ok" in s) {
      out.push(...s.ok);
      return;
    }
    conflict = true;
    const m = { lines: s.mine, side: mine };
    const t = { lines: s.theirs, side: theirs };
    out.push(...(newer === mine ? conflictLines(m, t) : conflictLines(t, m)));
    // A blank line after the box, so the next line isn't read as part of the quote.
    if (i < segments.length - 1) out.push("");
  });
  return { text: out.join("\n"), conflict };
}

// ---- reading and resolving conflict boxes ------------------------------------------------------

export interface ConflictVersion {
  /** Device name. */
  by: string;
  /** As written in the box: `2026-10-17 09:14 UTC`. */
  time: string;
  text: string;
}

export interface ConflictBox {
  /** Line numbers (0-based) of the box, `to` exclusive, including the blank line after it. */
  from: number;
  to: number;
  versions: ConflictVersion[];
}

/** Whether a note's text holds a conflict box. */
export function hasConflict(md: string): boolean {
  return md.split("\n").some((l) => TITLE_RE.test(l));
}

/** The conflict boxes in a note's text, in order. */
export function parseConflicts(md: string): ConflictBox[] {
  const lines = md.split("\n");
  const boxes: ConflictBox[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!TITLE_RE.test(lines[i]!)) continue;
    const from = i;
    let end = i + 1;
    while (end < lines.length && /^>/.test(lines[end]!)) end++;
    const versions: ConflictVersion[] = [];
    let current: { by: string; time: string; lines: string[] } | null = null;
    for (let k = from + 1; k < end; k++) {
      const header = HEADER_RE.exec(lines[k]!);
      if (header) {
        if (current) versions.push(finish(current));
        current = { by: header[1]!, time: header[2]!, lines: [] };
      } else if (current) {
        current.lines.push(lines[k]!.replace(/^> ?/, ""));
      }
    }
    if (current) versions.push(finish(current));
    const to = end < lines.length && lines[end] === "" ? end + 1 : end;
    boxes.push({ from, to, versions });
    i = end - 1;
  }
  return boxes;
}

function finish(v: { by: string; time: string; lines: string[] }): ConflictVersion {
  // The blank quote line before the next version is a separator, not content.
  const lines = [...v.lines];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const text = lines.length === 1 && lines[0] === REMOVED ? "" : lines.join("\n");
  return { by: v.by, time: v.time, text };
}

/**
 * Resolves the `index`-th conflict box: keeps version `choice` (0 = first), or "both" (all
 * versions as normal text, in the box's order).
 */
export function resolveConflict(md: string, index: number, choice: number | "both"): string {
  const box = parseConflicts(md)[index];
  if (!box) return md;
  const lines = md.split("\n");
  const kept = choice === "both" ? box.versions.map((v) => v.text) : [box.versions[choice]?.text ?? ""];
  const replacement = kept.filter((t) => t !== "").flatMap((t) => t.split("\n"));
  // The box's range includes the blank line the merge added after it.
  return [...lines.slice(0, box.from), ...replacement, ...lines.slice(box.to)].join("\n");
}
