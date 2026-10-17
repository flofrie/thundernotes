/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The task view (D38, stage 2): a tab with every checklist item in all notes, by due date
// (Overdue / Today / Next 7 days / Later / No date), label chips and a text box to filter,
// each task with its email (click opens it). Ticking here changes the note, as if edited in
// the email (synced, open emails redrawn). Done tasks are hidden unless "Show done" is on.

import {
  formatDue,
  isoDate,
  labelColourCss,
  markDone,
  messageIdOf,
  moveLabel,
  dateSuggestions,
  parseDateWord,
  setAlwaysShowYear,
  type TaskEdit,
  orderLabels,
  renderMarkdown,
  senderName,
  type LabelColours,
  type LabelOrder,
  type LabelOrderMode,
} from "@thundernotes/core";
import { EDIT_MENU_CSS, MOD, attachEditMenu, labelColourItems, openMenu, type MenuItem } from "./edit-menu.js";
import { hasInvalidRegex, highlightTerms, normaliseFilter } from "./filter-expr.js";
import { animateFrom, measure } from "./list-motion.js";
import { bracketPath, laneLeftOf, type RowEnd } from "./task-lines.js";
import { getAllSets } from "./store.js";
import { type DoneSort, type EmailInfo, type GroupBy, addressOf, collectTasks, labelSpellings, listAsMarkdown, taskAsMarkdown, taskKey, dateFilterLabel, dateFilterWord, inQuote, monthWord, monthWords, groupOf, labelCounts, sections, typedLabel, type Filter, type TaskEntry } from "./task-list.js";

const $ = (id: string) => document.getElementById(id)!;
const filterBox = $("filter") as HTMLInputElement;

// Per-viewer conveniences only (the notes themselves are in the add-on's database).
const PREFS_KEY = "thundernotes-tasks";
function loadPrefs(): {
  showDone?: boolean;
  labels?: string[];
  exclude?: string[];
  anyLabel?: boolean;
  allLabels?: boolean;
  doneSort?: DoneSort;
  groupBy?: GroupBy;
  doneMode?: DoneMode;
} {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function savePrefs(): void {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        showDone: filter.showDone,
        labels: filter.labels,
        exclude: filter.exclude,
        anyLabel: filter.anyLabel,
        doneSort: filter.doneSort,
        groupBy: filter.groupBy,
        doneMode,
        allLabels,
      })
    );
  } catch {
    // not stored: fine
  }
}

/** Done tasks: hidden, in the label or email sections, or in their own group. */
type DoneMode = "hide" | "inline" | "separate";

const prefs = loadPrefs();
/** As chosen; "inline" applies only when grouped by label or email (else they show separately). */
let doneMode: DoneMode = prefs.doneMode ?? (prefs.showDone ? "separate" : "hide");
function applyDoneMode(): void {
  filter.showDone = doneMode !== "hide";
  filter.doneInline = doneMode === "inline" && filter.groupBy !== "due";
}
const filter: Filter & { exclude: string[] } = {
  labels: prefs.labels ?? [],
  exclude: prefs.exclude ?? [],
  anyLabel: prefs.anyLabel === true,
  doneSort: prefs.doneSort ?? "finished-desc",
  groupBy: prefs.groupBy ?? "due",
  text: "",
  showDone: prefs.showDone === true,
};
applyDoneMode();
/** All label chips shown, not just two lines' worth. */
let allLabels = prefs.allLabels === true;
let tasks: TaskEntry[] = [];

/** A reload asked for while a field at a task is open (a redraw would throw it away). */
let reloadPending = false;

async function load(): Promise<void> {
  // E.g. sync storing the note a moment after the last quick action: wait until the field closes.
  if (document.querySelector("#groups .ask")) {
    reloadPending = true;
    return;
  }
  reloadPending = false;
  tasks = collectTasks(await getAllSets());
  render();
}

// The tab's icon and title show the overdue count, as the Tasks button does.
const ICON = `<path d="M5 3.5h22a1.5 1.5 0 0 1 1.5 1.5v16.5l-7 7H5A1.5 1.5 0 0 1 3.5 27V5A1.5 1.5 0 0 1 5 3.5z" fill="#ffd43b" stroke="#c99a00"/><path d="M28.5 21.5h-5.5a1.5 1.5 0 0 0-1.5 1.5v5.5z" fill="#f0b400" stroke="#c99a00" stroke-linejoin="round"/><rect x="8.5" y="8.5" width="12" height="12" rx="2" fill="#fff" stroke="#5c4300" stroke-width="2"/><path d="M11 14.5l3 3 6.5-7.5" fill="none" stroke="#2b8a3e" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;

function showOverdue(count: number): void {
  const label = count > 99 ? "99+" : String(count);
  const badge = count
    ? `<rect x="${label.length > 1 ? 9 : 15}" y="0" width="${label.length > 1 ? 23 : 17}" height="17" rx="8.5" fill="#c92a2a"/>` +
      `<text x="${label.length > 1 ? 20.5 : 23.5}" y="13.5" font-family="system-ui,sans-serif" font-size="${label.length > 2 ? 10 : 14}" font-weight="700" fill="#fff" text-anchor="middle">${label}</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${ICON}${badge}</svg>`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
  }
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  document.title = count ? `ThunderNotes Tasks (${count} overdue)` : "ThunderNotes Tasks";
}

/** Each label's spelling to show and write (one label regardless of case, as most often written). */
let spellings = new Map<string, string>();
const spelled = (label: string) => spellings.get(label.toLowerCase()) ?? label;

/** An email referenced in a task, for copies: one with notes from the list, else from Thunderbird. */
async function findEmail(messageId: string): Promise<EmailInfo | null> {
  const id = messageId.replace(/^<|>$/g, "");
  const known = tasks.find((t) => t.messageId.replace(/^<|>$/g, "") === id);
  if (known) return { subject: known.subject, name: known.sender, address: known.senderAddress, date: known.emailDate };
  const header = (await messenger.messages.query({ headerMessageId: id }).catch(() => null))?.messages[0];
  if (!header) return null;
  return { subject: header.subject ?? "", name: senderName(header.author) || header.author || "", address: addressOf(header.author), date: header.date ? new Date(header.date).toISOString() : undefined };
}

/** The sections on screen now (for "Copy list as Markdown"). */
let shownSections: ReturnType<typeof sections> = [];

/** The setting "Animate changes in the task view" (on unless switched off). */
let animate = true;

function render(): void {
  // Rows and headings slide to their new places (list-motion.ts), also while typing a filter: a
  // redraw during a slide measures the rows where they appear, so the next slide starts there.
  const before = animate ? measure($("groups")) : new Map<string, DOMRect>();
  renderList();
  markHits();
  applySelection();
  if (before.size) animateFrom($("groups"), before);
}

// Home / End, Cmd(Ctrl)+↑ / ↓: the first or the last task (no wrapping round at the ends). Caught
// first on the whole page: on macOS, Cmd+↑/↓ otherwise only scrolled the page (its own default).
window.addEventListener(
  "keydown",
  (e) => {
    const toEnd = e.key === "End" || ((e.metaKey || e.ctrlKey) && e.key === "ArrowDown");
    const toStart = e.key === "Home" || ((e.metaKey || e.ctrlKey) && e.key === "ArrowUp");
    if (!toEnd && !toStart) return;
    if ((document.activeElement as HTMLElement | null)?.matches?.("input, textarea")) return; // a field: its own start/end
    const all = rows();
    if (!all.length) return;
    e.preventDefault();
    e.stopPropagation();
    select(toEnd ? all.at(-1)! : all[0]!);
  },
  true
);

// ---- what the filter matched, marked (D38) --------------------------------------------------------
// Words, phrases and regex hits that must be there are marked faintly in the task's text and its
// email line, so it shows why a task is listed; dates typed as @2026-10 mark the date lozenges.

function markHits(): void {
  const { words, patterns } = highlightTerms(filter.text);
  if (!words.length && !patterns.length) return;
  const dates = words.filter((w) => /^@\d{4}(-\d{2}){0,2}$/.test(w)).map((w) => w.slice(1));
  const plain = words.filter((w) => !/^@\d{4}(-\d{2}){0,2}$/.test(w));
  for (const area of document.querySelectorAll<HTMLElement>("#groups li.entry .text, #groups li.entry .meta")) {
    for (const chip of area.querySelectorAll<HTMLElement>(".tn-date[data-date]")) {
      if (dates.some((d) => chip.dataset.date!.startsWith(d))) chip.classList.add("hit");
    }
    markText(area, plain, patterns);
  }
}

/** Wraps the matches in the text nodes below `root` in <mark class="hit">. */
function markText(root: HTMLElement, words: string[], patterns: RegExp[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.data;
    const lower = text.toLowerCase();
    const ranges: [number, number][] = [];
    for (const w of words) for (let i = lower.indexOf(w); w && i >= 0; i = lower.indexOf(w, i + w.length)) ranges.push([i, i + w.length]);
    for (const re of patterns) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) if (m[0]) ranges.push([m.index!, m.index! + m[0].length]);
    }
    if (!ranges.length) continue;
    // Overlapping matches merged; then the text is split around them.
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged.at(-1);
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
    }
    const parts: (string | HTMLElement)[] = [];
    let at = 0;
    for (const [from, to] of merged) {
      if (from > at) parts.push(text.slice(at, from));
      const mark = document.createElement("mark");
      mark.className = "hit";
      mark.textContent = text.slice(from, to);
      parts.push(mark);
      at = to;
    }
    if (at < text.length) parts.push(text.slice(at));
    node.replaceWith(...parts);
  }
}

// ---- the selected task: keyboard navigation (D38) ------------------------------------------------
// ↑/↓ move it (Home/End or Cmd+↑/↓: first/last), Space ticks, Enter opens the note at the task, d a date, l a label, t tomorrow,
// →/← show or hide the note, Esc lets go. A click on a task's row selects it. Kept by its row
// across redraws; gone (ticked away), the row now in its place is selected.

let selectedRow: string | null = null;
/** Set by Space with "stay on it": after the redraw, the page scrolls to the task (moved to Done). */
let followSelection = false;
/** The setting "When ticking a task with Space, stay on it" (off: on to the next task). */
let keepOnTick = false;
messenger.storage.local.get("tasksKeepOnTick").then((s) => (keepOnTick = s.tasksKeepOnTick === true));
let selectedIndex = -1;

const rows = () => [...document.querySelectorAll<HTMLElement>("#groups li.entry")];

function applySelection(): void {
  const all = rows();
  for (const r of all) r.classList.remove("selected");
  if (selectedRow === null) return drawTaskLines();
  let row = all.find((r) => r.dataset.key === selectedRow);
  if (!row && all.length) row = all[Math.min(Math.max(selectedIndex, 0), all.length - 1)]; // its place
  if (!row) {
    selectedRow = null;
    return drawTaskLines();
  }
  select(row, followSelection);
  followSelection = false;
}

function select(row: HTMLElement, scroll = true): void {
  for (const r of rows()) r.classList.toggle("selected", r === row);
  selectedRow = row.dataset.key ?? null;
  selectedIndex = rows().indexOf(row);
  drawTaskLines();
  if (!scroll) return;
  // The very first task: all the way up (title, filters, the first heading). The first of a group:
  // its heading in view too. Then the task itself.
  if (selectedIndex === 0) return void window.scrollTo?.({ top: 0 });
  if (row === row.parentElement?.firstElementChild) (row.parentElement.previousElementSibling as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  row.scrollIntoView?.({ block: "nearest" });
}

// ---- sub-tasks: lines from the selected task (D38) --------------------------------------------------
// The selected task's sub-tasks and parent, joined by lines in the margin left of the list
// (task-lines.ts): sub-tasks in the accent colour, the parent in grey on a lane further out.
// Measured by layout offsets, not on-screen boxes, so rows sliding to new places (list-motion)
// don't bend them. Ends off screen: a marker at the window's edge scrolls there.

const SVG_NS = "http://www.w3.org/2000/svg";
const linesLayer = document.createElementNS(SVG_NS, "svg");
linesLayer.classList.add("task-lines");
const edgeMarkers = { up: document.createElement("button"), down: document.createElement("button") };
for (const [dir, marker] of Object.entries(edgeMarkers)) {
  marker.className = `line-edge ${dir}`;
  marker.hidden = true;
  document.body.append(marker);
}
/** The rows the lines go to, for the edge markers. */
let lineTargets: { row: HTMLElement; kind: "parent" | "sub"; key: string }[] = [];

/** Rows showing a task (more than one when grouped by label). */
const rowsOf = (key: string) => rows().filter((r) => r.dataset.key?.startsWith(`t:${key}|`));

/** An element's offset within the list (layout, not the screen: unaffected by slides). */
function offsetIn(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let at: HTMLElement | null = el; at && at !== root; at = at.offsetParent as HTMLElement | null) {
    x += at.offsetLeft;
    y += at.offsetTop;
  }
  return { x, y };
}

function rowEnd(row: HTMLElement, root: HTMLElement): RowEnd {
  const box = row.querySelector<HTMLElement>(".tn-box") ?? row;
  const at = offsetIn(box, root);
  return { x: offsetIn(row, root).x, y: at.y + box.offsetHeight / 2 };
}

function drawTaskLines(): void {
  const root = $("groups");
  if (linesLayer.parentNode !== root) root.prepend(linesLayer);
  linesLayer.replaceChildren();
  lineTargets = [];
  const current = selectedEntry();
  if (current) {
    const { row, task } = current;
    const from = rowEnd(row, root);
    // Grouped by label, a task with two labels has two rows: a line to each.
    const subTargets = task.children.flatMap((key) => rowsOf(key).map((row) => ({ row, kind: "sub" as const, key })));
    const parentTargets = task.parentKey ? rowsOf(task.parentKey).map((row) => ({ row, kind: "parent" as const, key: task.parentKey! })) : [];
    lineTargets = [...subTargets, ...parentTargets];
    const subs = subTargets.map((t) => t.row);
    const parents = parentTargets.map((t) => t.row);
    const all = rows().map((r) => rowEnd(r, root));
    const draw = (targets: HTMLElement[], lane: number, cls: string) => {
      // The lane left of every row it joins and every row it passes: grouped by email, a parent
      // sits less indented, and a sub-task whose parent is hidden (done) sits further out in between.
      const ends = targets.map((r) => rowEnd(r, root));
      const d = bracketPath(from, ends, laneLeftOf([from, ...ends], all) - lane);
      if (!d) return;
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.classList.add(cls);
      linesLayer.append(path);
    };
    draw(subs, 8, "sub");
    draw(parents, 15, "parent");
  }
  placeEdgeMarkers();
}

/** Line ends off screen: a marker at the top or bottom of the window that scrolls to the nearest. */
function placeEdgeMarkers(): void {
  const top = document.body.classList.contains("sticky-top") ? ($("top")?.getBoundingClientRect().bottom ?? 0) : 0;
  const above = lineTargets.filter((t) => t.row.getBoundingClientRect().bottom < top);
  const below = lineTargets.filter((t) => t.row.getBoundingClientRect().top > window.innerHeight);
  const say = (list: typeof lineTargets) => {
    // Counted as tasks, not rows (grouped by label, one task can have several rows).
    const subs = new Set(list.filter((t) => t.kind === "sub").map((t) => t.key)).size;
    return [list.some((t) => t.kind === "parent") ? "part of" : "", subs ? `${subs} sub-task${subs === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
  };
  const set = (marker: HTMLButtonElement, list: typeof lineTargets, arrow: string, nearest: () => HTMLElement | undefined) => {
    marker.hidden = !list.length;
    marker.textContent = `${arrow} ${say(list)}`;
    marker.style.top = arrow === "↑" ? `${top + 6}px` : "";
    marker.onclick = () => nearest()?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };
  set(edgeMarkers.up, above, "↑", () => above.at(-1)?.row);
  set(edgeMarkers.down, below, "↓", () => below[0]?.row);
}
let edgeFrame = 0;
const edgesSoon = () => {
  cancelAnimationFrame(edgeFrame);
  edgeFrame = requestAnimationFrame(placeEdgeMarkers);
};
window.addEventListener("scroll", edgesSoon, { passive: true });
window.addEventListener("resize", () => drawTaskLines());

function selectedEntry(): { row: HTMLElement; task: TaskEntry; box: HTMLButtonElement } | null {
  const row = rows().find((r) => r.classList.contains("selected"));
  const e = row && entries.get(row);
  return row && e ? { row, ...e } : null;
}

// A click on empty space (beside the list, between groups) lets go of the selection and its lines.
document.addEventListener("click", (e) => {
  const target = e.target as Element;
  if (selectedRow === null || !target.matches?.("body, main, #groups, ul.tasks, h2")) return;
  selectedRow = null;
  applySelection();
});

$("groups").addEventListener("click", (e) => {
  const target = e.target as Element;
  const row = target.closest<HTMLElement>("li.entry");
  // Not when the click does something else (box, links, labels, dates, the arrow, a field).
  if (!row || target.closest("button, a, .tn-label, .tn-date, .ask, .note-preview a")) return;
  select(row, false);
});

document.addEventListener("keydown", (e) => {
  const active = document.activeElement as HTMLElement | null;
  if (active?.matches?.("input, textarea") || e.altKey) return;
  const all = rows();
  if (!all.length) return;
  if (e.metaKey || e.ctrlKey) return; // Cmd+↑/↓: below, caught first
  const current = selectedEntry();
  const move = (by: number) => {
    const at = current ? all.indexOf(current.row) : by > 0 ? -1 : all.length;
    const next = all[Math.min(Math.max(at + by, 0), all.length - 1)];
    if (next) select(next);
  };
  if (e.key === "ArrowDown" || e.key === "j") return (e.preventDefault(), move(1));
  if (e.key === "ArrowUp" || e.key === "k") return (e.preventDefault(), move(-1));
  if (!current) return;
  // A focused button (a switch just clicked) takes Space and Enter itself.
  if ((e.key === " " || e.key === "Enter") && active?.matches?.("button") && !active.classList.contains("tn-box")) return;
  const { row, task, box } = current;
  const day = (n: number) => dayFromToday(n);
  switch (e.key) {
    case " ": {
      e.preventDefault();
      // On to the next task first (the previous one at the end), also when the ticked one moves to
      // "Done" and stays listed; with the setting "stay on it", the selection goes along with it.
      if (!keepOnTick) {
        const at = all.indexOf(row);
        const next = all[at + 1] ?? all[at - 1];
        if (next) select(next);
      } else followSelection = true; // it may move to Done, off screen: scrolled to after the redraw
      return void tick(task, !task.done, box);
    }
    case "Enter":
      e.preventDefault();
      return openTaskEmail(task);
    case "d":
      e.preventDefault();
      return askInline(row, "date", task);
    case "l":
      e.preventDefault();
      return askInline(row, "label", task);
    case "t":
      // Tomorrow: the earliest date moved there, or added.
      e.preventDefault();
      return void applyEdit(task, { kind: "due", iso: day(1), from: task.due }, `Date ${formatDue(day(1))}.`);
    case "ArrowRight":
      e.preventDefault();
      return setExpanded(task, true);
    case "ArrowLeft":
      e.preventDefault();
      return setExpanded(task, false);
    case "Escape":
      selectedRow = null;
      return applySelection();
  }
});

function renderList(): void {
  applyDoneMode();
  showOverdue(tasks.filter((t) => groupOf(t) === "overdue").length);
  // The chosen order (D40): by use, A–Z, Z–A or the own one.
  const byUse = labelCounts(tasks, filter.showDone);
  const ordered = orderLabels(byUse.map((l) => l.label), labelOrder);
  const labels = ordered.map((l) => byUse.find((x) => x.label === l)!);
  spellings = labelSpellings(tasks);
  shownOrder = ordered;
  filter.labelOrder = ordered;
  // A chosen label no longer used anywhere is dropped, so nothing stays filtered invisibly.
  filter.labels = filter.labels.filter((l) => labels.some((x) => x.label === l));
  filter.exclude = filter.exclude.filter((l) => labels.some((x) => x.label === l));
  renderLabels(labels);
  const groups = sections(tasks, filter, labels.map((l) => l.label));
  shownSections = groups;
  const out = $("groups");
  out.replaceChildren();
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = tasks.some((t) => !t.done)
      ? "No tasks match the filter."
      : "No open tasks. Every checklist item in a note (- [ ] …) shows up here; @friday or @24.10. gives it a due date, #name a label.";
    out.append(empty);
    return;
  }
  for (const group of groups) {
    const h = document.createElement("h2");
    h.className = group.kind;
    h.dataset.key = `h:${group.id}`;
    if (group.kind === "label" && group.label) {
      // The label as a chip, in its colour (D40).
      const chip = document.createElement("span");
      chip.className = "tn-chip tn-label";
      chip.dataset.label = group.label;
      chip.textContent = group.title;
      h.append(chip);
    } else if (group.email) {
      // The email's subject and sender; a click opens it.
      const { messageId, sender, date } = group.email;
      const open = document.createElement("a");
      open.className = "email-title";
      open.title = "Open the email";
      open.textContent = group.title;
      open.addEventListener("click", () => void messenger.runtime.sendMessage({ type: "openEmail", messageId }));
      const meta = document.createElement("span");
      meta.className = "email-meta";
      const { senderAddress } = group.email;
      meta.append(...senderParts(sender, senderAddress));
      if (date) meta.append(`${sender ? ", " : ""}${formatDue(isoDate(new Date(date)))}`);
      h.append(open, meta);
    } else {
      h.append(group.title);
    }
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(group.tasks.length);
    h.append(count);
    if (group.kind === "none") {
      // Its order isn't obvious (the other groups go by date): said in the heading.
      const how = document.createElement("span");
      how.className = "how";
      how.textContent = "(oldest email first)";
      h.append(how);
    }
    if (group.kind === "done") h.append(doneSortSwitch());
    const list = document.createElement("ul");
    list.className = "tasks";
    list.append(...group.tasks.map((t) => entry(t, group.kind !== "email", group.kind === "label" ? group.id : "")));
    // Grouped by email: a real tree, sub-tasks indented under their parents (in note order).
    if (group.kind === "email") {
      const inGroup = new Map(group.tasks.map((t) => [taskKey(t), t]));
      const depth = (t: TaskEntry): number => {
        let d = 0;
        for (let p = t.parentKey && inGroup.get(t.parentKey); p && d < 20; p = p.parentKey && inGroup.get(p.parentKey)) d++;
        return d;
      };
      [...list.children].forEach((li, i) => {
        const task = group.tasks[i]!;
        const d = depth(task);
        if (d) (li as HTMLElement).style.marginLeft = `${d * 24}px`;
        // Right under its parent: "part of" would only repeat what the indent shows.
        if (task.parentKey && inGroup.has(task.parentKey)) {
          const part = li.querySelector(".partof");
          if (part?.nextSibling?.textContent === " · ") part.nextSibling.remove();
          part?.remove();
        }
      });
    }
    out.append(h, list);
  }
}

// Label chips (D38): most used first, two lines of them, then "+N more" (chosen labels always
// show). A click cycles: include (red ring) → exclude (struck through) → off. With two or more
// included, "Match all | any" says whether a task needs all of them or one; excluded ones
// always hide a task. Typing "#word" in the filter box narrows the chips to labels containing
// the word; Enter includes the first.
const chosen = (label: string) => filter.labels.includes(label) || filter.exclude.includes(label);
const isChosen = (chip: Element) => chip.classList.contains("on") || chip.classList.contains("not");
function renderLabels(labels: { label: string; count: number }[]): void {
  const box = $("labels");
  const typed = typedLabel(filter.text);
  const shown = typed === null ? labels : labels.filter((l) => l.label.includes(typed) || chosen(l.label));
  const next = typed === null ? null : (shown.find((l) => !chosen(l.label))?.label ?? null);
  const chips = shown.map(({ label, count }) => {
    const chip = document.createElement("button");
    const on = filter.labels.includes(label);
    const not = filter.exclude.includes(label);
    chip.className = `label-chip${on ? " on" : ""}${not ? " not" : ""}${label === next ? " next" : ""}`;
    chip.dataset.label = label;
    chip.append(`#${spelled(label)}`);
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = String(count);
    chip.append(n);
    chip.title =
      (on ? "Included. Click: hide tasks with this label" : not ? "Excluded. Click: off" : "Click: show only tasks with this label") +
      (label === next ? " (Enter in the filter box)" : "") +
      ". Drag: own order. Right-click: colour, move";
    chip.addEventListener("click", () => toggleLabel(label));
    if (typed === null) draggable(chip, label);
    return chip;
  });
  box.replaceChildren(orderButton(), ...chips);
  renderControls();
  if (typed !== null) {
    if (!shown.length) box.append(Object.assign(document.createElement("span"), { className: "no-labels", textContent: `No label contains “${typed}”` }));
    return;
  }
  const height = chips[0]?.offsetHeight || 1;
  if (allLabels) {
    if (fold(chips, height, true)) box.append(moreChip("Fewer", () => setAllLabels(false)));
    return;
  }
  const hidden = fold(chips, height, false);
  if (hidden) {
    const more = moreChip("", () => setAllLabels(true));
    box.append(more);
    // The "+N more" chip itself must fit on the second line: hide chips before it until it does.
    const visible = chips.filter((c) => !c.hidden && !isChosen(c));
    let count = hidden;
    const update = () => (more.textContent = `+${count} more`);
    update();
    while (rowOf(more, height) > 1 && visible.length) {
      visible.pop()!.hidden = true;
      count++;
      update();
    }
  }
}

/** Which line (0, 1, 2 …) of the label box a chip sits on (the box is their offset parent). */
function rowOf(el: HTMLElement, height: number): number {
  return Math.round(el.offsetTop / (height + 6)); // 6 = the row gap
}

/**
 * Hides the chips below the second line (chosen ones stay); returns how many were hidden. With
 * `count` only counts (all shown): whether there is more than two lines at all.
 */
function fold(chips: HTMLElement[], height: number, count: boolean): number {
  // Positions read before hiding any: hiding one moves the later ones up.
  const below = chips.filter((chip) => rowOf(chip, height) > 1);
  if (count) return below.length;
  const hide = below.filter((chip) => !isChosen(chip));
  for (const chip of hide) chip.hidden = true;
  return hide.length;
}

function moreChip(text: string, onClick: () => void): HTMLButtonElement {
  const chip = document.createElement("button");
  chip.className = "label-chip more";
  chip.textContent = text;
  chip.addEventListener("click", onClick);
  return chip;
}

function setAllLabels(on: boolean): void {
  allLabels = on;
  savePrefs();
  render();
}

// ---- the labels' order (D40) ----------------------------------------------------------------------

let labelOrder: LabelOrder | undefined;
/** The labels in the order shown (all of them, also those folded away). */
let shownOrder: string[] = [];

const ORDER_NAMES: [LabelOrderMode, string][] = [
  ["used", "Most used"],
  ["az", "A–Z"],
  ["za", "Z–A"],
  ["custom", "Own order (drag labels)"],
];

/** Chosen here: shown at once, stored and synced by the background. */
function setOrder(mode: LabelOrderMode, custom?: string[]): void {
  labelOrder = { mode, custom: custom ?? labelOrder?.custom ?? [], updated: new Date().toISOString() };
  // The own order chosen for the first time: the one on screen now.
  if (mode === "custom" && !labelOrder.custom.length) labelOrder.custom = [...shownOrder];
  void messenger.runtime.sendMessage({ type: "setLabelOrder", mode, custom: labelOrder.custom });
  render();
}

/** At the start of the row, so it doesn't move as labels come and go. */
function orderButton(): HTMLElement {
  const b = document.createElement("button");
  b.className = "order-btn";
  b.textContent = "⇅";
  const current = labelOrder?.mode ?? "used";
  b.title = `Order of the labels: ${ORDER_NAMES.find(([m]) => m === current)![1]}`;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu(document.body, e, [
      { label: "", info: { strong: "Order labels", rest: "" }, run() {} },
      ...ORDER_NAMES.map(([mode, name]): MenuItem => ({ label: `${mode === current ? "✓ " : "\u2003"}${name}`, run: () => setOrder(mode) })),
    ]);
  });
  return b;
}

/** Moves a label in the own order (dragged, or from its menu). */
function placeLabel(label: string, index: number): void {
  setOrder("custom", moveLabel(shownOrder, label, index, labelOrder?.custom));
}

// Dragging a chip: the others make way as it moves (it always sits where it would land, a
// short slide shows the change); let go in the label row and that order is kept, elsewhere or
// with Esc it goes back. All chips show meanwhile, also those folded away.
let dragging: HTMLElement | null = null;
let dropped = false;

function draggable(chip: HTMLElement, label: string): void {
  chip.draggable = true;
  chip.addEventListener("dragstart", (e) => {
    e.dataTransfer?.setData("text/plain", label);
    // Moved within the label row (its order), copied onto a task (the label added): both allowed.
    // Only "move" made a browser refuse the drop on a task, which says "copy".
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
    dragging = chip;
    dragLabel = { label };
    dropped = false;
    chip.classList.add("dragging");
    for (const c of document.querySelectorAll<HTMLElement>("#labels .label-chip")) c.hidden = false;
    document.querySelector("#labels .label-chip.more")?.remove();
  });
  chip.addEventListener("dragover", (e) => {
    if (!dragging || dragging === chip) return;
    e.preventDefault();
    // Past the middle of the chip in the direction of travel: swap (no flicker at the edges).
    const r = chip.getBoundingClientRect();
    const middle = r.left + r.width / 2;
    const draggedFirst = !!(dragging.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (draggedFirst && e.clientX > middle) slide(() => chip.after(dragging!));
    else if (!draggedFirst && e.clientX < middle) slide(() => chip.before(dragging!));
  });
  chip.addEventListener("dragend", () => {
    const wasDropped = dropped;
    dragging = null;
    dragLabel = null;
    clearDropTarget();
    if (!wasDropped) render(); // let go outside the row or Esc: as before
  });
}

// A chip dragged from the label row onto a task: the label is added to it (unless it has it).
// The row's order goes back as it was (the drop wasn't in the row).
const clearDropTarget = () => document.querySelectorAll("#groups li.entry.drop-target").forEach((r) => r.classList.remove("drop-target"));
/**
 * A label being dragged: from the label row (a chip) or out of a task (`from`). Onto a task it is
 * added there; a task's own label dropped on empty space (not a task, not the label row) is
 * removed from it.
 */
let dragLabel: { label: string; from?: TaskEntry; fromRow?: HTMLElement } | null = null;

/** A label in a task, draggable: onto another task (added there) or off (removed from this one). */
function draggableLabels(row: HTMLElement, task: TaskEntry): void {
  for (const chip of row.querySelectorAll<HTMLElement>(".text .tn-label[data-label]")) {
    chip.draggable = true;
    chip.addEventListener("dragstart", (e) => {
      const label = chip.dataset.label!;
      e.dataTransfer?.setData("text/plain", `#${label}`);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
      dragLabel = { label, from: task, fromRow: row };
      row.classList.add("drag-source");
      document.body.classList.add("dragging-label-out");
    });
    chip.addEventListener("dragend", () => {
      dragLabel = null;
      row.classList.remove("drag-source");
      document.body.classList.remove("dragging-label-out");
      clearDropTarget();
    });
  }
}

// Off a task: anywhere but a task or the label row is "empty space" (the label goes).
const offTarget = (target: Element) => !target.closest("li.entry, #labelbar");
document.addEventListener("dragover", (e) => {
  if (!dragLabel?.from || !offTarget(e.target as Element)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
});
document.addEventListener("drop", (e) => {
  if (!dragLabel?.from || !offTarget(e.target as Element)) return;
  e.preventDefault();
  const { label, from } = dragLabel;
  void applyEdit(from, { kind: "removeLabel", label }, `#${label} removed.`);
});

$("groups").addEventListener("dragover", (e) => {
  const row = (e.target as Element).closest<HTMLElement>("li.entry");
  if (!dragLabel || !row || row === dragLabel.fromRow) return clearDropTarget();
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  if (!row.classList.contains("drop-target")) {
    clearDropTarget();
    row.classList.add("drop-target");
  }
});
$("groups").addEventListener("dragleave", (e) => {
  if (!(e.relatedTarget as Element | null)?.closest?.("#groups")) clearDropTarget();
});
$("groups").addEventListener("drop", (e) => {
  const row = (e.target as Element).closest<HTMLElement>("li.entry");
  const label = dragLabel?.label;
  clearDropTarget();
  if (row && row === dragLabel?.fromRow) return; // back on its own task: nothing
  const found = row && entries.get(row);
  if (!found || !label) return;
  e.preventDefault();
  const { task } = found;
  if (task.labels.some((l) => l.toLowerCase() === label)) return notice(`This task has #${spelled(label)} already.`);
  void applyEdit(task, { kind: "addLabel", label: spelled(label) }, `#${spelled(label)} added.`);
});

/** The label row takes the drop: the order on screen becomes the own order. */
const labelRow = $("labels");
labelRow.addEventListener("dragover", (e) => {
  if (!dragging) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
});
labelRow.addEventListener("drop", (e) => {
  if (!dragging) return;
  e.preventDefault();
  dropped = true;
  const onScreen = [...labelRow.querySelectorAll<HTMLElement>(".label-chip[data-label]")].map((c) => c.dataset.label!);
  setOrder("custom", [...onScreen, ...(labelOrder?.custom ?? []).filter((l) => !onScreen.includes(l))]);
});

/** Moves chips with a short slide from where they were (each measured before and after). */
function slide(move: () => void): void {
  const chips = [...labelRow.querySelectorAll<HTMLElement>(".label-chip")];
  const before = new Map(chips.map((c) => [c, c.getBoundingClientRect()]));
  move();
  for (const c of chips) {
    const was = before.get(c)!;
    const now = c.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (!dx && !dy) continue;
    c.style.transition = "none";
    c.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      c.style.transition = "transform 150ms ease";
      c.style.transform = "";
    });
  }
}

/** A label in a task: included, or out again if it was; excluded becomes included. */
function includeLabel(label: string): void {
  const l = label.toLowerCase();
  const was = filter.labels.includes(l);
  filter.exclude = filter.exclude.filter((x) => x !== l);
  filter.labels = was ? filter.labels.filter((x) => x !== l) : [...filter.labels, l];
  savePrefs();
  render();
}

/** Off → included → excluded → off. */
function toggleLabel(label: string): void {
  const l = label.toLowerCase();
  if (filter.labels.includes(l)) {
    filter.labels = filter.labels.filter((x) => x !== l);
    filter.exclude = [...filter.exclude, l];
  } else if (filter.exclude.includes(l)) {
    filter.exclude = filter.exclude.filter((x) => x !== l);
  } else {
    filter.labels = [...filter.labels, l];
  }
  savePrefs();
  render();
}

// The line below the labels: "Match all | any" (greyed out until two labels are included: then
// it applies) and "Done hide | show", two switches of one kind, always in their place.
function renderControls(): void {
  $("controls").replaceChildren(
    segmented("Group", [
      { text: "due date", title: "Overdue, today, next 7 days, later, no date", current: filter.groupBy === "due", pick: () => (filter.groupBy = "due") },
      { text: "label", title: "One section per label (a task with two labels in both)", current: filter.groupBy === "label", pick: () => (filter.groupBy = "label") },
      { text: "email", title: "One section per email: what is still open there", current: filter.groupBy === "email", pick: () => (filter.groupBy = "email") },
    ]),
    segmented("Match", [
      { text: "all", title: "Tasks with all the included labels", current: !filter.anyLabel, pick: () => (filter.anyLabel = false) },
      { text: "any", title: "Tasks with at least one of the included labels", current: !!filter.anyLabel, pick: () => (filter.anyLabel = true) },
    ], filter.labels.length < 2 ? "Include two or more labels to choose whether a task needs all of them or one" : null),
    segmented("Done", [
      { text: "hide", title: "Only open tasks", current: doneMode === "hide", pick: () => (doneMode = "hide") },
      {
        text: "show inline",
        title: "In each label's or email's section, after its open tasks",
        current: doneMode === "inline" && filter.groupBy !== "due",
        pick: () => (doneMode = "inline"),
        // A done task with a past date isn't overdue: by due date they'd have no place but a group of their own.
        disabled: filter.groupBy === "due" ? "Only when grouped by label or email: by due date, done tasks show separately" : undefined,
      },
      // By due date "inline" shows as this (what applies); the choice is kept for label and email.
      {
        text: "show separately",
        title: "In a Done group at the end",
        current: doneMode === "separate" || (doneMode === "inline" && filter.groupBy === "due"),
        pick: () => (doneMode = "separate"),
      },
    ]),
    // Inline there is no Done group to hold its Sort switch: it comes here.
    ...(filter.doneInline ? [doneSortSwitch()] : [])
  );
}

/** The Done group's order (D38): when finished, due date, label. */
function doneSortSwitch(): HTMLElement {
  const options: [DoneSort, string, string][] = [
    ["finished-desc", "latest done", "Finished most recently first"],
    ["finished-asc", "earliest done", "Finished longest ago first"],
    ["due-asc", "due ↑", "Earliest due date first"],
    ["due-desc", "due ↓", "Latest due date first"],
    ["label", "label", "Alphabetically by label"],
  ];
  return segmented(
    "Sort",
    options.map(([key, text, title]) => ({ text, title, current: filter.doneSort === key, pick: () => (filter.doneSort = key) }))
  );
}

/** A labelled switch of two or more buttons; `disabled`: greyed out, with that explanation. */
function segmented(
  label: string,
  options: { text: string; title: string; current: boolean; pick(): void; disabled?: string }[],
  disabled: string | null = null
): HTMLElement {
  const box = document.createElement("span");
  box.className = `switch${disabled ? " disabled" : ""}`;
  if (disabled) box.title = disabled;
  box.append(label);
  for (const o of options) {
    const b = document.createElement("button");
    b.textContent = o.text;
    b.title = disabled ?? o.disabled ?? o.title;
    b.disabled = !!(disabled ?? o.disabled);
    b.className = o.current ? "current" : "";
    b.addEventListener("click", () => {
      o.pick();
      savePrefs();
      render();
    });
    box.append(b);
  }
  return box;
}

/** The sender's name, then the address in a lighter grey (once, when there is no name). */
function senderParts(name: string, address: string): (string | HTMLElement)[] {
  if (!address || address === name) return name ? [name] : [];
  const a = document.createElement("span");
  a.className = "address";
  a.textContent = address;
  return name ? [name, " ", a] : [a];
}

/** Each row's task and checkbox, for the right-click menu. */
const entries = new WeakMap<Element, { task: TaskEntry; box: HTMLButtonElement }>();

/** The task's email, with its note open for editing at the task (D38). */
function openTaskEmail(task: TaskEntry): void {
  void messenger.runtime.sendMessage({ type: "openEmail", messageId: task.messageId, noteId: task.noteId, line: task.line });
}

/** A link in a task: emails open in Thunderbird, web addresses in the browser. */
function openUrl(url: string): void {
  const messageId = messageIdOf(url);
  if (messageId) void messenger.runtime.sendMessage({ type: "openEmail", messageId });
  else if (/^(?:https?:|mailto:)/i.test(url)) void messenger.windows.openDefaultBrowser(url);
}

/** With `withEmail` false (grouped by email, the heading names it): only "open note" and the passage. */
function entry(task: TaskEntry, withEmail = true, sectionId = ""): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `entry${task.done ? " done" : ""}`;
  // The same task after a redraw (it may sit in more than one section when grouped by label).
  li.dataset.key = `t:${task.messageId}|${task.noteId}|${task.line}|${sectionId}`;
  // The same drawn box as in the email (green with a white tick when done), as a button.
  const box = document.createElement("button");
  box.className = `tn-box${task.done ? " tn-box-done" : ""}`;
  box.setAttribute("role", "checkbox");
  box.setAttribute("aria-checked", String(task.done));
  box.title = task.done ? "Mark as not done" : "Mark as done";
  box.addEventListener("click", () => void tick(task, !task.done, box));

  const body = document.createElement("div");
  body.className = "body";
  const text = document.createElement("div");
  text.className = "text";
  // Rendered as the checklist item it is, so dates and labels look as in the note (its box is hidden).
  text.innerHTML = renderMarkdown(`- [${task.done ? "x" : " "}] ${task.text}`);
  inertLinks(text);
  // A task with sub-tasks: how many of them are done ("2/5"), at the end of its text.
  if (task.children.length) {
    const count = document.createElement("span");
    count.className = "subcount";
    count.textContent = `${task.childrenDone}/${task.children.length}`;
    count.title = `${task.childrenDone} of ${task.children.length} sub-task${task.children.length === 1 ? "" : "s"} done (select the task to see lines to them)`;
    (text.querySelector("li > p:last-child") ?? text.querySelector("li") ?? text).append(" ", count);
  }
  const meta = document.createElement("div");
  meta.className = "meta";
  // A sub-task: what it is part of (a task: a click selects it; a plain bullet: its text only).
  if (task.partOf) {
    const part = document.createElement(task.parentKey ? "a" : "span");
    part.className = "partof";
    part.textContent = `↳ part of “${task.partOf.length > 50 ? `${task.partOf.slice(0, 50).trimEnd()}…` : task.partOf}”`;
    if (task.parentKey) {
      const key = task.parentKey;
      part.title = "Select the task this is part of";
      part.addEventListener("click", (e) => {
        e.stopPropagation();
        const parent = rowsOf(key)[0];
        if (parent) select(parent);
        else notice("That task isn't shown with the current filter.");
      });
    }
    meta.append(part, " · ");
  }
  const open = document.createElement("a");
  if (withEmail) {
    const subject = document.createElement("span");
    subject.className = "subject";
    subject.textContent = task.subject;
    open.append(subject);
    const date = task.emailDate ? formatDue(isoDate(new Date(task.emailDate))) : ""; // stored in UTC: the local day
    if (task.sender || date) open.append(" – ");
    open.append(...senderParts(task.sender, task.senderAddress));
    if (date) open.append(`${task.sender ? ", " : ""}${date}`);
  } else {
    open.append("Open note");
  }
  open.title = "Open the email, with this note open for editing";
  open.addEventListener("click", () => openTaskEmail(task));
  meta.append(open);
  if (task.quote) {
    const quote = document.createElement("span");
    quote.className = "quote";
    quote.textContent = ` · on “${task.quote.length > 60 ? `${task.quote.slice(0, 60).trimEnd()}…` : task.quote}”`;
    meta.append(quote);
  }
  body.append(text, meta);
  // The whole note, read-only, below the task (the arrow on the right, or → / ← when selected).
  const toggle = document.createElement("button");
  toggle.className = "expand";
  toggle.title = "Show the whole note";
  toggle.textContent = "▸";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setExpanded(task, !expanded.has(taskKey(task)));
  });
  if (expanded.has(taskKey(task))) showNote(li, body, toggle, task);
  li.append(box, body, toggle);
  draggableLabels(li, task);
  entries.set(li, { task, box });
  return li;
}

/**
 * Links keep their look but lose their address to Thunderbird: it opened an email link (mid:)
 * on its own as well as our click did, so the email opened twice. Ours opens it (data-href).
 */
function inertLinks(root: HTMLElement): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    a.dataset.href = a.getAttribute("href")!;
    a.title ||= a.dataset.href.replace(/^mid:.*/i, "Open the email");
    a.removeAttribute("href");
  }
}

/** Tasks shown with their whole note (by key; kept across redraws, not stored). */
const expanded = new Set<string>();

function setExpanded(task: TaskEntry, on: boolean): void {
  if (on) expanded.add(taskKey(task));
  else expanded.delete(taskKey(task));
  render();
}

function showNote(li: HTMLElement, body: HTMLElement, toggle: HTMLElement, task: TaskEntry): void {
  li.classList.add("expanded");
  toggle.textContent = "▾";
  toggle.title = "Hide the note";
  const note = document.createElement("div");
  note.className = "note-preview";
  note.innerHTML = renderMarkdown(task.noteMd);
  inertLinks(note);
  body.append(note);
}

async function tick(task: TaskEntry, done: boolean, box: HTMLButtonElement): Promise<void> {
  box.disabled = true;
  box.classList.toggle("tn-box-done", done); // at once; the list redraws when the note is saved
  const ok = await send(task, done, task.raw);
  if (!ok) {
    notice("This task was changed in the meantime. The list is up to date again.");
    return load();
  }
  // Undo for a moment: the ticked task leaves the list (unless done tasks are shown).
  const raw = markDone(task.raw, done); // as written now: with or without the finished date
  notice(done ? "Marked as done." : "Marked as not done.", () => void send({ ...task, raw }, !done, raw).then(() => load()));
  await load();
}

// ---- quick actions (D38): one task's due date or labels, rewritten like ticking ----------------

const dayFromToday = (n: number) => {
  const t = new Date();
  return isoDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
};

/** On a task (not on one of its dates or labels): add a date or a label. */
function quickActions(task: TaskEntry, row: HTMLElement): MenuItem[] {
  const add = (iso: string, said: string): MenuItem => ({ label: said, run: () => applyEdit(task, { kind: "due", iso }, `Date ${formatDue(iso)} added.`) });
  return [
    { ...add(dayFromToday(0), "Add date today"), separator: true },
    add(dayFromToday(1), "Add date tomorrow"),
    add(dayFromToday(7), "Add date in a week"),
    { label: "Add date…", run: () => askInline(row, "date", task) },
    { label: "Add label…", separator: true, run: () => askInline(row, "label", task) },
  ];
}

/** On a date in a task: change it or remove it (that occurrence: `nth`, should the date be there twice). */
function dateActions(task: TaskEntry, row: HTMLElement, date: string, nth: number): MenuItem[] {
  const change = (iso: string, said: string): MenuItem => ({
    label: said,
    run: () => applyEdit(task, { kind: "due", iso, from: date, nth }, `Date changed to ${formatDue(iso)}.`),
  });
  return [
    change(dayFromToday(0), "Change to today"),
    change(dayFromToday(1), "Change to tomorrow"),
    change(dayFromToday(7), "Change to next week"),
    { label: "Change to…", run: () => askInline(row, "date", task, date, nth) },
    { label: "Remove this date", separator: true, run: () => applyEdit(task, { kind: "due", iso: null, from: date, nth }, "Date removed.") },
  ];
}

/** Sends a change; on success says so with Undo (the task's lines put back), else updates the list. */
async function applyEdit(task: TaskEntry, edit: TaskEdit, done: string): Promise<void> {
  const where = { type: "editTask", messageId: task.messageId, noteId: task.noteId, line: task.line };
  const result = await messenger.runtime
    .sendMessage<{ before: string[]; after: string[] } | null>({ ...where, raw: task.raw, edit })
    .catch(() => null);
  if (!result) {
    notice("This task was changed in the meantime. The list is up to date again.");
    return load();
  }
  notice(done, () => {
    const undo: TaskEdit = { kind: "restore", block: result.before, current: result.after };
    void messenger.runtime.sendMessage({ ...where, raw: result.after[0], edit: undo }).then(() => load());
  });
  await load();
}

/**
 * A small field at the task: a date word (fri, 3d, 24.10.; the date it means shows as you type)
 * or a label (those used before suggested). Enter applies, Esc or leaving cancels.
 */
/** The field open at a task, to close it (without redrawing) when another one opens. */
let closeOpenField: ((reload: boolean) => void) | null = null;

/** The task's row on screen now (the list may have been drawn again since the menu opened). */
function currentRow(row: HTMLElement, task: TaskEntry): HTMLElement | null {
  if (row.isConnected) return row;
  const same = (t: TaskEntry) => t.messageId === task.messageId && t.noteId === task.noteId && t.line === task.line;
  return [...document.querySelectorAll<HTMLElement>("#groups li.entry")].find((li) => {
    const e = entries.get(li);
    return e && same(e.task);
  }) ?? null;
}

function askInline(target: HTMLElement, kind: "date" | "label", task: TaskEntry, from?: string, nth?: number): void {
  // Another field still open: closed first, without catching up on a reload (that would draw
  // the rows anew and leave this field in a row no longer shown); this one catches up instead.
  closeOpenField?.(false);
  const row = currentRow(target, task);
  if (!row) return;
  row.querySelector(".ask")?.remove();
  const box = document.createElement("div");
  box.className = "ask";
  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.placeholder = kind === "date" ? "Date: today, fri, 3d, 24.10. …" : "Label";
  const hint = document.createElement("span");
  hint.className = "hint";
  box.append(kind === "date" ? "@" : "#", input, hint);
  // Labels: our own list of those used before (the browser's was narrow and hard to read):
  // starting with what is typed first, then containing it; arrow keys, Enter or a click pick.
  // In the label row's order (labels only on hidden done tasks after them).
  const all = labelCounts(tasks, true).map((l) => l.label);
  const own = task.labels.map((l) => l.toLowerCase());
  const known = kind === "label" ? [...shownOrder, ...all.filter((l) => !shownOrder.includes(l))].filter((l) => !own.includes(l)) : [];
  const list = document.createElement("ul");
  list.className = "suggest";
  let options: string[] = [];
  let selected = -1;
  const showList = () => {
    const typed = input.value.trim().replace(/^#/, "").toLowerCase();
    options = known.filter((l) => l.includes(typed)); // all of them: the list scrolls
    selected = Math.min(selected, options.length - 1);
    list.replaceChildren(
      ...options.map((l, i) => {
        // A full-width row (hovered or chosen: grey across), the label as a chip in its colour.
        const li = document.createElement("li");
        li.className = i === selected ? "selected" : "";
        li.dataset.label = l;
        const chip = document.createElement("span");
        chip.className = "tn-chip tn-label";
        chip.dataset.label = l;
        chip.textContent = `#${spelled(l)}`;
        chip.title = `#${spelled(l)}`; // the whole name, should a long one be cut off
        li.append(chip);
        li.addEventListener("mousedown", (e) => e.preventDefault()); // keep the field's focus
        // Hovered: highlighted, and the one Enter or Tab takes.
        li.addEventListener("mouseenter", () => {
          selected = i;
          for (const [k, other] of [...list.children].entries()) other.classList.toggle("selected", k === i);
        });
        li.addEventListener("click", (e) => {
          e.stopPropagation(); // not a click on a label in the list (which would filter by it)
          pick(spelled(l));
        });
        return li;
      })
    );
    list.hidden = !options.length;
    list.style.left = `${input.offsetLeft}px`;
    list.style.width = `${input.offsetWidth}px`;
    (list.children[selected] as HTMLElement | undefined)?.scrollIntoView?.({ block: "nearest" }); // (not in the tests' jsdom)
  };
  const pick = (label: string) => {
    close();
    void applyEdit(task, { kind: "addLabel", label }, `#${label} added.`);
  };
  if (kind === "label") {
    box.append(list);
    input.addEventListener("input", showList);
    input.addEventListener("keydown", (e) => {
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && options.length) {
        e.preventDefault();
        selected = (selected + (e.key === "ArrowDown" ? 1 : options.length - 1) + (selected < 0 && e.key === "ArrowUp" ? 1 : 0)) % options.length;
        showList();
      } else if ((e.key === "Enter" || e.key === "Tab") && selected >= 0 && options[selected]) {
        e.preventDefault();
        e.stopImmediatePropagation(); // taken from the list, not the typed text
        pick(spelled(options[selected]!));
      }
    });
  }
  const value = () => {
    const word = input.value.trim().replace(/^[@#]/, "");
    if (kind === "date") return parseDateWord(word);
    return /^[\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*$/u.test(word) ? word : null;
  };
  input.addEventListener("input", () => {
    const v = value();
    hint.textContent = !input.value.trim() ? "" : kind === "date" ? (v ? `→ ${formatDue(v)}` : "not a date") : v ? "" : "letters, digits, - _ /";
  });
  let done = false;
  const close = (reload = true) => {
    done = true;
    box.remove();
    if (closeOpenField === close) closeOpenField = null;
    if (reload && reloadPending) void load();
  };
  closeOpenField = close;
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") return close();
    // Tab finishes too (as Enter), and doesn't move on.
    if (e.key !== "Enter" && e.key !== "Tab") return;
    e.preventDefault();
    const v = value();
    if (!v) return;
    close();
    void (kind === "date"
      ? applyEdit(task, { kind: "due", iso: v, from, nth }, from ? `Date changed to ${formatDue(v)}.` : `Date ${formatDue(v)} added.`)
      : applyEdit(task, { kind: "addLabel", label: v }, `#${v} added.`));
  });
  input.addEventListener("blur", () => setTimeout(() => !done && close(), 150));
  row.querySelector(".body")!.append(box);
  input.focus();
  if (kind === "label") showList();
}

function send(task: TaskEntry, done: boolean, raw: string): Promise<boolean> {
  return messenger.runtime
    .sendMessage<boolean>({ type: "setTaskDone", messageId: task.messageId, noteId: task.noteId, line: task.line, raw, done })
    .catch(() => false);
}

let noticeTimer = 0;
function notice(message: string, undo?: () => void): void {
  const el = $("notice");
  el.replaceChildren(message);
  if (undo) {
    const button = document.createElement("button");
    button.textContent = "Undo";
    button.className = "undo";
    button.addEventListener("click", () => {
      el.style.display = "none";
      undo();
    });
    el.append(" ", button);
  }
  el.style.display = "block";
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (el.style.display = "none"), 6000);
}

// Links in a task: emails open in Thunderbird, web addresses in the browser; a label in a task
// is included or taken out again (no "exclude" step: that's for the chips at the top).
$("groups").addEventListener("click", (e) => {
  const target = e.target as Element;
  if (target.closest(".ask")) return; // a field at a task: its own clicks
  // A date in a task: filter by it (again: off).
  const date = target.closest<HTMLElement>(".tn-date[data-date]");
  if (date) {
    e.preventDefault();
    return toggleDateToken(`@${date.dataset.date!}`);
  }
  const label = target.closest(".tn-label");
  if (label) {
    e.preventDefault();
    return includeLabel(label.textContent!.replace(/^#/, ""));
  }
  const link = target.closest<HTMLElement>("a[data-href]");
  if (!link) return;
  e.preventDefault();
  openUrl(link.dataset.href!);
});

// The filter (D38): words, all of which must be in the task, its email's subject or sender, or
// its passage. Dates are words too (`@2026-10-24`, `@2026-10`, `@2026`, as in the text): typed
// with the same suggestions as in notes or clicked in a task, they show as tokens before the
// field ("@Fri 24 Oct"). While it filters, the pill is tinted and offers ×.
let dateTokens: string[] = [];

function syncFilter(): void {
  filter.text = [...dateTokens, filterBox.value].join(" ").trim();
  const tokens = $("dateTokens");
  tokens.replaceChildren(
    ...dateTokens.map((word) => {
      // Click: back to its text, selected (type over it, Backspace, or Esc/Space/Tab to keep it);
      // the ×: gone at once.
      const token = document.createElement("span");
      token.className = "token";
      token.textContent = dateFilterLabel(word);
      token.title = `${word}: click to edit`;
      token.addEventListener("click", (e) => {
        e.preventDefault();
        editDateToken(word);
      });
      const x = document.createElement("span");
      x.className = "x";
      x.textContent = "×";
      x.title = "Remove";
      x.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeDateToken(word);
        filterBox.focus(); // so Cmd/Ctrl+Z reaches the filter
      });
      token.append(x);
      return token;
    })
  );
  const on = !!filter.text;
  $("search").classList.toggle("active", on);
  $("search").classList.toggle("invalid", hasInvalidRegex(filter.text)); // a /regex/ that isn't valid (yet)
  $("clearFilter").hidden = !on;
  render();
}

function setFilterText(text: string): void {
  filterBox.value = text;
  syncFilter();
}

/** A date word to the tokens (once); clicked in a task again, it goes. */
function addDateToken(word: string): void {
  if (!dateTokens.includes(word)) dateTokens = [...dateTokens, word];
  syncFilter();
}
function removeDateToken(word: string): void {
  remember();
  dateTokens = dateTokens.filter((w) => w !== word);
  syncFilter();
}

// Undo for what the field's own undo doesn't know: a token removed, or the filter cleared (× or
// Esc). Cmd/Ctrl+Z right after brings the filter back; once typed on, it undoes the typing again.
let filterHistory: { tokens: string[]; text: string }[] = [];
function remember(): void {
  filterHistory = [...filterHistory.slice(-19), { tokens: [...dateTokens], text: filterBox.value }];
}
function undoFilter(): boolean {
  const last = filterHistory.pop();
  if (!last) return false;
  dateTokens = last.tokens;
  setFilterText(last.text);
  filterBox.focus();
  return true;
}
/** A token being edited as text: the word, and the field as it was before (Esc goes back to that). */
let editing: { word: string; before: string; inserted: string } | null = null;

function editDateToken(word: string): void {
  finishEditing();
  remember();
  const before = filterBox.value;
  const inserted = before ? `${before} ${word}` : word;
  dateTokens = dateTokens.filter((w) => w !== word);
  editing = { word, before, inserted };
  filterBox.value = inserted;
  syncFilter();
  filterBox.focus();
  filterBox.setSelectionRange(inserted.length - word.length, inserted.length);
}

/** Esc while editing a token: it goes back as it was (also after typing). */
function cancelEditing(): void {
  if (!editing) return;
  const { word, before } = editing;
  editing = null;
  filterBox.value = before;
  addDateToken(word);
}

/** Leaving the field: unchanged, the token comes back; a date word typed last becomes a token. */
function finishEditing(): void {
  if (!editing) return;
  if (filterBox.value === editing.inserted) return cancelEditing();
  editing = null;
  const m = /(?:^|\s)(@[^\s]+)$/.exec(filterBox.value);
  const date = m && asDateWord(m[1]!);
  if (date) {
    filterBox.value = filterBox.value.slice(0, filterBox.value.length - m![0].length).trimEnd();
    addDateToken(date);
  }
}

function toggleDateToken(word: string): void {
  if (dateTokens.includes(word)) removeDateToken(word);
  else addDateToken(word);
}

/**
 * A finished word in the field that is a date: `@2026`, `@2026-10`, `@2026-10-24`, or a date word
 * as in notes (`@fri`, `@morgen`, `@3d`, `@24.10.`; two-letter ones only from the list).
 */
function asDateWord(word: string): string | null {
  if (dateFilterWord(word)) return word;
  const w = word.replace(/^@/, "");
  if (!word.startsWith("@") || (!/\d/.test(w) && w.length < 3)) return null;
  const month = monthWord(w); // "@jan", "@oktober": that month this year
  if (month) return month;
  const iso = parseDateWord(w);
  return iso ? `@${iso}` : null;
}

// Suggestions while typing "@…", as in notes: today, tomorrow, weekdays, 3d … (arrow keys, Enter
// or Tab take one; a finished date word followed by a space becomes a token by itself).
const dateList = document.createElement("ul");
dateList.className = "suggest date-suggest";
dateList.hidden = true;
$("search").append(dateList);
/** A suggestion: the filter word it becomes, how it shows, and a hint (what was typed means). */
let dateOptions: { word: string; label: string; hint: string }[] = [];
let dateSelected = 0;

function currentWord(): string {
  return /(?:^|\s)(@[^\s]*)$/.exec(filterBox.value)?.[1] ?? "";
}

function showDateList(): void {
  const word = currentWord();
  // Days as in notes, then months (of this year) whose name starts with what is typed.
  const typed = word.slice(1);
  dateOptions = word
    ? [
        ...dateSuggestions(typed).map((o) => ({ word: `@${o.iso}`, label: formatDue(o.iso), hint: o.hint === typed ? o.iso : o.hint })),
        ...monthWords(typed).map((w) => ({ word: w, label: dateFilterLabel(w).slice(1), hint: "month" })),
      ]
    : [];
  dateSelected = Math.min(dateSelected, Math.max(0, dateOptions.length - 1));
  dateList.replaceChildren(
    ...dateOptions.map((o, i) => {
      const li = document.createElement("li");
      li.className = i === dateSelected ? "selected" : "";
      li.textContent = o.label;
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = o.hint;
      li.append(hint);
      li.addEventListener("mousedown", (e) => e.preventDefault());
      li.addEventListener("mouseenter", () => {
        dateSelected = i;
        for (const [k, other] of [...dateList.children].entries()) other.classList.toggle("selected", k === i);
      });
      li.addEventListener("click", (e) => {
        e.preventDefault();
        takeDate(o.word);
      });
      return li;
    })
  );
  dateList.hidden = !dateOptions.length;
}

/** The "@…" being typed replaced by its date (a day or month) as a token. */
function takeDate(word: string): void {
  filterBox.value = filterBox.value.replace(/(?:^|\s)@[^\s]*$/, "").trimEnd();
  dateList.hidden = true;
  editing = null;
  addDateToken(word);
  filterBox.focus();
}

filterBox.addEventListener("input", () => {
  filterHistory = []; // typed on: Cmd/Ctrl+Z undoes the typing (the field's own undo)
  // A finished date word (a space after it) becomes a token.
  const m = /(?:^|\s)(@[^\s]+)\s$/.exec(filterBox.value);
  // Inside a quoted phrase a date word stays text (it belongs to the phrase).
  const date = m && !inQuote(filterBox.value.slice(0, m.index)) && asDateWord(m[1]!);
  if (date) {
    filterBox.value = filterBox.value.slice(0, filterBox.value.length - m![0].length).trimEnd();
    dateList.hidden = true;
    editing = null;
    addDateToken(date);
    return;
  }
  showDateList();
  syncFilter();
});
filterBox.addEventListener("blur", () =>
  setTimeout(() => {
    dateList.hidden = true;
    if (document.activeElement !== filterBox) finishEditing();
  }, 150)
);
filterBox.addEventListener("keydown", (e) => {
  // Tab or Enter after a year or month (no single day to suggest): a token, as with a space.
  if ((e.key === "Tab" || e.key === "Enter") && (dateList.hidden || !dateOptions.length)) {
    const word = currentWord();
    const date = word ? (dateFilterWord(word) ? word : monthWord(word.slice(1))) : null;
    if (!date) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    filterBox.value = filterBox.value.replace(/(?:^|\s)@[^\s]*$/, "").trimEnd();
    editing = null;
    addDateToken(date);
    return;
  }
  if (dateList.hidden || !dateOptions.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    dateSelected = (dateSelected + (e.key === "ArrowDown" ? 1 : dateOptions.length - 1)) % dateOptions.length;
    showDateList();
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    e.stopImmediatePropagation(); // the date, not a "#label" Enter
    takeDate(dateOptions[dateSelected]!.word);
  } else if (e.key === "Escape" && !editing) {
    e.stopImmediatePropagation();
    dateList.hidden = true;
  }
});
$("clearFilter").addEventListener("click", () => {
  remember();
  dateTokens = [];
  setFilterText("");
  filterBox.focus();
});
// Esc clears it; Backspace in the empty field takes the last date token; Cmd/Ctrl+F gets there.
filterBox.addEventListener("keydown", (e) => {
  // Esc while a token is edited: back to the token (a second Esc then clears).
  if (e.key === "Escape" && editing) {
    e.preventDefault();
    cancelEditing();
  } else if (e.key === "Escape" && filter.text) {
    e.preventDefault();
    remember();
    dateTokens = [];
    setFilterText("");
  } else if (e.key === "Backspace" && !filterBox.value && dateTokens.length) {
    removeDateToken(dateTokens.at(-1)!);
  }
});
// Cmd/Ctrl+Z for the filter's own steps, caught first on the whole page (before Thunderbird's own
// undo, wherever the cursor is) as long as there is one; else the usual undo.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key.toLowerCase() !== "z" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || !filterHistory.length) return;
    if (document.activeElement?.closest?.(".ask")) return; // a field at a task: its own undo
    e.preventDefault();
    e.stopPropagation();
    undoFilter();
  },
  true
);
// The field's right-click menu: ours (Thunderbird's only knows the typing, its Undo stayed grey
// after a token was removed): Undo (tokens too), Cut, Copy, Paste (plain text), Select All.
attachEditMenu(
  {
    element: filterBox,
    selectedText: () => filterBox.value.slice(filterBox.selectionStart ?? 0, filterBox.selectionEnd ?? 0),
    replaceSelection: (text) => {
      filterBox.setRangeText(text, filterBox.selectionStart ?? 0, filterBox.selectionEnd ?? 0, "end");
      filterBox.dispatchEvent(new Event("input")); // the filter follows (a date word becomes a token)
    },
    selectAll: () => filterBox.select(),
  },
  document.body,
  { read: () => navigator.clipboard.readText(), write: (text) => navigator.clipboard.writeText(text) },
  [],
  () => [
    {
      label: "Undo",
      kbd: `${MOD}Z`,
      enabled: filterHistory.length > 0 || canUndoTyping(),
      run: () => {
        if (!undoFilter()) {
          filterBox.focus();
          document.execCommand("undo"); // the typing
        }
      },
    },
  ],
  false
);

/** Whether the field's own undo has typing to undo (as far as the browser says). */
function canUndoTyping(): boolean {
  try {
    filterBox.focus();
    return document.queryCommandEnabled("undo");
  } catch {
    return false;
  }
}

// Enter (when it has nothing else to do) or leaving the field: the filter written out as it is
// understood (brackets closed, a dangling OR left out, brackets around an OR among other terms),
// so it reads as meant when you come back to it. Cmd/Ctrl+Z brings back what was typed.
function tidyFilter(): void {
  const tidy = normaliseFilter(filterBox.value);
  if (tidy === filterBox.value.trim()) return;
  remember();
  setFilterText(tidy);
}
filterBox.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.defaultPrevented || typedLabel(filter.text) !== null) return; // "#word": picks the label
  e.preventDefault();
  tidyFilter();
});
filterBox.addEventListener("blur", () =>
  setTimeout(() => {
    if (document.activeElement !== filterBox && !editing) tidyFilter();
  }, 200)
);

// Undo from the Edit menu arrives as an undo request in the field.
filterBox.addEventListener("beforeinput", (e) => {
  if (e.inputType === "historyUndo" && filterHistory.length) {
    e.preventDefault();
    undoFilter();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "f" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    filterBox.focus();
    filterBox.select();
  }
});
// Enter after "#word": that label is chosen and the word leaves the box.
filterBox.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || typedLabel(filter.text) === null) return;
  e.preventDefault();
  const next = document.querySelector<HTMLElement>(".label-chip.next")?.dataset.label;
  if (!next) return;
  filterBox.value = filterBox.value.replace(/(^|\s)#[\p{L}\p{N}_/-]*$/u, "$1").trimEnd();
  syncFilter();
  toggleLabel(next);
});
// The two lines hold more or fewer chips when the window is resized.
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(render, 150);
});

// Label colours (D40): a stylesheet from the colours chosen on any device; right-click a label
// (a chip at the top or one in a task) to choose.
const menuStyle = document.createElement("style");
menuStyle.textContent = EDIT_MENU_CSS;
const labelStyle = document.createElement("style");
document.head.append(menuStyle, labelStyle);
let labelColours: LabelColours = {};
function applyLabelColours(value: unknown): void {
  labelColours = (value as LabelColours | undefined) ?? {};
  labelStyle.textContent = labelColourCss(labelColours);
}
messenger.storage.local.get("labelColours").then((s) => applyLabelColours(s.labelColours));
messenger.storage.local.get("labelOrder").then((s) => {
  labelOrder = (s.labelOrder as LabelOrder | undefined) ?? undefined;
  render();
});
// Right-click: our own menu instead of Thunderbird's page menu (Back, Reload …), which has
// nothing to do with tasks. On a label its colour; on a task what can be done with it; with text
// selected Copy; elsewhere nothing. The filter box keeps the usual text menu (Paste …).
document.addEventListener("contextmenu", (e) => {
  const target = e.target as Element;
  if (target.closest("input, textarea")) return;
  e.preventDefault();
  const chip = target.closest<HTMLElement>(".label-chip[data-label], .tn-label[data-label]");
  const inTask = target.closest("li.entry");
  const found = inTask ? entries.get(inTask) : undefined;
  if (chip) {
    const label = chip.dataset.label!;
    const colour = labelColourItems(label, labelColours[label]?.colour ?? null, (c) => void messenger.runtime.sendMessage({ type: "setLabelColour", label, colour: c }));
    if (found) {
      // A label in a task: about this label here, its colour, or out of this task.
      const { task } = found;
      openMenu(document.body, e, [
        ...colour,
        { label: "Remove label", separator: true, run: () => applyEdit(task, { kind: "removeLabel", label }, `#${label} removed.`) },
      ]);
      return;
    }
    // A chip in the label row: its colour, and its place in the row's order (D40).
    const at = shownOrder.indexOf(label);
    openMenu(document.body, e, [
      ...colour,
      { label: "Move to front", separator: true, enabled: at > 0, run: () => placeLabel(label, 0) },
      { label: "Move left", enabled: at > 0, run: () => placeLabel(label, at - 1) },
      { label: "Move right", enabled: at >= 0 && at < shownOrder.length - 1, run: () => placeLabel(label, at + 1) },
    ]);
    return;
  }
  // A date in a task: change or remove that one.
  const dateChip = target.closest<HTMLElement>(".tn-date[data-date]");
  if (dateChip && found) {
    // Which occurrence of this date in the task (in reading order), should it be there twice.
    const date = dateChip.dataset.date!;
    const nth = [...inTask!.querySelectorAll(`.tn-date[data-date="${date}"]`)].indexOf(dateChip);
    openMenu(document.body, e, dateActions(found.task, inTask as HTMLElement, date, nth));
    return;
  }
  const items: MenuItem[] = [];
  const url = target.closest<HTMLElement>("a[data-href]")?.dataset.href;
  if (url) items.push({ label: messageIdOf(url) ? "Open email" : "Open link", run: () => openUrl(url) });
  const row = inTask;
  if (found) {
    const { task, box } = found;
    items.push(
      { label: "Open email with this note", separator: items.length > 0, run: () => openTaskEmail(task) },
      {
        label: task.done ? "Mark as not done" : "Mark as done",
        run: () => {
          return tick(task, !task.done, box);
        },
      },
      {
        label: "Copy this task as Markdown",
        run: async () => {
          await navigator.clipboard.writeText(await taskAsMarkdown(task, findEmail));
          notice("Task copied as Markdown.");
        },
      },
      ...quickActions(task, row as HTMLElement)
    );
  }
  const selected = document.getSelection()?.toString() ?? "";
  if (selected) items.push({ label: "Copy", kbd: `${MOD}C`, separator: items.length > 0, run: () => navigator.clipboard.writeText(selected) });
  // The whole list as shown (filters, grouping, order) as Markdown, from the background (on a
  // task: that task).
  if (shownSections.length && !found) {
    const count = shownSections.reduce((n, s) => n + s.tasks.length, 0);
    items.push({
      label: `Copy list as Markdown (${count} task${count === 1 ? "" : "s"})`,
      separator: items.length > 0,
      run: async () => {
        await navigator.clipboard.writeText(await listAsMarkdown(shownSections, findEmail));
        notice("List copied as Markdown.");
      },
    });
  }
  if (items.length) openMenu(document.body, e, items);
});

// The setting "Animate changes in the task view" (on unless switched off).
messenger.storage.local.get("tasksAnimate").then((s) => (animate = s.tasksAnimate !== false));

// The setting "Keep the task view's filters at the top while scrolling" (on unless switched off).
function applySticky(value: unknown): void {
  document.body.classList.toggle("sticky-top", value !== false);
}
applySticky(true);
messenger.storage.local.get("tasksStickyTop").then((s) => applySticky(s.tasksStickyTop));

// The setting "Past due dates shown in red" (on unless switched off).
function applyOverdue(value: unknown): void {
  document.body.classList.toggle("no-overdue", value === false);
}
messenger.storage.local.get("pastDatesRed").then((s) => applyOverdue(s.pastDatesRed));
// "Hide the current year in dates" (on by default).
messenger.storage.local.get("hideCurrentYear").then((s) => {
  setAlwaysShowYear(s.hideCurrentYear === false);
  render();
});
messenger.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "pastDatesRed" in changes) applyOverdue(changes.pastDatesRed!.newValue);
  if (area === "local" && "hideCurrentYear" in changes) {
    setAlwaysShowYear(changes.hideCurrentYear!.newValue === false);
    render();
  }
  if (area === "local" && "tasksStickyTop" in changes) applySticky(changes.tasksStickyTop!.newValue);
  if (area === "local" && "tasksAnimate" in changes) animate = changes.tasksAnimate!.newValue !== false;
  if (area === "local" && "tasksKeepOnTick" in changes) keepOnTick = changes.tasksKeepOnTick!.newValue === true;
  if (area === "local" && "labelColours" in changes) applyLabelColours(changes.labelColours!.newValue);
  // Chosen on another device (sync) or stored after a choice here.
  if (area === "local" && "labelOrder" in changes) {
    labelOrder = changes.labelOrder!.newValue as LabelOrder | undefined;
    render();
  }
});

// Notes changed (in an email, by sync, an import): reload, a little later when many change at once.
let reloadTimer = 0;
messenger.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type === "setsChanged") {
    clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => void load(), 200);
    return undefined;
  }
  // The toolbar button asks whether this tab is open, to bring it to the front instead of opening another.
  if (message?.type === "tasksTab") {
    setTimeout(takeFocus, 50); // brought to the front by the Tasks button
    return messenger.tabs.getCurrent().then((tab) => (tab?.id !== undefined ? { tabId: tab.id, windowId: tab.windowId } : undefined));
  }
  return undefined;
});
// Opened or brought to the front: the keyboard focus into the page, so the arrow keys work at
// once (else it stays in Thunderbird's toolbar or tab bar). Not when a field has it already.
function takeFocus(): void {
  const active = document.activeElement;
  if (active && active !== document.body && active.matches?.("input, textarea")) return;
  window.focus();
  document.body.tabIndex = -1;
  document.body.focus({ preventScroll: true });
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") takeFocus();
});
takeFocus();

// A new day: "Today" and "Overdue" move on.
window.addEventListener("focus", () => void load());

void load();
