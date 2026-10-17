/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Renders note Markdown to safe HTML (concept: markdown-it with only the needed
 * rules, DOMPurify because notes may sync from elsewhere). Needs a DOM window
 * for DOMPurify: a background page, an extension page or jsdom.
 *
 * Supported: headings, horizontal rule, bold/italic, ~~strikethrough~~, bullet and numbered lists,
 * `- [ ]` / `- [x]` tasks (drawn boxes, class `tn-box`; no form controls), links (incl. bare URLs), inline code, code blocks,
 * blockquotes. Line structure is kept as written: single line breaks, and every empty line
 * becomes one visible empty line (Markdown would turn any run of them into one paragraph
 * gap). Together with margin-free CSS this lays the note out line for line like the
 * live-preview editor (D28), so a click lands where expected. Raw HTML is shown as text.
 */

import DOMPurify from "dompurify";
import { DONE_DATE, DUE_DATE, LABEL, formatDue, isOverdue, isValidDate, looseDates } from "./tasks.js";
import MarkdownItFactory, { type MarkdownIt, type StateCore } from "markdown-it";

// Created on first use, so bundles that import core but never render stay small.
let md: MarkdownIt | null = null;

function renderer(): MarkdownIt {
  if (md) return md;
  md = MarkdownItFactory("zero", { breaks: true, linkify: true }).enable([
    "heading", "hr", "emphasis", "strikethrough", "list", "link", "linkify", "autolink", "backticks", "fence", "code", "blockquote", "newline",
    // Backslash escapes ("\[" shows "["): missing before, so escaped text showed its backslashes.
    "escape",
  ]);
  md.core.ruler.push("www_links", wwwLinks);
  md.core.ruler.push("tasklist", tasklist);
  md.core.ruler.push("conflict", conflictBox);
  md.core.ruler.push("task_chips", taskChips);
  md.core.ruler.after("block", "sublist_start", sublistStart);
  // Fenced code gets a class: its box has a line of padding where the editor shows the fences.
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (...args) => fence(...args).replace(/^<pre>/, '<pre class="fenced">');
  return md;
}

// "www.example.com" in the text: a link to https://www.example.com, as the editor shows it while
// writing (links with https:// or http:// the linkify rule makes already). Not in links or code.
const WWW = /(^|[\s(\[])(www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#][^\s<]*)?)/gi;

function wwwLinks(state: StateCore): void {
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const out: typeof block.children = [];
    let inLink = 0;
    for (const t of block.children) {
      if (t.type === "link_open") inLink++;
      if (t.type === "link_close") inLink--;
      if (t.type !== "text" || inLink > 0 || !/www\./i.test(t.content)) {
        out.push(t);
        continue;
      }
      let last = 0;
      for (const m of t.content.matchAll(WWW)) {
        // Punctuation at the end belongs to the sentence, not the address.
        const address = m[2]!.replace(/[.,;:!?)\]'"]+$/, "");
        const start = m.index! + m[1]!.length;
        const before = new state.Token("text", "", 0);
        before.content = t.content.slice(last, start);
        const open = new state.Token("link_open", "a", 1);
        open.attrs = [["href", `https://${address}`]];
        const text = new state.Token("text", "", 0);
        text.content = address;
        const close = new state.Token("link_close", "a", -1);
        out.push(before, open, text, close);
        last = start + address.length;
      }
      const rest = new state.Token("text", "", 0);
      rest.content = t.content.slice(last);
      out.push(rest);
    }
    block.children = out;
  }
}

// `- [ ] task` / `- [x] done` list items -> drawn boxes (styled by the client; no form controls inside emails).
function tasklist(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]!;
    if (inline.type !== "inline" || tokens[i - 1]!.type !== "paragraph_open" || tokens[i - 2]!.type !== "list_item_open") {
      continue;
    }
    // Also a box with nothing after it ("- [ ]"; a note's trailing spaces are dropped on save).
    const match = /^\[([ xX])\](?:[  \n]|$)/.exec(inline.content);
    const first = inline.children?.[0];
    if (!match || !first || first.type !== "text") continue;
    first.content = first.content.slice(match[0].length);
    const box = new state.Token("html_inline", "", 0);
    box.content =
      // No space after the box: its margin makes up one list marker width (client CSS).
      match[1] === " " ? '<span class="task-box tn-box"></span>' : '<span class="task-box tn-box tn-box-done"></span>';
    inline.children!.unshift(box);
    tokens[i - 2]!.attrJoin("class", match[1] === " " ? "task" : "task task-done");
  }
}

// Due dates `@2026-10-24` and labels `#name` (D38) as lozenges ("chips"), also in a link's text
// (not in code, which is its own token type, nor in link addresses, which aren't text tokens). Dates show as "Sat 24 Oct" (the year when it isn't this
// year), with the full date as tooltip. Only dates in an open checklist item's own text are due
// dates; past ones get "tn-overdue". Dates elsewhere (text, ticked tasks, sub-items) are references.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function taskChips(state: StateCore): void {
  const today = new Date();
  state.tokens.forEach((block, i) => {
    if (block.type !== "inline" || !block.children) return;
    const item = state.tokens[i - 2];
    const openTask = item?.type === "list_item_open" && item.attrGet("class") === "task";
    const out: typeof block.children = [];
    for (const t of block.children) {
      if (t.type !== "text" || (!t.content.includes("@") && !t.content.includes("#") && !t.content.includes("✅"))) {
        out.push(t);
        continue;
      }
      // Dates and labels in one pass, in order of appearance; "@" dates that aren't ISO yet get
      // a dotted underline saying what they would mean (they aren't due dates until converted).
      const found: { start: number; end: number; html: string }[] = [];
      const pattern = new RegExp(`${DUE_DATE.source}|${LABEL.source}`, "gu");
      for (const m of t.content.matchAll(pattern)) {
        const start = m.index! + (m[1] ?? m[3] ?? "").length;
        let html: string;
        if (m[2] && !isValidDate(m[2])) {
          // Shaped like a date but impossible (month 13, 30 February): text, marked as such.
          html = `<span class="tn-loose-date" title="Not a valid date">@${esc(m[2])}</span>`;
        } else if (m[2]) {
          const full = new Date(`${m[2]}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
          // data-date: which date it is (the task view's menu changes or removes that one).
          html = `<span class="tn-chip tn-date${openTask && isOverdue(m[2], today) ? " tn-overdue" : ""}" data-date="${m[2]}" title="${esc(full)}">${esc(formatDue(m[2], today))}</span>`;
        } else {
          // data-label (lower case) for the label's colour (D40).
          html = `<span class="tn-chip tn-label" data-label="${esc(m[4]!.toLowerCase())}">#${esc(m[4]!)}</span>`;
        }
        found.push({ start, end: m.index! + m[0].length, html });
      }
      // When a task was finished: "done Sat 17 Oct", small and grey.
      for (const m of t.content.matchAll(new RegExp(DONE_DATE.source, "gu"))) {
        if (!isValidDate(m[1]!)) {
          found.push({ start: m.index!, end: m.index! + m[0].length, html: `<span class="tn-loose-date" title="Not a valid date">${esc(m[0])}</span>` });
          continue;
        }
        const full = new Date(`${m[1]}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        found.push({ start: m.index!, end: m.index! + m[0].length, html: `<span class="tn-done-date" title="Done on ${esc(full)}">done ${esc(formatDue(m[1]!, today))}</span>` });
      }
      for (const d of looseDates(t.content, today)) {
        if (found.some((f) => d.from < f.end && d.to > f.start)) continue;
        const title = `Not a date reference yet: would be ${formatDue(d.iso, today)}. In the editor, right-click it → Convert to date.`;
        found.push({ start: d.from, end: d.to, html: `<span class="tn-loose-date" title="${esc(title)}">${esc(t.content.slice(d.from, d.to))}</span>` });
      }
      found.sort((a, b) => a.start - b.start);
      let last = 0;
      for (const f of found) {
        const before = new state.Token("text", "", 0);
        before.content = t.content.slice(last, f.start);
        out.push(before);
        const chip = new state.Token("html_inline", "", 0);
        chip.content = f.html;
        out.push(chip);
        last = f.end;
      }
      const rest = new state.Token("text", "", 0);
      rest.content = t.content.slice(last);
      out.push(rest);
    }
    block.children = out;
  });
}

// `> [!conflict] …` (D32): the quote gets the class "tn-conflict"; the marker itself is hidden.
function conflictBox(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i]!.type !== "blockquote_open" || tokens[i + 1]!.type !== "paragraph_open") continue;
    const inline = tokens[i + 2]!;
    const first = inline.children?.[0];
    if (inline.type !== "inline" || !first || first.type !== "text" || !first.content.startsWith("[!conflict]")) continue;
    first.content = first.content.slice("[!conflict]".length).trimStart();
    tokens[i]!.attrJoin("class", "tn-conflict");
    tokens[i + 1]!.attrJoin("class", "tn-conflict-title");
  }
}

/** Web and mail links, and links to emails by Message-ID (mid:, D37). */
const SAFE_URL = /^(?:https?:|mailto:|mid:)/i;

/**
 * Every empty line (outside fenced code) becomes a paragraph holding a no-break space, which
 * Markdown doesn't treat as blank, so it renders as exactly one empty line.
 */
function keepEmptyLines(source: string): string {
  let inFence = false;
  const out: string[] = [];
  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    // Blank lines around it keep the no-break space its own paragraph.
    if (!inFence && line.trim() === "") out.push("", "\u00a0", "");
    else out.push(line);
  }
  return out.join("\n");
}

/**
 * A numbered list right under a list item may start at any number (D28; e.g. sub-points
 * numbered on from the item before). CommonMark requires 1 there (else its lines are text of
 * the item), so such a first marker is written as 1 for parsing and its number restored as
 * the list's `start` (sublistStart). Not after ordinary text: "…is\n14. The …" stays text.
 */
function anyStartSublists(source: string, env: { starts?: Record<number, number> }): string {
  const lines = source.split("\n");
  const starts: Record<number, number> = {};
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^(\s*)(\d{1,9})([.)])(?=\s|$)/.exec(line);
    if (!m || Number(m[2]) === 1) continue;
    // Up through the item's own lines to the item it sits under (less indented).
    for (let k = i - 1; k >= 0 && lines[k]!.trim(); k--) {
      const item = /^(\s*)(?:[-*+]|\d{1,9}[.)])(?=\s|$)/.exec(lines[k]!);
      if (!item) continue;
      if (item[1]!.length < m[1]!.length) {
        starts[i] = Number(m[2]);
        lines[i] = `${m[1]}1${line.slice(m[1]!.length + m[2]!.length)}`;
      }
      break;
    }
  }
  env.starts = starts;
  return lines.join("\n");
}

function sublistStart(state: StateCore): void {
  const starts = (state.env as { starts?: Record<number, number> }).starts ?? {};
  for (const token of state.tokens) {
    const start = token.type === "ordered_list_open" && token.map ? starts[token.map[0]] : undefined;
    if (start !== undefined) token.attrSet("start", String(start));
  }
}

/** Markdown -> sanitised HTML. Only http(s) and mailto links survive. */
export function renderMarkdown(source: string): string {
  const env: { starts?: Record<number, number> } = {};
  const html = renderer().render(anyStartSublists(keepEmptyLines(source), env), env);
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: SAFE_URL,
    ALLOWED_TAGS: [
      "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "s", "ul", "ol", "li",
      "a", "code", "pre", "blockquote", "span",
    ],
    ALLOWED_ATTR: ["href", "title", "class", "start"],
    // A list's first number: DOMPurify checks other attributes' values like links and dropped it.
    ADD_URI_SAFE_ATTR: ["start"],
  });
}
