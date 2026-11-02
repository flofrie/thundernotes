/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The notes overview (D48): every note of every email as one flat list, the newest change first,
// with search (the task view's filter expressions, D38) and filters by account and colour. Kept
// apart from the page (notes.ts) so it can be tested.

import { colourOf, quoteLabel, type AnnotationSet } from "@thundernotes/core";
import { matchesFilter, parseFilter } from "./filter-expr.js";
import { EMAIL_NOTE_ID } from "./protocol.js";
import { emailInfoOf } from "./task-list.js";

export interface NoteEntry {
  accountId?: string;
  messageId: string;
  /** The annotation's id, or EMAIL_NOTE_ID for the note on the whole email. */
  noteId: string;
  md: string;
  /** What it is on: the quoted passage ("🖼 …" for a picture); undefined for the whole email. */
  quote?: string;
  /** Palette colour name (yellow when none was chosen, D29). */
  colour: string;
  /** When its text (or, for a plain highlight, the highlight) last changed: the list's order. */
  changed: string;
  subject: string;
  sender: string;
  senderAddress: string;
  emailDate?: string;
}

/** Every note in `sets` (plain highlights too: they are notes with no text, D24), newest change first. */
export function collectNotes(sets: AnnotationSet[]): NoteEntry[] {
  const out: NoteEntry[] = [];
  for (const set of sets) {
    const info = emailInfoOf(set.email);
    const email = { accountId: set.email.accountId, messageId: set.email.messageId, subject: info.subject, sender: info.name, senderAddress: info.address, emailDate: info.date };
    if (set.emailNoteMd?.trim()) {
      out.push({ ...email, noteId: EMAIL_NOTE_ID, md: set.emailNoteMd, colour: colourOf(set.emailNoteColour).name, changed: set.emailNoteUpdated ?? set.updated });
    }
    for (const a of set.annotations) {
      out.push({ ...email, noteId: a.id, md: a.bodyMd, quote: quoteLabel(a), colour: colourOf(a.colour).name, changed: a.textUpdated ?? a.updated });
    }
  }
  return out.sort((x, y) => (x.changed < y.changed ? 1 : x.changed > y.changed ? -1 : 0));
}

export interface NoteFilter {
  /** Words, "phrases", -exclusions, or, (groups), /regex/ (filter-expr.ts), over the note, its passage, the email's subject and sender. */
  text: string;
  /** Thunderbird's account id; null: all accounts. */
  account: string | null;
  /** Palette colour names; empty: all colours. */
  colours: string[];
  /** Also highlights without a note. */
  highlights: boolean;
}

/** What a note's search sees: its text, its passage, the email's subject and sender. */
export function searchText(n: NoteEntry): string {
  return [n.md, n.quote ?? "", n.subject, n.sender, n.senderAddress].join("\n");
}

/** The notes `filter` lets through, in their order. */
export function filterNotes(notes: NoteEntry[], filter: NoteFilter): NoteEntry[] {
  const expr = parseFilter(filter.text);
  return notes.filter(
    (n) =>
      (filter.highlights || n.md.trim() !== "") &&
      (filter.account === null || (n.accountId ?? "") === filter.account) &&
      (!filter.colours.length || filter.colours.includes(n.colour)) &&
      matchesFilter(expr, searchText(n).toLowerCase())
  );
}

/** When a note changed, briefly: "just now", "5 min ago", "3 h ago", "yesterday", else the date. */
export function changedLabel(iso: string, now = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(then)) / 86_400_000);
  if (days === 0) return `${Math.floor(minutes / 60)} h ago`;
  if (days === 1) return "yesterday";
  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}
