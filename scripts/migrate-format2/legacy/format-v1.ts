/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// FROZEN COPY of packages/core/src/format.ts at 4116f81 (file format 1), trimmed to reading.
// Used only by the format-2 migration script; never imported by the add-on. Don't edit.

/**
 * The ThunderNotes file format (D5, D25): one Markdown file per email.
 * - YAML front matter: the email reference and, per annotation, its id, quote,
 *   prefix/suffix, position and timestamps. Authoritative for anchoring.
 * - Body: `# Subject`, then the note on the whole email, then one `## “quote”`
 *   section per annotation that has a note, marked `<!-- tn:<id> -->`. Authoritative
 *   for note text. Headings without the marker belong to the note above them.
 * Used for export/import, the IMAP carrier attachment (D7) and the Git folder (D6).
 */

import { CodeScanner } from "./code-blocks.ts";
import { Document, isPair, isScalar, isSeq, parse, visit } from "yaml";
import { EMAIL_NOTE_KEY, mergeText } from "../../../packages/core/dist/conflict.js";
import type { Annotation, AnnotationSet, EmailRef, FoldState, TextPositionSelector, TextQuoteSelector, Tombstone } from "../../../packages/core/dist/index.js";

export const FORMAT_VERSION = 1;

interface FrontAnnotation {
  id: string;
  quote: string;
  prefix?: string;
  suffix?: string;
  position?: [number, number];
  colour?: string;
  tags?: string[];
  created: string;
  updated: string;
  text_updated?: string;
  text_by?: string;
  text_base?: string;
  colour_updated?: string;
}

interface FrontMatter {
  thundernotes: number;
  message_id: string;
  subject?: string;
  from?: string;
  date?: string;
  folder_hint?: string;
  account?: string;
  created: string;
  updated: string;
  rev: number;
  email_note_updated?: string;
  email_note_colour?: string;
  email_note_colour_updated?: string;
  email_note_by?: string;
  email_note_base?: string;
  annotations?: FrontAnnotation[];
  tombstones?: Array<{ id: string; deleted: string; note?: string } & Partial<FrontAnnotation>>;
  deleted_email_note?: { note?: string; deleted: string };
  purged_before?: string;
  folded?: Record<string, FoldState>;
  /** Written by versions that close a note's open code block at its end (issue #4). */
  code_closed?: boolean;
}

const MARKER = /<!--\s*tn:([^\s>]+)\s*-->/;
const QUOTE_IN_HEADING = 80;

function quoteOf(a: Annotation): TextQuoteSelector | undefined {
  return a.selectors.find((s): s is TextQuoteSelector => s.type === "TextQuoteSelector");
}

function positionOf(a: Annotation): TextPositionSelector | undefined {
  return a.selectors.find((s): s is TextPositionSelector => s.type === "TextPositionSelector");
}

/** One line of the quote for a heading: no line breaks, shortened, no stray markers. */
function headingQuote(quote: string): string {
  const flat = quote.replace(/\s+/g, " ").replace(/<!--|-->/g, "").trim();
  return flat.length > QUOTE_IN_HEADING ? `${flat.slice(0, QUOTE_IN_HEADING - 1)}…` : flat;
}

function toFront(a: Annotation): FrontAnnotation {
  const quote = quoteOf(a);
  const position = positionOf(a);
  return {
    id: a.id,
    quote: quote?.exact ?? "",
    ...(quote?.prefix && { prefix: quote.prefix }),
    ...(quote?.suffix && { suffix: quote.suffix }),
    ...(position && { position: [position.start, position.end] as [number, number] }),
    ...(a.colour && { colour: a.colour }),
    ...(a.tags?.length && { tags: a.tags }),
    created: a.created,
    updated: a.updated,
    ...(a.textUpdated && a.textUpdated !== a.updated && { text_updated: a.textUpdated }),
    ...(a.textBy && { text_by: a.textBy }),
    ...(a.textBase && { text_base: a.textBase }),
    ...(a.colourUpdated && a.colourUpdated !== a.updated && { colour_updated: a.colourUpdated }),
  };
}

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
const time = (v: unknown, fallback: string) => (v instanceof Date ? v.toISOString() : (str(v) ?? fallback));

/** Front-matter fields + note text -> Annotation. */
function fromFront(fa: FrontAnnotation, bodyMd: string, created: string): Annotation {
  const selectors: Annotation["selectors"] = [
    {
      type: "TextQuoteSelector",
      exact: String(fa.quote),
      ...(fa.prefix !== undefined && { prefix: String(fa.prefix) }),
      ...(fa.suffix !== undefined && { suffix: String(fa.suffix) }),
    },
  ];
  if (Array.isArray(fa.position) && fa.position.length === 2) {
    selectors.push({ type: "TextPositionSelector", start: Number(fa.position[0]), end: Number(fa.position[1]) });
  }
  const annotation: Annotation = {
    id: String(fa.id),
    selectors,
    bodyMd,
    created: time(fa.created, created),
    updated: time(fa.updated, created),
  };
  if (fa.colour) annotation.colour = String(fa.colour);
  if (fa.text_updated !== undefined) annotation.textUpdated = time(fa.text_updated, annotation.updated);
  if (fa.text_by) annotation.textBy = String(fa.text_by);
  if (fa.text_base) annotation.textBase = String(fa.text_base);
  if (fa.colour_updated !== undefined) annotation.colourUpdated = time(fa.colour_updated, annotation.updated);
  if (Array.isArray(fa.tags) && fa.tags.length) annotation.tags = fa.tags.map(String);
  return annotation;
}

/** Marks the line that closes a note's code block left open, so reading takes it out again. */
const CODE_CLOSED = "<!-- tn:code-closed -->";

/**
 * A note's text for the file: a code block left open at its end (``` typed, never closed) is
 * closed by a marked line, so the next note's heading can't be read as code (issue #4).
 */
function closeOpenCode(md: string): string {
  const scanner = new CodeScanner();
  for (const line of md.split("\n")) scanner.feed(line);
  const fence = scanner.closingFence;
  return fence ? `${md}\n${fence}\n${CODE_CLOSED}` : md;
}

/** A note's text from the file, without the marked closing line closeOpenCode added. */
const withoutAddedClose = (md: string) => md.replace(/\n(?:`{3,}|~{3,})\n<!-- tn:code-closed -->$/, "");

/** AnnotationSet -> Markdown file content. */
export function toMarkdown(set: AnnotationSet): string {
  const front: FrontMatter = {
    thundernotes: FORMAT_VERSION,
    message_id: set.email.messageId,
    ...(set.email.subject !== undefined && { subject: set.email.subject }),
    ...(set.email.from !== undefined && { from: set.email.from }),
    ...(set.email.date !== undefined && { date: set.email.date }),
    ...(set.email.folderHint !== undefined && { folder_hint: set.email.folderHint }),
    ...(set.email.account !== undefined && { account: set.email.account }),
    created: set.created,
    updated: set.updated,
    rev: set.rev,
    ...(set.emailNoteUpdated !== undefined && { email_note_updated: set.emailNoteUpdated }),
    ...(set.emailNoteColour && { email_note_colour: set.emailNoteColour }),
    ...(set.emailNoteColourUpdated && { email_note_colour_updated: set.emailNoteColourUpdated }),
    ...(set.emailNoteBy && { email_note_by: set.emailNoteBy }),
    ...(set.emailNoteBase && { email_note_base: set.emailNoteBase }),
    annotations: set.annotations.map(toFront),
    code_closed: true,
  };
  if (!front.annotations!.length) delete front.annotations;
  // A tombstone keeps a copy of what was deleted (D33): its fields plus the note text.
  if (set.tombstones?.length) {
    front.tombstones = set.tombstones.map((t) => ({
      id: t.id,
      deleted: t.deleted,
      ...(t.annotation && { ...toFront(t.annotation), id: t.id, ...(t.annotation.bodyMd && { note: t.annotation.bodyMd }) }),
    }));
  }
  if (set.deletedEmailNote) {
    const den = set.deletedEmailNote;
    front.deleted_email_note = { ...(den.md !== undefined ? { note: den.md } : {}), deleted: den.deleted };
  }
  if (set.purgedBefore) front.purged_before = set.purgedBefore;
  if (set.folded && Object.keys(set.folded).length) {
    front.folded = Object.fromEntries(Object.entries(set.folded).map(([id, f]) => [id, { folded: f.folded, at: f.at }]));
  }

  const doc = new Document(front);
  // `position: [1043, 1073]` on one line.
  visit(doc, {
    Pair(_, pair) {
      if (isPair(pair) && isScalar(pair.key) && pair.key.value === "position" && isSeq(pair.value)) pair.value.flow = true;
    },
  });
  const yaml = doc.toString({ lineWidth: 0 }).trimEnd();
  const parts = [`---\n${yaml}\n---`, `# ${set.email.subject?.trim() || "(no subject)"}`];
  if (set.emailNoteMd?.trim()) parts.push(closeOpenCode(set.emailNoteMd.trim()));
  for (const a of set.annotations) {
    if (!a.bodyMd.trim()) continue;
    parts.push(`## “${headingQuote(quoteOf(a)?.exact ?? "")}” <!-- tn:${a.id} -->\n\n${closeOpenCode(a.bodyMd.trim())}`);
  }
  return `${parts.join("\n\n")}\n`;
}

export class FormatError extends Error {}

/** Markdown file content -> AnnotationSet. Throws FormatError for files that aren't ours. */
export function fromMarkdown(text: string): AnnotationSet {
  const source = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!fm) throw new FormatError("no front matter");
  let front: FrontMatter;
  try {
    front = parse(fm[1]!) as FrontMatter;
  } catch (e) {
    throw new FormatError(`front matter is not valid YAML: ${(e as Error).message}`);
  }
  if (!front || typeof front !== "object" || front.thundernotes === undefined) throw new FormatError("not a ThunderNotes file");
  if (Number(front.thundernotes) > FORMAT_VERSION) throw new FormatError(`format version ${front.thundernotes} is newer than this add-on`);
  if (!front.message_id) throw new FormatError("message_id missing");

  // Body: title line, email note, then marked sections.
  const notes = new Map<string, string[]>();
  const emailNote: string[] = [];
  let current = emailNote;
  let titleSeen = false;
  // A section starts at a marked heading for a note the front matter lists that hasn't started
  // yet, outside code (issue #4: a literal example of the format in a note stays text). Files
  // written since then close a note's open code block at its end (code_closed). In older ones a
  // note may end inside code: there the next note in the file's order still starts its section,
  // so the notes after it aren't swallowed. Each note's code is read on its own.
  const strict = front.code_closed === true;
  const order = (Array.isArray(front.annotations) ? front.annotations : []).map((a) => String(a?.id));
  const seen = new Set<string>();
  let last = -1;
  const scanner = new CodeScanner();
  for (const line of source.slice(fm[0].length).split("\n")) {
    const candidate = /^##\s/.test(line) ? MARKER.exec(line) : null;
    const at = candidate ? order.indexOf(candidate[1]!) : -1;
    const marker = at !== -1 && !seen.has(candidate![1]!) && (!scanner.inFence || (!strict && at > last)) ? candidate : null;
    if (marker) {
      seen.add(marker[1]!);
      last = Math.max(last, at);
      scanner.reset();
    } else {
      scanner.feed(line);
    }
    if (marker) {
      current = [];
      notes.set(marker[1]!, current);
    } else if (!titleSeen && /^#\s/.test(line) && current === emailNote && !emailNote.some((l) => l.trim())) {
      titleSeen = true; // the generated "# Subject" line
    } else {
      current.push(line);
    }
  }
  const joined = (lines: string[]) => withoutAddedClose(lines.join("\n").trim());

  const now = new Date().toISOString();
  const created = time(front.created, now);
  const email: EmailRef = { messageId: String(front.message_id) };
  if (front.subject !== undefined) email.subject = String(front.subject);
  if (front.from !== undefined) email.from = String(front.from);
  if (front.date !== undefined) email.date = time(front.date, "");
  if (front.folder_hint !== undefined) email.folderHint = String(front.folder_hint);
  if (front.account !== undefined) email.account = String(front.account);

  const annotations: Annotation[] = (front.annotations ?? []).map((fa, i) => {
    if (!fa || fa.id === undefined || fa.quote === undefined) throw new FormatError(`annotation ${i + 1}: id or quote missing`);
    return fromFront(fa, joined(notes.get(String(fa.id)) ?? []), created);
  });

  const set: AnnotationSet = {
    version: 1,
    email,
    rev: Number(front.rev) || 0,
    created,
    updated: time(front.updated, created),
    annotations,
  };
  const emailNoteMd = joined(emailNote);
  if (emailNoteMd) set.emailNoteMd = emailNoteMd;
  if (front.email_note_updated !== undefined) set.emailNoteUpdated = time(front.email_note_updated, created);
  if (front.email_note_colour) set.emailNoteColour = String(front.email_note_colour);
  if (front.email_note_colour_updated !== undefined) set.emailNoteColourUpdated = time(front.email_note_colour_updated, created);
  if (front.email_note_by) set.emailNoteBy = String(front.email_note_by);
  if (front.email_note_base) set.emailNoteBase = String(front.email_note_base);
  if (Array.isArray(front.tombstones) && front.tombstones.length) {
    set.tombstones = front.tombstones
      .filter((t) => t && t.id !== undefined)
      .map((t) => {
        const tomb: Tombstone = { id: String(t.id), deleted: time(t.deleted, created) };
        if (t.quote !== undefined) tomb.annotation = fromFront(t as FrontAnnotation, t.note === undefined ? "" : String(t.note), created);
        return tomb;
      });
  }
  const den = front.deleted_email_note;
  if (den && typeof den === "object" && den.deleted !== undefined) {
    set.deletedEmailNote = { ...(den.note !== undefined && den.note !== null ? { md: String(den.note) } : {}), deleted: time(den.deleted, created) };
  }
  if (front.purged_before !== undefined) set.purgedBefore = time(front.purged_before, created);
  if (front.folded && typeof front.folded === "object") {
    const folded = Object.entries(front.folded)
      .filter(([, f]) => f && typeof f === "object")
      .map(([id, f]) => [String(id), { folded: f.folded === true, at: time(f.at, created) }] as const);
    if (folded.length) set.folded = Object.fromEntries(folded);
  }
  return set;
}
