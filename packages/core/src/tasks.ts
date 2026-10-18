/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { codeLines, taskSourceLines } from "./markdown-structure.js";

/**
 * Tasks (D38): every checklist item is a task, with an optional due date `@2026-10-24` and any
 * number of labels `#name` (labels work in all notes). The file always holds ISO dates; people
 * type them naturally (`@friday`, `@morgen`, `@24.10.`, `@inaweek`, `@3d`) and autocomplete writes the date.
 */

/** `@2026-10-24` (not inside a word or an address like anna@x). */
export const DUE_DATE = /(^|[^\p{L}\p{N}_@.])@(\d{4}-\d{2}-\d{2})(?![\p{L}\p{N}_-])/gu;

/**
 * `#label`: letters, digits, - _ / and at least one letter, after a space, "(", "[" or the line start
 * (`# Heading` has a space, `#123` no letter, `a#b` and URL fragments aren't labels).
 */
export const LABEL = /(^|[\s([])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu;

/** Local calendar date as `YYYY-MM-DD`. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fromIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

/** Whether `YYYY-MM-DD` is a real calendar day (not month 13 or 30 February). */
export function isValidDate(iso: string): boolean {
  return fromIso(iso) !== null;
}

let alwaysYear = false;

/**
 * The setting "Hide the current year in dates" (on by default): off, dates show the year
 * always. Each bundle (background, email, editor, task view) has its own copy of this module,
 * so each sets it from the stored setting.
 */
export function setAlwaysShowYear(on: boolean): void {
  alwaysYear = on;
}

/** "Fri 24 Oct", with the year at the end when it isn't this year ("Mon 11 Jan 2027"; always with the setting off). */
export function formatDue(iso: string, today = new Date(), locale?: string): string {
  const d = fromIso(iso);
  if (!d) return iso;
  const sameYear = d.getFullYear() === today.getFullYear() && !alwaysYear;
  // Always weekday, day, month[, year] in that order (names in the locale's language, no dots).
  const byType = new Map(
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })
      .formatToParts(d)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value.replace(/[.,]$/, "")])
  );
  return [byType.get("weekday"), byType.get("day"), byType.get("month"), byType.get("year")].filter(Boolean).join(" ");
}

/** Whether a due date is before today. */
export function isOverdue(iso: string, today = new Date()): boolean {
  return iso < isoDate(today);
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, sonntag: 0, so: 0,
  monday: 1, mon: 1, montag: 1, mo: 1,
  tuesday: 2, tue: 2, tues: 2, dienstag: 2, di: 2,
  wednesday: 3, wed: 3, mittwoch: 3, mi: 3,
  thursday: 4, thu: 4, thurs: 4, donnerstag: 4, do: 4,
  friday: 5, fri: 5, freitag: 5, fr: 5,
  saturday: 6, sat: 6, samstag: 6, sa: 6, sonnabend: 6,
};

const plus = (today: Date, days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);

/** Months later (or earlier), on the same day or the month's last day (31 Jan + 1 month = 28/29 Feb). */
function plusMonths(today: Date, months: number): Date {
  const first = new Date(today.getFullYear(), today.getMonth() + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(today.getDate(), last));
}

/** `3d` / `2w` / `1m` / `1y` (German `t`ag, `j`ahr too), `-` in front for the past: days, weeks, months, years from today. */
const COUNT = /^(-?)(\d{1,3})([dtwmyj])$/;
const UNIT: Record<string, [string, string]> = { d: ["day", "days"], t: ["day", "days"], w: ["week", "weeks"], m: ["month", "months"], y: ["year", "years"], j: ["year", "years"] };

function fromCount(sign: string, n: number, unit: string, today: Date): Date {
  const by = sign === "-" ? -n : n;
  if (unit === "d" || unit === "t") return plus(today, by);
  if (unit === "w") return plus(today, 7 * by);
  return plusMonths(today, unit === "m" ? by : 12 * by);
}

const countHint = (sign: string, n: number, unit: string) => {
  const what = `${n} ${UNIT[unit]![n === 1 ? 0 : 1]}`;
  return sign === "-" ? `${what} ago` : `in ${what}`;
};

/** `lastmonday` / `last-mon` / `letztenmontag`: the most recent such day before today (a week ago on that day). */
const LAST = /^(?:last|letzte[nrs]?)-?(.+)$/;

/**
 * A typed date word (after `@`) as an ISO date, or null: today/heute, tomorrow/morgen,
 * übermorgen, yesterday/gestern, vorgestern, a weekday (English or German, also abbreviated: the
 * next one, today excluded), `lastmonday` (the last one), `inaweek` / `inamonth`, counts `3d` /
 * `2w` / `1m` / `1y` (`-2w` back), `24.10.` / `24.10` / `24.10.2027` / `24.10.27`, `2026-10-24`,
 * `2026-1-2` / `26-1-2` (year first, as in ISO).
 */
export function parseDateWord(word: string, today = new Date()): string | null {
  const w = word.trim().toLowerCase();
  if (!w) return null;
  if (w === "today" || w === "heute") return isoDate(today);
  if (w === "tomorrow" || w === "morgen") return isoDate(plus(today, 1));
  if (w === "übermorgen" || w === "uebermorgen") return isoDate(plus(today, 2));
  if (w === "yesterday" || w === "gestern") return isoDate(plus(today, -1));
  if (w === "vorgestern") return isoDate(plus(today, -2));
  if (/^in-?a-?week$|^in-?einer-?woche$/.test(w)) return isoDate(plus(today, 7));
  if (/^in-?a-?month$|^in-?einem-?monat$/.test(w)) return isoDate(plusMonths(today, 1));
  if (w in WEEKDAYS) {
    const diff = (WEEKDAYS[w]! - today.getDay() + 7) % 7 || 7;
    return isoDate(plus(today, diff));
  }
  const last = LAST.exec(w);
  if (last && last[1]! in WEEKDAYS) {
    const back = (today.getDay() - WEEKDAYS[last[1]!]! + 7) % 7 || 7;
    return isoDate(plus(today, -back));
  }
  const count = COUNT.exec(w);
  if (count) return isoDate(fromCount(count[1]!, Number(count[2]), count[3]!, today));
  // 24.10. / 24.10 / 24.10.27 / 24.10.2027 (the closing dot optional)
  let m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4})?)?$/.exec(w);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : today.getFullYear();
    let d = new Date(year, Number(m[2]) - 1, Number(m[1]));
    if (d.getMonth() !== Number(m[2]) - 1) return null;
    // Without a year: the next such day (a date already past this year means next year).
    if (!m[3] && isoDate(d) < isoDate(today)) d = new Date(year + 1, Number(m[2]) - 1, Number(m[1]));
    return isoDate(d);
  }
  // Year first, as in ISO, also short: 2026-10-24, 2026-1-2, 26-1-2 (= 2026-01-02).
  m = /^(\d{2}|\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w);
  if (m) {
    const year = m[1]!.length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    const d = new Date(year, Number(m[2]) - 1, Number(m[3]));
    return d.getMonth() === Number(m[2]) - 1 && d.getFullYear() === year ? isoDate(d) : null;
  }
  return null;
}

/** Dates offered while typing `@word`: the parsed date, or (no word / partial) the likely ones. */
export function dateSuggestions(word: string, today = new Date()): { iso: string; hint: string }[] {
  const w = word.trim().toLowerCase();
  const count = COUNT.exec(w);
  const exact = parseDateWord(w, today);
  if (exact) return [{ iso: exact, hint: count ? countHint(count[1]!, Number(count[2]), count[3]!) : w }];
  const out: { iso: string; hint: string }[] = [];
  const add = (iso: string, hint: string) => {
    if (!out.some((o) => o.iso === iso)) out.push({ iso, hint });
  };
  // A number so far ("3", "-2"): what it can become.
  const n = /^(-?)(\d{1,3})$/.exec(w);
  if (n) {
    for (const unit of ["d", "w", "m"]) add(isoDate(fromCount(n[1]!, Number(n[2]), unit, today)), countHint(n[1]!, Number(n[2]), unit));
    return out;
  }
  const weekday = (d: Date, lang = "en") => new Intl.DateTimeFormat(lang, { weekday: "long" }).format(d).toLowerCase();
  const names: [string, string][] = [
    ["today", isoDate(today)],
    ["tomorrow", isoDate(plus(today, 1))],
    ...[1, 2, 3, 4, 5, 6, 7].map((n): [string, string] => [weekday(plus(today, n)), isoDate(plus(today, n))]),
    ["in a week", isoDate(plus(today, 7))],
    ["in a month", isoDate(plusMonths(today, 1))],
  ];
  // German words once something is typed (the empty list stays short).
  const german: [string, string][] = [
    ["heute", isoDate(today)],
    ["morgen", isoDate(plus(today, 1))],
    ["übermorgen", isoDate(plus(today, 2))],
    ["in einer woche", isoDate(plus(today, 7))],
    ["in einem monat", isoDate(plusMonths(today, 1))],
  ];
  // Past days only once something is typed: an empty "@" offers what lies ahead.
  const past: [string, string][] = [
    ["yesterday", isoDate(plus(today, -1))],
    ...[1, 2, 3, 4, 5, 6, 7].map((n): [string, string] => [`last ${weekday(plus(today, -n))}`, isoDate(plus(today, -n))]),
    ["gestern", isoDate(plus(today, -1))],
    ["vorgestern", isoDate(plus(today, -2))],
    ...[1, 2, 3, 4, 5, 6, 7].map((n): [string, string] => [`letzten ${weekday(plus(today, -n), "de")}`, isoDate(plus(today, -n))]),
  ];
  const squeezed = w.replace(/[\s-]/g, "");
  const matches = (name: string) => name.replace(/\s/g, "").startsWith(squeezed);
  if (w === "-") {
    for (const unit of ["d", "w", "m"]) add(isoDate(fromCount("-", 1, unit, today)), countHint("-", 1, unit));
    return out;
  }
  for (const [name, iso] of names) if (!w || matches(name)) add(iso, name);
  if (w) for (const [name, iso] of [...german, ...past]) if (matches(name)) add(iso, name);
  for (const name of Object.keys(WEEKDAYS)) if (w.length >= 2 && name.startsWith(w)) add(parseDateWord(name, today)!, name);
  return out.slice(0, 8);
}

/**
 * Labels are one regardless of case (#URGENT = #urgent) but keep a spelling (D38): of the
 * spellings used (each occurrence, in order), the most frequent, on a tie the first. By lower case.
 */
export function preferredSpellings(occurrences: Iterable<string>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const s of occurrences) {
    const key = s.toLowerCase();
    const forKey = counts.get(key) ?? new Map<string, number>();
    forKey.set(s, (forKey.get(s) ?? 0) + 1); // insertion order = first seen
    counts.set(key, forKey);
  }
  const out = new Map<string, string>();
  for (const [key, spellings] of counts) {
    let best = "";
    let most = 0;
    for (const [s, n] of spellings) if (n > most) [best, most] = [s, n];
    out.set(key, best);
  }
  return out;
}

/** Labels used in a note's text (without `#`), in order of appearance; not in code blocks. */
export function labelsIn(md: string): string[] {
  const code = codeLines(md);
  return labelsInText(md.split("\n").filter((_, i) => !code.has(i)).join("\n"));
}

/**
 * Labels in a piece of text whatever it is (a task's text, the editor's own lines, whose code it
 * knows itself): no Markdown parser, so the message display script stays small (D22).
 */
export function labelsInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LABEL)) if (!out.includes(m[2]!)) out.push(m[2]!);
  return out;
}

/**
 * A note's text with a label taken out everywhere (case ignored), not in code blocks: "#x " goes
 * with its space, so the text closes up; the label's own place in a heading or list stays.
 */
export function removeLabelFromNote(md: string, label: string): string {
  const re = new RegExp(`(^|[\\s([])#${label.replace(/^#/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_/-])[ \\t]?`, "giu");
  const code = codeLines(md);
  return md
    .split("\n")
    .map((line, i) => {
      if (code.has(i)) return line;
      return line.replace(re, (_all, lead: string) => lead).replace(/[ \t]+$/, "");
    })
    .join("\n");
}

/** A date after "@" that isn't ISO yet (D38): typed and kept, pasted, or written elsewhere. */
export interface LooseDate {
  /** Offsets of "@word" in the text. */
  from: number;
  to: number;
  word: string;
  iso: string;
  /** A number date (24.10.27, 1.3.27, 24.10., 26-1-2): absolute, safe to convert in pasted text. */
  numeric: boolean;
}

const LOOSE = /(^|[^\p{L}\p{N}_@.])@([\p{L}\p{N}.-]+)/gu;

/**
 * Non-ISO dates after "@" that would be understood: number dates and whole words (friday,
 * morgen …), not two-letter abbreviations, not inside code blocks. A trailing "." ends a
 * sentence unless it belongs to the date ("24.10.").
 */
export function looseDates(md: string, today = new Date()): LooseDate[] {
  return looseDatesOutside(md, today, codeLines(md));
}

/** As looseDates, in a piece of text whose code is known otherwise (an editor's line, a rendered text run). */
export function looseDatesInText(text: string, today = new Date()): LooseDate[] {
  return looseDatesOutside(text, today, new Set());
}

function looseDatesOutside(md: string, today: Date, code: Set<number>): LooseDate[] {
  const out: LooseDate[] = [];
  let offset = 0;
  for (const [i, line] of md.split("\n").entries()) {
    if (!code.has(i)) {
      for (const m of line.matchAll(LOOSE)) {
        const raw = m[2]!;
        const word = /^\d{1,2}\.\d{1,2}\.$/.test(raw) ? raw : raw.replace(/\.$/, "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(word)) continue;
        const numeric = /^\d{1,2}\.\d{1,2}(?:\.(?:\d{2}|\d{4})?)?$|^(?:\d{2}|\d{4})-\d{1,2}-\d{1,2}$/.test(word);
        if (!numeric && (/\d/.test(word) || word.length < 3)) continue;
        const iso = parseDateWord(word, today);
        if (!iso) continue;
        const from = offset + m.index! + m[1]!.length;
        out.push({ from, to: from + 1 + word.length, word, iso, numeric });
      }
    }
    offset += line.length + 1;
  }
  return out;
}

/** The text with these loose dates written as ISO dates (`@2027-10-24`). */
export function convertLooseDates(md: string, dates: LooseDate[]): string {
  let out = md;
  for (const d of [...dates].sort((a, b) => b.from - a.from)) out = `${out.slice(0, d.from)}@${d.iso}${out.slice(d.to)}`;
  return out;
}

/**
 * When a task was finished (D38): `✅ 2026-10-17` at the end of its line, as the Obsidian Tasks
 * plugin writes it. Added on ticking, removed on unticking.
 */
export const DONE_DATE = /✅\uFE0F?[ \t]*(\d{4}-\d{2}-\d{2})/gu;

const TASK_BOX = /^(\s*(?:>\s?)*\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/;

/**
 * A task line ticked (with today's date appended, unless it has one) or unticked (its date
 * removed). Lines that aren't tasks come back unchanged.
 */
export function markDone(line: string, done: boolean, today = new Date()): string {
  if (!TASK_BOX.test(line)) return line;
  const ticked = line.replace(TASK_BOX, `$1[${done ? "x" : " "}]`);
  const without = ticked.replace(new RegExp(`[ \\t]*${DONE_DATE.source}`, "gu"), "");
  if (!done) return without;
  return new RegExp(DONE_DATE.source, "u").test(ticked) ? ticked : `${ticked.trimEnd()} ✅ ${isoDate(today)}`;
}

/** A checklist item in a note (D38), for the task view. */
export interface TaskItem {
  /** Index of the item's checkbox line in the note. */
  line: number;
  /** That line as written, to find the item again when it is ticked. */
  raw: string;
  /** The text after the checkbox, continuation lines joined with a space. */
  text: string;
  done: boolean;
  /** Dates in the item (ISO, sorted, once each): due dates while it is open. */
  dates: string[];
  /** When it was finished (`✅ …`), if it says. */
  doneOn?: string;
  labels: string[];
  /**
   * The list item it is indented under, if any: a checklist item (`task`, then a task of its own:
   * this is its sub-task) or a plain bullet or number (its text then names what it is part of).
   */
  parent?: { line: number; text: string; task: boolean };
}

const TASK_LINE = /^(\s*(?:>\s?)*)(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\](?:\s+(.*))?$/;
const LIST_LINE = /^\s*(?:>\s?)*\s*(?:[-*+]|\d+[.)])\s/;
/** The line after a task's block: its own line and the indented lines that continue its text (not code). */
function blockEnd(lines: string[], at: number, code: Set<number>): number {
  const m = TASK_LINE.exec(lines[at]!);
  if (!m) return at + 1;
  const indent = m[2]!.length;
  let j = at + 1;
  for (; j < lines.length; j++) {
    const next = lines[j]!;
    const rest = next.slice(m[1]!.length);
    if (!next.startsWith(m[1]!) || !rest.trim() || LIST_LINE.test(next) || code.has(j) || /^\s*/.exec(rest)![0].length <= indent) break;
  }
  return j;
}

const ITEM_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\](?:\s+|$))?(.*)$/;

/**
 * The list item a line at `indent` (after the quote markers `quote`) is indented under: the
 * nearest list item above it that is indented less, over blank lines, deeper items and their
 * text; none once the list ends (a line of text not indented under it, another quote level).
 */
function parentItem(lines: string[], at: number, quote: string, indent: number, code: Set<number>): TaskItem["parent"] | undefined {
  if (indent === 0) return undefined;
  for (let i = at - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith(quote)) return undefined;
    const rest = line.slice(quote.length);
    if (!rest.trim()) continue;
    if (code.has(i)) return undefined;
    const own = /^\s*/.exec(rest)![0].length;
    const item = ITEM_LINE.exec(rest);
    if (item && own < indent) return { line: i, text: item[3]!.trim(), task: item[2] !== undefined };
    if (!item && own === 0) return undefined; // text outside the list: it has ended
  }
  return undefined;
}

/** A task's line now: where it was, or (the note changed meanwhile) the same line elsewhere if it is there once; -1 if gone. */
function locate(lines: string[], task: { line: number; raw: string }): number {
  if (lines[task.line] === task.raw) return task.line;
  const same = lines.flatMap((l, i) => (l === task.raw ? [i] : []));
  return same.length === 1 ? same[0]! : -1;
}

/**
 * The checklist items of a note, in order; not in code blocks. An item's text goes on in
 * the indented lines after it (not its sub-items, which are items of their own).
 */
export function tasksIn(md: string): TaskItem[] {
  return findTasks(md, codeLines(md), taskSourceLines(md));
}

/**
 * The checklist items in lines whose code is `code`; only those at `taskLines` (what the
 * renderer draws as boxes), else every line shaped like one.
 */
function findTasks(md: string, code: Set<number>, taskLines?: Set<number>): TaskItem[] {
  const lines = md.split("\n");
  const out: TaskItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (code.has(i) || (taskLines && !taskLines.has(i))) continue;
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    const parts = [m[4] ?? "", ...lines.slice(i + 1, blockEnd(lines, i, code)).map((l) => l.slice(m[1]!.length).trim())];
    const text = parts.join(" ").trim();
    // Impossible dates (month 13 …) are text, not dates.
    const dates = [...new Set([...text.matchAll(new RegExp(DUE_DATE.source, "gu"))].map((d) => d[2]!).filter(isValidDate))].sort();
    const doneOn = [...text.matchAll(new RegExp(DONE_DATE.source, "gu"))].map((d) => d[1]!).find(isValidDate);
    // The quote markers, then the indentation (TASK_LINE's first group takes both).
    const quote = /^(?:\s*>\s?)*/.exec(line)![0];
    const parent = parentItem(lines, i, quote, m[1]!.length + m[2]!.length - quote.length, code);
    out.push({ line: i, raw: line, text, done: m[3] !== " ", dates, labels: labelsInText(text), ...(doneOn ? { doneOn } : {}), ...(parent ? { parent } : {}) });
  }
  return out;
}

/** The checklist item whose lines (its own and those continuing its text) include `line`; null if none. */
export function taskAt(md: string, line: number): TaskItem | null {
  const code = codeLines(md);
  return taskAmong(md, line, findTasks(md, code, taskSourceLines(md)), code);
}

/**
 * As taskAt, from the lines' shape alone (no Markdown parser): for menus in the message display
 * script, which stays small (D22). Its caller knows the line isn't code (a rendered checkbox, the
 * editor's own syntax tree); the background checks again with taskAt before acting.
 */
export function taskAtLine(md: string, line: number): TaskItem | null {
  return taskAmong(md, line, findTasks(md, new Set()), new Set());
}

function taskAmong(md: string, line: number, tasks: TaskItem[], code: Set<number>): TaskItem | null {
  const task = tasks.filter((t) => t.line <= line).pop();
  return task && line < blockEnd(md.split("\n"), task.line, code) ? task : null;
}

/**
 * The note with one item ticked or unticked, found by its line (or, if the note changed
 * meanwhile, by the same line elsewhere when it is there exactly once); null when it's gone.
 */
export function setTaskDone(md: string, task: { line: number; raw: string }, done: boolean, today = new Date()): string | null {
  const lines = md.split("\n");
  const at = locate(lines, task);
  if (at < 0) return null;
  lines[at] = markDone(lines[at]!, done, today);
  return lines.join("\n");
}

/**
 * Quick changes to one task from the task view (D38), like ticking: its due date set (replacing
 * `from`, else added) or removed, a label added or removed, or (undo) its lines put back.
 */
export type TaskEdit =
  /** `nth`: which occurrence of `from` in the task (0 = first); without it, every occurrence. */
  | { kind: "due"; iso: string | null; from?: string; nth?: number }
  | { kind: "addLabel"; label: string }
  | { kind: "removeLabel"; label: string }
  | { kind: "restore"; block: string[]; current: string[] };

// "-" and "/" stay as they are: escaped, a "u" pattern rejects them (outside a class they mean nothing).
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOT_WORD = "(?![\\p{L}\\p{N}_/-])";

/** Something added at the end of a task's first line, before its finished date. */
function append(line: string, text: string): string {
  const m = /^(.*?)([ \t]*✅\uFE0F?[ \t]*\d{4}-\d{2}-\d{2})?[ \t]*$/u.exec(line)!;
  return `${m[1]} ${text}${m[2] ?? ""}`;
}

/** The note with the change, and the task's lines before and after it (for undo); null if the task is gone. */
export function editTask(
  md: string,
  task: { line: number; raw: string },
  edit: TaskEdit
): { md: string; before: string[]; after: string[] } | null {
  const lines = md.split("\n");
  const at = locate(lines, edit.kind === "restore" ? { line: task.line, raw: edit.current[0]! } : task);
  if (at < 0) return null;
  const end = edit.kind === "restore" ? at + edit.current.length : blockEnd(lines, at, codeLines(lines.join("\n")));
  const before = lines.slice(at, end);
  if (edit.kind === "restore" && before.join("\n") !== edit.current.join("\n")) return null;
  let after = [...before];
  const date = (iso: string) => new RegExp(`@${escapeRe(iso)}${NOT_WORD}`, "gu");
  // The occurrences of a date across the task's lines, in reading order; the n-th (or all) replaced.
  const replaceDate = (from: string, nth: number | undefined, by: (match: string) => string, withSpace: boolean) => {
    let n = -1;
    const re = new RegExp(`${withSpace ? "[ \\t]*" : ""}@${escapeRe(from)}${NOT_WORD}`, "gu");
    return after.map((l) => l.replace(re, (m) => (++n === nth || nth === undefined ? by(m) : m)));
  };
  if (edit.kind === "due" && edit.iso) {
    const iso = edit.iso;
    after = edit.from && before.some((l) => date(edit.from!).test(l)) ? replaceDate(edit.from, edit.nth, () => `@${iso}`, false) : [append(after[0]!, `@${iso}`), ...after.slice(1)];
  } else if (edit.kind === "due" && edit.from) {
    after = replaceDate(edit.from, edit.nth, () => "", true);
  } else if (edit.kind === "addLabel") {
    const label = edit.label.replace(/^#/, "");
    if (!labelsInText(before.join(" ")).some((l) => l.toLowerCase() === label.toLowerCase())) after = [append(after[0]!, `#${label}`), ...after.slice(1)];
  } else if (edit.kind === "removeLabel") {
    const re = new RegExp(`(^|[\\s([])#${escapeRe(edit.label.replace(/^#/, ""))}${NOT_WORD}`, "giu");
    after = after.map((l) => l.replace(re, (_all, lead: string) => (/\s/.test(lead) ? "" : lead)));
  } else if (edit.kind === "restore") {
    after = [...edit.block];
  }
  lines.splice(at, end - at, ...after);
  return { md: lines.join("\n"), before, after };
}
