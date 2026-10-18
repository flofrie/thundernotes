/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The task view's list (D38): every checklist item in all notes, grouped by due date. Kept
// apart from the page so it can be tested without a browser.

import { codeLines, formatDue, isValidDate, isoDate, preferredSpellings, senderName, tasksIn, type AnnotationSet, type TaskItem, type TextQuoteSelector } from "@thundernotes/core";
import { EMAIL_NOTE_ID } from "./protocol.js";
import { matchesFilter, parseFilter } from "./filter-expr.js";

export interface TaskEntry extends TaskItem {
  /** The account the note is in (D42; Thunderbird's local id). */
  accountId?: string;
  messageId: string;
  /** The note it is in: an annotation's id, or EMAIL_NOTE_ID. */
  noteId: string;
  /** The highlighted passage the note belongs to (none for the whole-email note). */
  quote?: string;
  /** The whole note the task is in (shown when the task is expanded). */
  noteMd: string;
  subject: string;
  sender: string;
  /** The sender's address (also when the name is shown), for telling people apart and filtering. */
  senderAddress: string;
  emailDate?: string;
  /** The earliest date in an open task (the one that matters first). */
  due?: string;
  /** Its parent task's key (taskKey), when it is a sub-task. */
  parentKey?: string;
  /** What it is part of: the parent task's or bullet's text. */
  partOf?: string;
  /** Its sub-tasks' keys, in note order (direct ones only). */
  children: string[];
  /** How many of them are done. */
  childrenDone: number;
}

export type GroupKey = "overdue" | "today" | "week" | "later" | "none" | "done";

export const GROUP_TITLES: Record<GroupKey, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "Next 7 days",
  later: "Later",
  none: "No date",
  done: "Done",
};

/** A task's identity across redraws (its email, note and line). */
export const taskKey = (t: TaskEntry) => `${t.accountId ?? ""}|${t.messageId}|${t.noteId}|${t.line}`;

/** "Anna <anna@x.example>" → "anna@x.example"; a bare address as it is. */
export function addressOf(from: string | undefined): string {
  if (!from) return "";
  return (/<([^>]+)>/.exec(from)?.[1] ?? from).trim();
}

/** All checklist items of all notes, except empty ones ("- [ ]" just started, or left by Enter). */
export function collectTasks(sets: AnnotationSet[]): TaskEntry[] {
  const out: TaskEntry[] = [];
  for (const set of sets) {
    const info = emailInfoOf(set.email);
    const email = { accountId: set.email.accountId, messageId: set.email.messageId, subject: info.subject, sender: info.name, senderAddress: info.address, emailDate: info.date };
    const notes: { noteId: string; md: string; quote?: string }[] = [
      { noteId: EMAIL_NOTE_ID, md: set.emailNoteMd ?? "" },
      ...set.annotations.map((a) => ({
        noteId: a.id,
        md: a.bodyMd,
        quote: a.selectors.find((s): s is TextQuoteSelector => s.type === "TextQuoteSelector")?.exact,
      })),
    ];
    for (const note of notes) {
      const inNote: TaskEntry[] = [];
      for (const task of tasksIn(note.md)) {
        if (!task.text) continue;
        inNote.push({ ...task, ...email, noteId: note.noteId, quote: note.quote, noteMd: note.md, due: task.done ? undefined : task.dates[0], children: [], childrenDone: 0 });
      }
      // Sub-tasks (D38): a task indented under another is its sub-task; under a plain bullet, the
      // bullet's text says what it is part of.
      const byLine = new Map(inNote.map((t) => [t.line, t]));
      for (const t of inNote) {
        if (!t.parent?.text) continue;
        t.partOf = t.parent.text;
        const parent = t.parent.task ? byLine.get(t.parent.line) : undefined;
        if (!parent) continue;
        t.parentKey = taskKey(parent);
        parent.children.push(taskKey(t));
        if (t.done) parent.childrenDone++;
      }
      out.push(...inNote);
    }
  }
  return out;
}

export function groupOf(task: TaskEntry, today = new Date()): GroupKey {
  if (task.done) return "done";
  if (!task.due) return "none";
  const now = isoDate(today);
  if (task.due < now) return "overdue";
  if (task.due === now) return "today";
  const week = isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));
  return task.due <= week ? "week" : "later";
}

export interface Filter {
  /** Labels to include (lower case): a task needs all of them, or one with `anyLabel`. */
  labels: string[];
  /** Labels to exclude: a task with any of them is hidden. */
  exclude?: string[];
  anyLabel?: boolean;
  /** Order of the Done group (default: finished, newest first). */
  doneSort?: DoneSort;
  /** How open tasks are grouped (default: by due date). */
  groupBy?: GroupBy;
  /** Done tasks (when shown) in the label or email sections, after the open ones; else in their own group. */
  doneInline?: boolean;
  /** The labels in their chosen order (D40): a task's first label and the Done "label" sort follow it. */
  labelOrder?: string[];
  /** Words in the task, the email's subject or sender. */
  text: string;
  showDone: boolean;
}

/** Whether the end of the text is inside an unclosed quote. */
export function inQuote(text: string): boolean {
  return ((text.match(/["“”„]/g) ?? []).length & 1) === 1;
}

export function matches(task: TaskEntry, filter: Filter): boolean {
  if (task.done && !filter.showDone) return false;
  const own = task.labels.map((l) => l.toLowerCase());
  if ((filter.exclude ?? []).some((l) => own.includes(l))) return false;
  const has = (l: string) => own.includes(l);
  if (filter.labels.length && !(filter.anyLabel ? filter.labels.some(has) : filter.labels.every(has))) return false;
  // Words, "phrases", -exclusions, OR and brackets (filter-expr.ts).
  const haystack = `${task.text} ${task.subject} ${task.sender} ${task.senderAddress} ${task.quote ?? ""}`.toLowerCase();
  return matchesFilter(parseFilter(filter.text), haystack);
}

const newestFirst = (a: TaskEntry, b: TaskEntry) => (b.emailDate ?? "").localeCompare(a.emailDate ?? "");

/** Orders for the Done group: by when finished, by due date, by label. */
export type DoneSort = "finished-desc" | "finished-asc" | "due-asc" | "due-desc" | "label";

/** Missing values (no finished date, no due date, no label) always last. */
function lastIfMissing(a: string | undefined, b: string | undefined, descending: boolean): number {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  return descending ? b.localeCompare(a) : a.localeCompare(b);
}

function doneOrder(sort: DoneSort, labelOrder: string[] = []): (a: TaskEntry, b: TaskEntry) => number {
  // A task's first label in the labels' order (unknown ones after, alphabetically); as a sortable key.
  const rank = (l: string) => {
    const i = labelOrder.indexOf(l);
    return i < 0 ? `1${l}` : `0${String(i).padStart(5, "0")}`;
  };
  const firstLabel = (t: TaskEntry) => t.labels.map((l) => rank(l.toLowerCase())).sort()[0];
  const by: Record<DoneSort, (a: TaskEntry, b: TaskEntry) => number> = {
    "finished-desc": (a, b) => lastIfMissing(a.doneOn, b.doneOn, true),
    "finished-asc": (a, b) => lastIfMissing(a.doneOn, b.doneOn, false),
    "due-asc": (a, b) => lastIfMissing(a.dates[0], b.dates[0], false),
    "due-desc": (a, b) => lastIfMissing(a.dates[0], b.dates[0], true),
    label: (a, b) => lastIfMissing(firstLabel(a), firstLabel(b), false),
  };
  // Then the most recently finished, then newest email first, as in the other groups.
  return (a, b) => by[sort](a, b) || lastIfMissing(a.doneOn, b.doneOn, true) || newestFirst(a, b) || a.line - b.line;
}

/**
 * The due-date groups, in order, each sorted: by due date, else newest email first; "No date"
 * oldest email first (waiting longest: where tasks are most easily forgotten). Empty groups left out.
 */
export function groupTasks(tasks: TaskEntry[], filter: Filter, today = new Date()): { key: GroupKey; tasks: TaskEntry[] }[] {
  const groups = new Map<GroupKey, TaskEntry[]>((Object.keys(GROUP_TITLES) as GroupKey[]).map((k) => [k, []]));
  for (const task of tasks) if (matches(task, filter)) groups.get(groupOf(task, today))!.push(task);
  return [...groups.entries()]
    .filter(([, list]) => list.length)
    .map(([key, list]) => ({
      key,
      tasks: list.sort(
        key === "done"
          ? doneOrder(filter.doneSort ?? "finished-desc", filter.labelOrder)
          : key === "none"
            ? (a, b) => -newestFirst(a, b) || a.line - b.line
            : (a, b) => (a.due && b.due ? a.due.localeCompare(b.due) : 0) || newestFirst(a, b) || a.line - b.line
      ),
    }));
}

/** Open tasks grouped by due date (the default), label or email (D38); done ones always in their own group last. */
export type GroupBy = "due" | "label" | "email";

export interface Section {
  id: string;
  title: string;
  /** A due-date group, or a section of one label or one email. */
  kind: GroupKey | "label" | "email";
  /** Label sections: the label (none for "No label"). */
  label?: string;
  /** Email sections: the email. */
  email?: { accountId?: string; messageId: string; sender: string; senderAddress: string; date?: string };
  tasks: TaskEntry[];
}

/**
 * The sections to show. By label: one per label in `labelOrder` (the chips' order), a task with
 * two labels in both, "No label" last; by due date inside. By email: newest email first, its
 * tasks in the order they are written, done ones shown inline too (sub-tasks stay under parents).
 */
export function sections(tasks: TaskEntry[], filter: Filter, labelOrder: string[], today = new Date()): Section[] {
  const groups = groupTasks(tasks, filter, today);
  const by = filter.groupBy ?? "due";
  if (by === "due") return groups.map((g) => ({ id: g.key, title: GROUP_TITLES[g.key], kind: g.key, tasks: g.tasks }));
  const open = groups.filter((g) => g.key !== "done").flatMap((g) => g.tasks);
  const done = groups.find((g) => g.key === "done");
  // Inline: each section's done tasks after its open ones, in the Done group's order.
  const inline = filter.doneInline ? (done?.tasks ?? []) : [];
  const withDone = (list: TaskEntry[], belongs: (t: TaskEntry) => boolean) => [...list, ...inline.filter(belongs)];
  const out: Section[] = [];
  if (by === "label") {
    const byDue = (a: TaskEntry, b: TaskEntry) => lastIfMissing(a.due, b.due, false) || newestFirst(a, b) || a.line - b.line;
    const has = (t: TaskEntry, label: string) => t.labels.some((l) => l.toLowerCase() === label);
    const spelling = labelSpellings(tasks);
    for (const label of labelOrder) {
      const list = withDone(open.filter((t) => has(t, label)).sort(byDue), (t) => has(t, label));
      if (list.length) out.push({ id: `label:${label}`, title: `#${spelling.get(label) ?? label}`, kind: "label", label, tasks: list });
    }
    const none = withDone(open.filter((t) => !t.labels.length).sort(byDue), (t) => !t.labels.length);
    if (none.length) out.push({ id: "label:", title: "No label", kind: "label", tasks: none });
  } else {
    const emails = new Map<string, TaskEntry[]>();
    // One section per email in an account (D42): the same email in two accounts has notes of its own.
    for (const t of [...open, ...inline]) {
      const key = `${t.accountId ?? ""}|${t.messageId}`;
      emails.set(key, [...(emails.get(key) ?? []), t]);
    }
    const written = (a: TaskEntry, b: TaskEntry) =>
      (a.noteId === b.noteId ? 0 : a.noteId === EMAIL_NOTE_ID ? -1 : b.noteId === EMAIL_NOTE_ID ? 1 : a.noteId.localeCompare(b.noteId)) || a.line - b.line;
    for (const list of [...emails.values()].sort((a, b) => newestFirst(a[0]!, b[0]!))) {
      const first = list[0]!;
      out.push({
        id: `email:${first.accountId ?? ""}|${first.messageId}`,
        title: first.subject,
        kind: "email",
        email: { accountId: first.accountId, messageId: first.messageId, sender: first.sender, senderAddress: first.senderAddress, date: first.emailDate },
        // Done ones inline in the order written too, so sub-tasks stay under their parents.
        tasks: list.sort(written),
      });
    }
  }
  if (done && !filter.doneInline) out.push({ id: "done", title: GROUP_TITLES.done, kind: "done", tasks: done.tasks });
  return out;
}

/**
 * Labels of the tasks in view (open ones, and done ones when shown) with how many of those
 * tasks have each. Ordered by open tasks, most first, the same number alphabetically, whether
 * done ones are shown or not (switching doesn't move the chips); labels only on done tasks come
 * last, alphabetically.
 */
/** Each label's spelling to show and write (the most used of all tasks; by lower case). */
export function labelSpellings(tasks: TaskEntry[]): Map<string, string> {
  return preferredSpellings(tasks.flatMap((t) => t.labels));
}

export function labelCounts(tasks: TaskEntry[], showDone: boolean): { label: string; count: number; display: string }[] {
  const open = new Map<string, number>();
  const done = new Map<string, number>();
  for (const task of tasks) {
    const into = task.done ? done : open;
    for (const l of new Set(task.labels.map((x) => x.toLowerCase()))) into.set(l, (into.get(l) ?? 0) + 1);
  }
  const o = (l: string) => open.get(l) ?? 0;
  const d = (l: string) => done.get(l) ?? 0;
  const labels = [...new Set([...open.keys(), ...(showDone ? done.keys() : [])])];
  const spelling = labelSpellings(tasks);
  return labels
    .sort((a, b) => o(b) - o(a) || a.localeCompare(b))
    .map((label) => ({ label, count: o(label) + (showDone ? d(label) : 0), display: spelling.get(label) ?? label }));
}

export function labelsOf(tasks: TaskEntry[], showDone: boolean): string[] {
  return labelCounts(tasks, showDone).map((l) => l.label);
}

/** The "#word" being typed at the end of the filter text (its word, lower case), or null. */
export function typedLabel(text: string): string | null {
  const m = /(?:^|\s)#([\p{L}\p{N}_/-]*)$/u.exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * A date as a filter word (D38): `@2026`, `@2026-10` or `@2026-10-24`, matched as text like any
 * other word (so `@2026-10` finds every date in October). Null for other words.
 */
export function dateFilterWord(word: string): { word: string; year: number; month?: number; day?: number } | null {
  const m = /^@(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(word);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : undefined;
  const day = m[3] ? Number(m[3]) : undefined;
  if (month !== undefined && (month < 1 || month > 12)) return null;
  if (day !== undefined && !isValidDate(word.slice(1))) return null;
  return { word, year, month, day };
}

/**
 * How a date filter word shows: "@Fri 24 Oct 2026", "@Oct 2026", "@2026". Always with the year
 * (whatever the setting for dates): "@Oct" alone could be read as every October.
 */
export function dateFilterLabel(word: string): string {
  const d = dateFilterWord(word);
  if (!d) return word;
  if (d.day !== undefined) return `@${formatDue(word.slice(1), new Date(d.year + 1, 0, 1))}`; // a "today" in another year: with the year
  if (d.month !== undefined) {
    const name = new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(d.year, d.month - 1, 1)).replace(/\.$/, "");
    return `@${name} ${d.year}`;
  }
  return `@${d.year}`;
}

// Month names after "@" in the filter (D38), English and German, full or short.
const MONTHS: [number, string[]][] = [
  [1, ["january", "jan", "januar"]],
  [2, ["february", "feb", "februar"]],
  [3, ["march", "mar", "märz", "maerz", "marz", "mär"]],
  [4, ["april", "apr"]],
  [5, ["may", "mai"]],
  [6, ["june", "jun", "juni"]],
  [7, ["july", "jul", "juli"]],
  [8, ["august", "aug"]],
  [9, ["september", "sep", "sept"]],
  [10, ["october", "oct", "oktober", "okt"]],
  [11, ["november", "nov"]],
  [12, ["december", "dec", "dezember", "dez"]],
];

/**
 * Months whose name starts with what is typed, as filter words of the current year (a filter
 * looks back as much as ahead: not the next such month), e.g. "jan" → "@2026-01".
 */
export function monthWords(typed: string, today = new Date()): string[] {
  const t = typed.toLowerCase();
  if (!t || /\d/.test(t)) return [];
  return MONTHS.filter(([, names]) => names.some((n) => n.startsWith(t))).map(([m]) => `@${today.getFullYear()}-${String(m).padStart(2, "0")}`);
}

/** A month name typed in full (or its usual short form), as a filter word of the current year. */
export function monthWord(typed: string, today = new Date()): string | null {
  const t = typed.toLowerCase();
  const hit = MONTHS.find(([, names]) => names.includes(t));
  return hit ? `@${today.getFullYear()}-${String(hit[0]).padStart(2, "0")}` : null;
}

/** An email as copies name it (D38). */
export interface EmailInfo {
  subject: string;
  name: string;
  address: string;
  /** ISO (UTC) or any date string; written as the local YYYY-MM-DD. */
  date?: string;
}

/** Finds an email by Message-ID for a reference (null: not found, the link's text stands in). */
export type EmailLookup = (messageId: string) => Promise<EmailInfo | null>;

/**
 * The shown list as Markdown (for an agenda, an email): a heading per group, the tasks as
 * checklist lines as written, each with its email in brackets (not when grouped by email: the
 * heading names it then).
 */
export async function listAsMarkdown(shown: Section[], lookup: EmailLookup = async () => null): Promise<string> {
  const out: string[] = [];
  for (const section of shown) {
    const e = section.email;
    const head = e ? emailRef({ subject: section.title, name: e.sender, address: e.senderAddress, date: e.date }) : section.title;
    out.push(`## ${head}`, "");
    for (const t of section.tasks) out.push(await taskAsMarkdown(t, lookup, !e));
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

/**
 * The email as text people and programs can read: `"Subject" - Name <address>, 2026-10-12`. The
 * subject exactly as it is (it runs from the first quote mark to the last before " - "); the
 * sender as in email headers (without a name: `<address>`); the email's day, ISO.
 */
export function emailRef(e: EmailInfo): string {
  const who = e.address ? `${e.name && e.name !== e.address ? `${e.name} ` : ""}<${e.address}>` : e.name;
  const day = e.date && !Number.isNaN(Date.parse(e.date)) ? isoDate(new Date(e.date)) : "";
  return [`"${e.subject}"`, who].filter(Boolean).join(" - ") + (day ? `, ${day}` : "");
}

const MID_LINK = /\[((?:\\.|[^[\]\\]|\[(?:\\.|[^[\]\\])*\])*)\]\(mid:([^)\s]+)\)/g;

/**
 * One task as a Markdown checklist line, with its email in brackets (`withEmail`). A link to an
 * email (`mid:`, nowhere outside ThunderNotes) becomes "(reference to email: …)": replacing the
 * link's text when that is the usual "Subject – Sender, date", after it when it is the writer's
 * own; an email not found: its link text as the reference.
 */
export async function taskAsMarkdown(t: TaskEntry, lookup: EmailLookup = async () => null, withEmail = true): Promise<string> {
  const text = await withEmailReferences(t.text, lookup);
  const from = withEmail ? ` (${emailRef({ subject: t.subject, name: t.sender, address: t.senderAddress, date: t.emailDate })})` : "";
  return `- [${t.done ? "x" : " "}] ${text}${from}`;
}

/** Links to emails (`mid:`) in a text written as "(reference to email: …)" (see taskAsMarkdown). */
export async function withEmailReferences(source: string, lookup: EmailLookup = async () => null): Promise<string> {
  let text = "";
  let last = 0;
  for (const m of source.matchAll(MID_LINK)) {
    const label = m[1]!.replace(/\\([[\]])/g, "$1");
    const found = await lookup(decodeURIComponent(m[2]!)).catch(() => null);
    text += source.slice(last, m.index!);
    if (!found) text += `(reference to email: ${label})`;
    else {
      const ref = `(reference to email: ${emailRef(found)})`;
      const usual = !!found.subject && label.trim().toLowerCase().startsWith(found.subject.trim().toLowerCase());
      text += usual ? ref : `${label} ${ref}`;
    }
    last = m.index! + m[0].length;
  }
  text += source.slice(last);
  return text;
}

/** An email's set as copies name it. */
export function emailInfoOf(email: AnnotationSet["email"]): EmailInfo {
  return {
    subject: email.subject || "(no subject)",
    name: email.from ? senderName(email.from) || email.from : "",
    address: addressOf(email.from),
    date: email.date,
  };
}

/**
 * A note's heading: what it is anchored to (the passage on one line, in quotes, as written), or
 * the whole email; with `email` (a note copied on its own) the email it is in, too.
 */
function noteHeading(quote: string | undefined, level: string, email?: EmailInfo): string {
  const passage = quote?.replace(/\s+/g, " ").trim();
  if (email) return passage ? `${level} Note anchored to "${passage}" in email ${emailRef(email)}` : `${level} Note on email ${emailRef(email)}`;
  return passage ? `${level} Note anchored to "${passage}"` : `${level} Note on the whole email`;
}

/**
 * One note's part of a copy: its heading, then its text with links to emails as references and
 * its own headings one level below that heading.
 */
async function notePart(note: { quote?: string; md: string }, level: string, lookup: EmailLookup, email?: EmailInfo): Promise<string> {
  const text = shiftHeadings((await withEmailReferences(note.md.trim(), lookup)).trim(), level.length);
  return `${noteHeading(note.quote, level, email)}\n\n${text}`;
}

/**
 * Headings in a note pushed `by` levels down, so in a copy they sit under the note's own heading
 * (`# Plan` under `## Note anchored to …` becomes `### Plan`). Past six levels they go on
 * (`#######`): not standard Markdown, but the hierarchy stays clear. Underlined headings (`===`,
 * `---` under a paragraph's only line) become `#` headings too; code blocks stay as they are.
 */
export function shiftHeadings(md: string, by: number): string {
  const lines = md.split("\n");
  const out: string[] = [];
  const code = codeLines(md); // as the renderer sees code (issues #4, #5)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (code.has(i)) {
      out.push(line);
      continue;
    }
    const atx = /^(\s{0,3})(#+)(?=\s|$)/.exec(line);
    if (atx) {
      out.push(line.replace(/^(\s{0,3})(#+)/, `$1$2${"#".repeat(by)}`));
      continue;
    }
    const next = lines[i + 1];
    const underline = next !== undefined && !code.has(i + 1) && /^\s{0,3}(=+|-+)\s*$/.exec(next);
    const paragraphLine = line.trim() && !(lines[i - 1] ?? "").trim() && !/^\s*(?:[-*+>|]|\d+[.)])/.test(line);
    if (underline && paragraphLine) {
      out.push(`${"#".repeat((underline[1]!.startsWith("=") ? 1 : 2) + by)} ${line.trim()}`);
      i++; // the underline
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * One note as Markdown (D38's conventions): a heading with the passage it is anchored to and the
 * email it is in, then the note's text with links to emails as references.
 */
export async function noteAsMarkdown(note: { quote?: string; md: string }, email: EmailInfo, lookup: EmailLookup = async () => null): Promise<string> {
  return `${await notePart(note, "##", lookup, email)}\n`;
}

/**
 * All notes of an email as Markdown: the email as the heading, then each note under a heading of
 * its own (the note on the whole email first, then in reading order). Plain highlights (no text)
 * are left out.
 */
export async function notesAsMarkdown(email: EmailInfo, emailNoteMd: string, notes: { quote?: string; md: string }[], lookup: EmailLookup = async () => null): Promise<string> {
  const parts = [`## ${emailRef(email)}`];
  for (const note of [{ md: emailNoteMd }, ...notes]) if (note.md.trim()) parts.push(await notePart(note, "###", lookup));
  return parts.join("\n\n") + "\n";
}
