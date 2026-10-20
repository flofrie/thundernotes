/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The ThunderNotes file format (D5, D25): one Markdown file per email.
 * - YAML front matter: the email reference and, per annotation, its id, quote,
 *   prefix/suffix, position (or, on a picture, `image`, D46) and timestamps. Authoritative for anchoring.
 * - Body: `# Subject`, then the note on the whole email, then one `## “quote”`
 *   section per annotation that has a note, marked `<!-- tn:<id> -->`. Authoritative
 *   for note text. Headings without the marker belong to the note above them.
 * Used for export/import, the IMAP carrier attachment (D7) and the Git folder (D6).
 */

import { Document, isPair, isScalar, isSeq, parse, visit } from "yaml";
import { EMAIL_NOTE_KEY, mergeText } from "./conflict.js";
import { imageSelectorOf, quoteLabel } from "./anchoring/image.js";
import type { Annotation, AnnotationSet, EmailRef, FoldState, TextPositionSelector, TextQuoteSelector, Tombstone } from "./index.js";

export const FORMAT_VERSION = 2;

interface FrontAnnotation {
  id: string;
  quote: string;
  prefix?: string;
  suffix?: string;
  position?: [number, number];
  /** A note on a picture (D46); `quote` is then empty, so older readers place it nowhere. */
  image?: { src: string; index: number; alt?: string; prefix?: string; suffix?: string };
  colour?: string;
  tags?: string[];
  created: string;
  updated: string;
  text_updated?: string;
  text_by?: string;
  text_base?: string;
  text_bases?: string[];
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
  email_note_bases?: string[];
  annotations?: FrontAnnotation[];
  tombstones?: Array<{ id: string; deleted: string; note?: string } & Partial<FrontAnnotation>>;
  deleted_email_note?: { note?: string; deleted: string };
  purged_before?: string;
  folded?: Record<string, FoldState>;
  /** Selects a separator line absent from every note. Sections do not depend on Markdown syntax. */
  body_boundary: number;
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
  const image = imageSelectorOf(a);
  return {
    id: a.id,
    quote: quote?.exact ?? "",
    ...(image && {
      image: {
        src: image.src,
        index: image.index,
        ...(image.alt && { alt: image.alt }),
        ...(image.prefix && { prefix: image.prefix }),
        ...(image.suffix && { suffix: image.suffix }),
      },
    }),
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
    ...(a.textBases && a.textBases.length > 1 && { text_bases: a.textBases }),
    ...(a.colourUpdated && a.colourUpdated !== a.updated && { colour_updated: a.colourUpdated }),
  };
}

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
const time = (v: unknown, fallback: string) => (v instanceof Date ? v.toISOString() : (str(v) ?? fallback));

/** Front-matter fields + note text -> Annotation. */
function fromFront(fa: FrontAnnotation, bodyMd: string, created: string): Annotation {
  const image = fa.image && typeof fa.image === "object" && fa.image.src !== undefined ? fa.image : undefined;
  const index = Number(image?.index);
  const selectors: Annotation["selectors"] = image
    ? [
        {
          type: "ImageSelector",
          src: String(image.src),
          index: Number.isSafeInteger(index) && index >= 0 ? index : 0,
          ...(image.alt && { alt: String(image.alt) }),
          ...(image.prefix && { prefix: String(image.prefix) }),
          ...(image.suffix && { suffix: String(image.suffix) }),
        },
      ]
    : [
    {
      type: "TextQuoteSelector",
      exact: String(fa.quote),
      ...(fa.prefix !== undefined && { prefix: String(fa.prefix) }),
      ...(fa.suffix !== undefined && { suffix: String(fa.suffix) }),
    },
  ];
  if (!image && Array.isArray(fa.position) && fa.position.length === 2) {
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
  if (Array.isArray(fa.text_bases) && fa.text_bases.length) annotation.textBases = fa.text_bases.map(String);
  if (fa.colour_updated !== undefined) annotation.colourUpdated = time(fa.colour_updated, annotation.updated);
  if (Array.isArray(fa.tags) && fa.tags.length) annotation.tags = fa.tags.map(String);
  return annotation;
}

const boundaryLine = (index: number) => `<!-- thundernotes:boundary:${index} -->`;
const noteText = (md: string) => md.replace(/\r\n?/g, "\n").replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, "");

/** A deterministic separator absent from all user text; literal format examples stay literal. */
function chooseBoundary(texts: string[]): number {
  const occupied = new Set(texts.flatMap((md) => noteText(md).split("\n")));
  let index = 0;
  while (occupied.has(boundaryLine(index))) index++;
  return index;
}

/** A section that couldn't be placed (an import): it becomes a note of its own. */
interface Recovered {
  id: string;
  /** The quote its heading names ("" if none); for a duplicate, the note it duplicates (`like`). */
  quote: string;
  like?: string;
  bodyMd: string;
}

/**
 * Split protocol frames, not Markdown blocks. A note may contain any headings or unfinished
 * code. The final separator is required, and malformed/duplicate/unknown sections fail closed;
 * with `problem` (a file the user may have edited, being imported) nothing is dropped instead:
 * each section that can't be placed becomes a note of its own, and `problem` hears why. Its own
 * id (from its text: importing the file again finds the same note) means no merge can overwrite
 * it with a newer local note, as it could if it were added to another note.
 */
function readBody(body: string, boundary: number, ids: Set<string>, problem?: (message: string) => void): { emailNote: string; notes: Map<string, string>; recovered: Recovered[] } {
  const fail = (message: string) => {
    if (!problem) throw new FormatError(message);
    problem(message);
  };
  const frames: string[][] = [[]];
  for (const line of body.split("\n")) {
    if (line === boundaryLine(boundary)) frames.push([]);
    else frames[frames.length - 1]!.push(line);
  }
  // Text after the last separator (it went missing, or text was added below it): a section of its own.
  if (frames.length < 2 || frames[frames.length - 1]!.some((line) => line.trim())) fail("missing final body boundary");
  else frames.pop();
  const first = noteText(frames.shift()!.join("\n"));
  const titleEnd = first.indexOf("\n");
  const title = titleEnd === -1 ? first : first.slice(0, titleEnd);
  const titled = /^# /.test(title);
  if (!titled) fail("body title missing");
  const emailNote = titled && titleEnd !== -1 ? noteText(first.slice(titleEnd + 1)) : "";
  const notes = new Map<string, string>();
  const recovered: Recovered[] = [];
  const recover = (text: string, quote: string, like?: string) => {
    if (!text) return;
    let id = `recovered-${hash8(`${like ?? ""}\n${quote}\n${text}`)}`;
    while (ids.has(id) || recovered.some((r) => r.id === id)) id += "x"; // the same text twice
    recovered.push({ id, quote, ...(like ? { like } : {}), bodyMd: text });
  };
  // A malformed first frame is unplaced text too: putting it in the whole-email note
  // would let a newer local note discard it during import. Keep its heading, if any.
  if (!titled) recover(first, "");
  for (const frame of frames) {
    const text = noteText(frame.join("\n"));
    const end = text.indexOf("\n");
    const heading = end === -1 ? text : text.slice(0, end);
    const marker = /^##[ \t]/.test(heading) ? MARKER.exec(heading) : null;
    const id = marker?.[1];
    const own = end === -1 ? "" : noteText(text.slice(end + 1));
    if (!id || !ids.has(id)) {
      fail(id ? `section for an unknown note ${id}: kept as a note of its own` : "section without a note marker: kept as a note of its own");
      // A marked heading names its quote ("## “…” <!-- tn:x -->"): the note anchors there if it can.
      // Without a marker, the heading is the user's text and stays in it.
      if (id) recover(own, heading.replace(MARKER, "").replace(/^##[ \t]+/, "").trim().replace(/^“([\s\S]*)”$/, "$1").replace(/…$/, ""));
      else recover(text, "");
      continue;
    }
    if (notes.has(id)) {
      fail(`duplicate annotation section ${id}: kept as a note of its own on the same passage`);
      recover(own, "", id);
      continue;
    }
    notes.set(id, own);
  }
  return { emailNote, notes, recovered };
}

/** AnnotationSet -> Markdown file content. */
export function toMarkdown(set: AnnotationSet): string {
  const boundary = chooseBoundary([set.emailNoteMd ?? "", ...set.annotations.map((a) => a.bodyMd)]);
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
    ...(set.emailNoteBases && set.emailNoteBases.length > 1 && { email_note_bases: set.emailNoteBases }),
    annotations: set.annotations.map(toFront),
    body_boundary: boundary,
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
  const subject = set.email.subject?.replace(/[\r\n]+/g, " ").trim() || "(no subject)";
  const parts = [`---\n${yaml}\n---`, `# ${subject}`];
  if (set.emailNoteMd?.trim()) parts.push(noteText(set.emailNoteMd));
  for (const a of set.annotations) {
    if (!a.bodyMd.trim()) continue;
    parts.push(boundaryLine(boundary), `## “${headingQuote(quoteLabel(a) ?? "")}” <!-- tn:${a.id} -->\n\n${noteText(a.bodyMd)}`);
  }
  parts.push(boundaryLine(boundary));
  return `${parts.join("\n\n")}\n`;
}

export class FormatError extends Error {}

/**
 * Markdown file content -> AnnotationSet; FormatError for files that aren't ours. Strict by default (carriers: a damaged one stays
 * unread, D35). With `onProblem` (an import) a section that can't be placed doesn't fail the
 * file: its text becomes a note of its own and `onProblem` says what was wrong.
 */
export function fromMarkdown(text: string, options: { onProblem?: (message: string) => void } = {}): AnnotationSet {
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
  const version = Number(front.thundernotes);
  if (version > FORMAT_VERSION) throw new FormatError(`format version ${front.thundernotes} is newer than this add-on`);
  if (version !== FORMAT_VERSION) throw new FormatError(`unsupported format version ${front.thundernotes}; expected ${FORMAT_VERSION}`);
  if (!front.message_id) throw new FormatError("message_id missing");
  if (!Number.isSafeInteger(front.body_boundary) || front.body_boundary < 0) throw new FormatError("body_boundary must be a non-negative safe integer");
  if (front.annotations !== undefined && !Array.isArray(front.annotations)) throw new FormatError("annotations must be an array");
  const ids = new Set<string>();
  for (const [i, fa] of (front.annotations ?? []).entries()) {
    if (!fa || typeof fa.id !== "string" || !fa.id || /[\s>]/.test(fa.id) || fa.quote === undefined) throw new FormatError(`annotation ${i + 1}: valid id and quote required`);
    if (ids.has(fa.id)) throw new FormatError(`duplicate annotation id ${fa.id}`);
    ids.add(fa.id);
  }
  const { emailNote, notes, recovered } = readBody(source.slice(fm[0].length), front.body_boundary, ids, options.onProblem);

  const now = new Date().toISOString();
  const created = time(front.created, now);
  const email: EmailRef = { messageId: String(front.message_id) };
  if (front.subject !== undefined) email.subject = String(front.subject);
  if (front.from !== undefined) email.from = String(front.from);
  if (front.date !== undefined) email.date = time(front.date, "");
  if (front.folder_hint !== undefined) email.folderHint = String(front.folder_hint);
  if (front.account !== undefined) email.account = String(front.account);

  const annotations: Annotation[] = (front.annotations ?? []).map((fa) => fromFront(fa, notes.get(fa.id) ?? "", created));
  for (const r of recovered) {
    const like = r.like ? annotations.find((a) => a.id === r.like) : undefined;
    annotations.push({
      id: r.id,
      selectors: like ? like.selectors.map((s) => ({ ...s })) : [{ type: "TextQuoteSelector", exact: r.quote }],
      bodyMd: r.bodyMd,
      created,
      updated: time(front.updated, created),
      ...(like?.colour ? { colour: like.colour } : {}),
    });
  }

  const set: AnnotationSet = {
    version: 1,
    email,
    rev: Number(front.rev) || 0,
    created,
    updated: time(front.updated, created),
    annotations,
  };
  const emailNoteMd = emailNote;
  if (emailNoteMd) set.emailNoteMd = emailNoteMd;
  if (front.email_note_updated !== undefined) set.emailNoteUpdated = time(front.email_note_updated, created);
  if (front.email_note_colour) set.emailNoteColour = String(front.email_note_colour);
  if (front.email_note_colour_updated !== undefined) set.emailNoteColourUpdated = time(front.email_note_colour_updated, created);
  if (front.email_note_by) set.emailNoteBy = String(front.email_note_by);
  if (front.email_note_base) set.emailNoteBase = String(front.email_note_base);
  if (Array.isArray(front.email_note_bases) && front.email_note_bases.length) set.emailNoteBases = front.email_note_bases.map(String);
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

// ---- file names (D5) -------------------------------------------------------------------

/** FNV-1a, 32 bit, as 8 hex characters: short, stable, no crypto needed. */
export function hash8(text: string): string {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const TRANSLITERATE: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", æ: "ae", ø: "oe", å: "aa" };

export function slug(text: string, max = 50): string {
  const ascii = text
    .toLowerCase()
    .replace(/[äöüßæøå]/g, (c) => TRANSLITERATE[c]!)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^(?:re|aw|fwd?|wg)\s*:\s*/g, "");
  const s = ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s.slice(0, max).replace(/-+$/, "") || "no-subject");
}

/** `YYYY/MM/YYYY-MM-DD_subject-slug_<hash8>.md`, dated by the email (else the set). */
export function fileName(set: AnnotationSet): string {
  const date = new Date(set.email.date || set.created);
  const valid = !Number.isNaN(date.getTime()) ? date : new Date(set.created);
  const y = String(valid.getUTCFullYear());
  const m = String(valid.getUTCMonth() + 1).padStart(2, "0");
  const d = String(valid.getUTCDate()).padStart(2, "0");
  // With the account (D42): the same email's notes in two accounts are two files.
  const id = set.email.account ? `${set.email.messageId}\n${set.email.account}` : set.email.messageId;
  return `${y}/${m}/${y}-${m}-${d}_${slug(set.email.subject ?? "")}_${hash8(id)}.md`;
}

// ---- merge ------------------------------------------------------------------------------

export interface MergeResult {
  set: AnnotationSet;
  /** Annotations taken from `incoming` (new or newer). */
  added: number;
  updated: number;
  /** Notes whose text now holds a conflict box (D32). */
  conflicts: number;
}

/** Content that matters, ignoring timestamps and merge bookkeeping. */
function sameContent(a: Annotation, b: Annotation): boolean {
  return (
    a.bodyMd === b.bodyMd &&
    a.colour === b.colour &&
    JSON.stringify(a.selectors) === JSON.stringify(b.selectors) &&
    JSON.stringify(a.tags ?? []) === JSON.stringify(b.tags ?? [])
  );
}

/** Tombstones without the copies purged (deleted up to `purgedBefore`). */
function withoutPurged(tombstones: Tombstone[], purgedBefore: string | undefined): Tombstone[] {
  if (!purgedBefore) return tombstones;
  return tombstones.map((t) => (t.annotation && t.deleted <= purgedBefore ? { id: t.id, deleted: t.deleted } : t));
}

/** Union of tombstones by id, keeping the latest deletion time (and a copy if either has one). */
function mergeTombstones(a: Tombstone[] = [], b: Tombstone[] = []): Tombstone[] {
  const byId = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    const known = byId.get(t.id);
    if (!known) byId.set(t.id, t);
    else {
      const later = t.deleted > known.deleted ? t : known;
      const copy = later.annotation ?? (t.deleted > known.deleted ? known : t).annotation;
      byId.set(t.id, copy ? { ...later, annotation: copy } : later);
    }
  }
  return [...byId.values()];
}

/**
 * Card folding (D30): the newer choice per id wins; entries of deleted annotations go.
 * Undefined when nothing is left.
 */
function mergeFolded(
  a: Record<string, FoldState> = {},
  b: Record<string, FoldState> = {},
  deleted: Map<string, string>
): Record<string, FoldState> | undefined {
  const out: Record<string, FoldState> = {};
  for (const [id, f] of [...Object.entries(a), ...Object.entries(b)]) {
    if (deleted.has(id)) continue;
    const known = out[id];
    if (!known || f.at > known.at) out[id] = f;
  }
  return Object.keys(out).length ? out : undefined;
}

const HISTORY = 10;

/** Adds texts to a note's sync history (newest last, no repeats, at most HISTORY). */
function remember(history: Record<string, string[]>, key: string, text: string): void {
  const list = (history[key] ?? []).filter((t) => t !== text);
  list.push(text);
  history[key] = list.slice(-HISTORY);
}

/** "sync": between devices (conflict box when no base is known); "import": files (newer wins). */
export type MergeMode = "sync" | "import";

interface NoteText {
  text: string;
  at: string;
  by?: string;
}

/**
 * A note's text from two versions (D32): a three-way merge against a base the incoming version
 * names: the newest of its bases (its writer's synced texts, newest first) that this device has
 * too, its current text or its sync history; the most recent version both have seen. Without a known base: on import,
 * equal times with different text mean a file edited by hand (editors don't touch the
 * timestamps), which wins and is stamped `now`; an incoming text we already synced is stale.
 * With no base found: in sync, lines both have are kept and the rest becomes a conflict box
 * (nothing is lost; also with equal times, which in sync mean two edits, not a hand-edited file,
 * design review, issue #1); on import (a backup or an edited file) the newer text wins (D25).
 */
function mergeNoteText(
  history: string[],
  mine: NoteText,
  theirs: NoteText & { bases: string[] },
  now: string,
  mode: MergeMode
): NoteText & { conflict: boolean } {
  const newer = theirs.at > mine.at ? theirs : mine;
  if (mine.text === theirs.text) return { ...newer, text: mine.text, conflict: false };
  let base: string | undefined;
  for (const h of theirs.bases) {
    base = hash8(mine.text) === h ? mine.text : history.find((t) => hash8(t) === h);
    if (base !== undefined) break;
  }
  if (base === undefined && mine.at === theirs.at && mode === "import") return { text: theirs.text, at: now, by: theirs.by, conflict: false };
  if (base === undefined && history.includes(theirs.text)) return { ...mine, conflict: false };
  if (base === undefined && mode === "import") return { ...newer, conflict: false };
  const merged = mergeText(base, mine, theirs);
  if (merged.text === mine.text) return { ...mine, conflict: false };
  if (merged.text === theirs.text) return { ...theirs, conflict: false };
  return { text: merged.text, at: newer.at, by: newer.by, conflict: merged.conflict };
}

/** Equal times in sync: the same choice on every device whichever side is "theirs" (the greater value). */
const tieBreak = (theirs: string | undefined, mine: string | undefined) => (theirs ?? "") > (mine ?? "");

/** The bases a version names, newest first (older writers name only the newest). */
const basesOf = (bases: string[] | undefined, base: string | undefined) => (bases?.length ? bases : base ? [base] : []);

/** Max of ISO timestamps. */
const latest = (...times: (string | undefined)[]) => times.filter((t): t is string => !!t).reduce((m, t) => (t > m ? t : m), "");

/** One annotation present on both sides: each part decided on its own (D32). */
function mergeAnnotation(
  mine: Annotation,
  theirs: Annotation,
  history: string[],
  now: string,
  mode: MergeMode
): { a: Annotation; conflict: boolean } {
  const text = mergeNoteText(
    history,
    { text: mine.bodyMd, at: mine.textUpdated ?? mine.updated, by: mine.textBy },
    { text: theirs.bodyMd, at: theirs.textUpdated ?? theirs.updated, by: theirs.textBy, bases: basesOf(theirs.textBases, theirs.textBase) },
    now,
    mode
  );
  const mineColourAt = mine.colourUpdated ?? mine.updated;
  const theirColourAt = theirs.colourUpdated ?? theirs.updated;
  // Equal times, different colour: on import a file edited by hand, which wins (stamped now);
  // in sync two choices at the same moment, decided the same way on every device.
  const takeColour =
    theirColourAt > mineColourAt || (theirColourAt === mineColourAt && theirs.colour !== mine.colour && (mode === "import" || tieBreak(theirs.colour, mine.colour)));
  const colourAt = takeColour && theirColourAt === mineColourAt && mode === "import" ? now : latest(mineColourAt, theirColourAt);
  const a: Annotation = {
    ...mine,
    bodyMd: text.text,
    textUpdated: text.at,
    selectors: theirs.updated > mine.updated ? theirs.selectors : mine.selectors,
    tags: theirs.updated > mine.updated ? theirs.tags : mine.tags,
    colourUpdated: colourAt,
    created: theirs.created < mine.created ? theirs.created : mine.created,
  };
  if (!a.tags) delete a.tags;
  const colour = takeColour ? theirs.colour : mine.colour;
  if (colour) a.colour = colour;
  else delete a.colour;
  if (text.by) a.textBy = text.by;
  else delete a.textBy;
  delete a.textBase;
  delete a.textBases;
  a.updated = latest(mine.updated, theirs.updated, a.textUpdated, a.colourUpdated);
  return { a, conflict: text.conflict };
}

/**
 * Merges two versions of the same email's set (import, IMAP sync): union of annotations by
 * id; per annotation, text, colour and tags are decided separately (D32): text by a
 * three-way merge (mergeNoteText), colour by its own timestamp. Tombstones delete
 * annotations not updated after the deletion. The whole-email note follows the same rules
 * as an annotation's text and colour. `local.syncHistory` gains the incoming texts.
 */
export function mergeSets(
  local: AnnotationSet,
  incoming: AnnotationSet,
  now = new Date().toISOString(),
  mode: MergeMode = "import"
): MergeResult {
  const byId = new Map(local.annotations.map((a) => [a.id, a]));
  const history: Record<string, string[]> = structuredClone(local.syncHistory ?? {});
  let added = 0;
  let updated = 0;
  let conflicts = 0;
  // Purged copies stay gone whichever side still has them (the later purge counts).
  const purgedBefore = [local.purgedBefore, incoming.purgedBefore].filter((p): p is string => !!p).sort().at(-1);
  const tombstones = withoutPurged(mergeTombstones(local.tombstones, incoming.tombstones), purgedBefore);
  const deletedAt = new Map(tombstones.map((t) => [t.id, t.deleted]));

  for (const a of incoming.annotations) {
    const mine = byId.get(a.id);
    const deleted = deletedAt.get(a.id);
    if (deleted !== undefined && a.updated <= deleted) continue;
    if (!mine) {
      const fresh = { ...a };
      delete fresh.textBase;
      delete fresh.textBases;
      byId.set(a.id, fresh);
      added++;
    } else {
      const merged = mergeAnnotation(mine, a, history[a.id] ?? [], now, mode);
      if (merged.conflict) conflicts++;
      if (!sameContent(merged.a, mine)) updated++;
      byId.set(a.id, merged.a);
    }
    remember(history, a.id, a.bodyMd);
  }
  let removed = 0;
  for (const [id, a] of byId) {
    const deleted = deletedAt.get(id);
    if (deleted !== undefined && a.updated <= deleted) {
      byId.delete(id);
      delete history[id];
      removed++;
    }
  }

  // Whole-email note. Writers always set emailNoteUpdated now. If only one side has it, the
  // other hasn't changed its note since: count it as old. If neither has it (older data), use `updated`.
  const oneSided = !local.emailNoteUpdated !== !incoming.emailNoteUpdated;
  const localNoteAt = local.emailNoteUpdated ?? (oneSided ? local.created : local.updated);
  const incomingNoteAt = incoming.emailNoteUpdated ?? (oneSided ? incoming.created : incoming.updated);
  const note = mergeNoteText(
    history[EMAIL_NOTE_KEY] ?? [],
    { text: local.emailNoteMd ?? "", at: localNoteAt, by: local.emailNoteBy },
    { text: incoming.emailNoteMd ?? "", at: incomingNoteAt, by: incoming.emailNoteBy, bases: basesOf(incoming.emailNoteBases, incoming.emailNoteBase) },
    now,
    mode
  );
  if (note.conflict) conflicts++;
  const noteChanged = note.text !== (local.emailNoteMd ?? "");
  if (noteChanged) updated++;
  if (incoming.emailNoteMd !== undefined || incoming.emailNoteUpdated) remember(history, EMAIL_NOTE_KEY, incoming.emailNoteMd ?? "");
  const localColourAt = local.emailNoteColourUpdated ?? localNoteAt;
  const incomingColourAt = incoming.emailNoteColourUpdated ?? incomingNoteAt;
  const takeColour =
    (incoming.emailNoteColour ?? "") !== (local.emailNoteColour ?? "") &&
    (incomingColourAt > localColourAt || (incomingColourAt === localColourAt && (mode === "import" || tieBreak(incoming.emailNoteColour, local.emailNoteColour))));
  if (takeColour) updated++;

  const newTombstones = tombstones.length !== (local.tombstones?.length ?? 0) || removed > 0;
  const folded = mergeFolded(local.folded, incoming.folded, deletedAt);
  const foldChanged = JSON.stringify(folded ?? {}) !== JSON.stringify(local.folded ?? {});
  const purgeChanged = (purgedBefore ?? "") !== (local.purgedBefore ?? "");
  const changed = added + updated + removed > 0 || newTombstones || foldChanged || purgeChanged;

  const set: AnnotationSet = {
    ...local,
    email: { ...incoming.email, ...local.email },
    annotations: [...byId.values()],
    rev: Math.max(local.rev, incoming.rev) + (changed ? 1 : 0),
    updated: changed ? now : local.updated,
    created: incoming.created < local.created ? incoming.created : local.created,
    syncHistory: history,
  };
  if (note.text) set.emailNoteMd = note.text;
  else delete set.emailNoteMd;
  if (noteChanged || note.at !== localNoteAt) set.emailNoteUpdated = note.at;
  else if (local.emailNoteUpdated) set.emailNoteUpdated = local.emailNoteUpdated;
  if (note.by) set.emailNoteBy = note.by;
  else delete set.emailNoteBy;
  delete set.emailNoteBase;
  delete set.emailNoteBases;
  const emailNoteColour = takeColour ? incoming.emailNoteColour : local.emailNoteColour;
  if (emailNoteColour) set.emailNoteColour = emailNoteColour;
  else delete set.emailNoteColour;
  const colourAt = takeColour ? incoming.emailNoteColourUpdated : local.emailNoteColourUpdated;
  if (colourAt) set.emailNoteColourUpdated = colourAt;
  else delete set.emailNoteColourUpdated;
  if (tombstones.length) set.tombstones = tombstones;
  else delete set.tombstones;
  const den = [local.deletedEmailNote, incoming.deletedEmailNote].filter((d) => !!d).sort((x, y) => (x!.deleted < y!.deleted ? 1 : -1))[0];
  // Purged: the copy goes, the record of the deletion stays.
  if (den) set.deletedEmailNote = purgedBefore && den.deleted <= purgedBefore ? { deleted: den.deleted } : den;
  else delete set.deletedEmailNote;
  if (purgedBefore) set.purgedBefore = purgedBefore;
  else delete set.purgedBefore;
  if (folded) set.folded = folded;
  else delete set.folded;
  return { set, added, updated: updated + removed, conflicts };
}

/**
 * Before a set is written to a carrier: each note names the synced text it was edited from
 * (`textBase`, the newest in this device's sync history), so the receiver can merge
 * three-way (D32). Returns a copy; the history itself is updated after the upload
 * (`rememberSynced`).
 */
export function withBases(set: AnnotationSet): AnnotationSet {
  const history = set.syncHistory ?? {};
  // Every synced text remembered, newest first: the receiver takes the newest it has too.
  const bases = (key: string) => [...new Set((history[key] ?? []).map(hash8))].reverse();
  const out: AnnotationSet = {
    ...set,
    annotations: set.annotations.map((a) => {
      const b = bases(a.id);
      const copy = { ...a };
      if (b.length) (copy.textBase = b[0]!), (copy.textBases = b);
      else delete copy.textBase, delete copy.textBases;
      return copy;
    }),
  };
  const emailBases = bases(EMAIL_NOTE_KEY);
  if (emailBases.length) (out.emailNoteBase = emailBases[0]!), (out.emailNoteBases = emailBases);
  else delete out.emailNoteBase, delete out.emailNoteBases;
  delete out.syncHistory;
  return out;
}

/** After an upload: the uploaded texts are now synced, so they become possible bases. */
export function rememberSynced(set: AnnotationSet, uploaded: AnnotationSet): AnnotationSet {
  const history: Record<string, string[]> = structuredClone(set.syncHistory ?? {});
  for (const a of uploaded.annotations) remember(history, a.id, a.bodyMd);
  remember(history, EMAIL_NOTE_KEY, uploaded.emailNoteMd ?? "");
  const ids = new Set([...set.annotations.map((a) => a.id), EMAIL_NOTE_KEY]);
  for (const key of Object.keys(history)) if (!ids.has(key)) delete history[key];
  return { ...set, syncHistory: history };
}

/** Deleted notes stay restorable this long (D33): the copy in the tombstone, then it goes (D7). */
export const TOMBSTONE_DAYS = 30;
/** The bare record of a deletion stays this long (design review, issue #1), then it goes too. */
export const DELETION_RECORD_DAYS = 365;

/**
 * Ages deletion records: copies older than TOMBSTONE_DAYS are dropped (no longer restorable),
 * the records themselves after DELETION_RECORD_DAYS. Returns the same object if nothing changed.
 */
export function gcTombstones(set: AnnotationSet, now = new Date().toISOString()): AnnotationSet {
  const ago = (days: number) => new Date(Date.parse(now) - days * 86_400_000).toISOString();
  const copyCutoff = ago(TOMBSTONE_DAYS);
  const recordCutoff = ago(DELETION_RECORD_DAYS);
  if (!set.tombstones?.length && !set.deletedEmailNote) return set;
  let changed = false;
  const tombstones = (set.tombstones ?? []).flatMap((t): Tombstone[] => {
    if (t.deleted <= recordCutoff) return (changed = true), [];
    if (t.annotation && t.deleted <= copyCutoff) return (changed = true), [{ id: t.id, deleted: t.deleted }];
    return [t];
  });
  let den = set.deletedEmailNote;
  if (den && den.deleted <= recordCutoff) (den = undefined), (changed = true);
  else if (den && den.md !== undefined && den.deleted <= copyCutoff) (den = { deleted: den.deleted }), (changed = true);
  if (!changed) return set;
  const next: AnnotationSet = { ...set, tombstones };
  if (!tombstones.length) delete next.tombstones;
  if (den) next.deletedEmailNote = den;
  else delete next.deletedEmailNote;
  return next;
}

/** Removes an annotation and leaves a tombstone, so the deletion syncs. */
export function deleteAnnotation(set: AnnotationSet, id: string, now = new Date().toISOString()): AnnotationSet {
  const { [id]: _gone, ...folded } = set.folded ?? {};
  const gone = set.annotations.find((a) => a.id === id);
  const copy = gone && { ...gone };
  if (copy) delete copy.textBase, delete copy.textBases;
  const next: AnnotationSet = {
    ...set,
    annotations: set.annotations.filter((a) => a.id !== id),
    tombstones: mergeTombstones(set.tombstones, [{ id, deleted: now, ...(copy && { annotation: copy }) }]),
    rev: set.rev + 1,
    updated: now,
  };
  if (Object.keys(folded).length) next.folded = folded;
  else delete next.folded;
  return next;
}
