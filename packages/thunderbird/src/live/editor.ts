/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Live-preview Markdown editor for note cards (D28): a slim CodeMirror 6 (core + @lezer/markdown)
// that shows Markdown formatted and reveals the markup only on lines with the cursor or a
// selection, Obsidian-style. Built as its own bundle (dist/live-editor.js) and loaded with
// import() only when editing starts (live-loader.ts).

import { Annotation, EditorSelection, EditorState, StateEffect, StateField, type ChangeSpec, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { Language, defineLanguageFacet, syntaxTree } from "@codemirror/language";
import { Autolink, Strikethrough, TaskList, parser } from "@lezer/markdown";
import { cycleTask, expandTaskShortcut, toggleBullets, toggleChecklist, toggleNumbered } from "../checklist.js";
import { MOD, attachEditMenu, opensLink, type Clipboard, type MenuItem } from "../edit-menu.js";
import { DONE_DATE, DUE_DATE, LABEL, formatDue, isOverdue, isValidDate, looseDates, markDone, parseDateWord, setAlwaysShowYear } from "@thundernotes/core";
import { isUrl, linkForPaste, markdownLink, splitForLink, webUrl } from "../links.js";
import type { EmailCandidate } from "../protocol.js";
import { openLinkPicker } from "./link-picker.js";
import { suggestions } from "./suggest.js";

export interface LiveEditorOptions {
  parent: HTMLElement;
  /** The (shadow) root the editor lives in, for its styles. */
  root: ShadowRoot;
  doc: string;
  /** Ctrl/Cmd+Enter: done editing. */
  onDone(): void;
  /** Esc: discard this editing session. */
  onCancel(): void;
  /** Focus left the editor (clicked elsewhere, switched message or window). */
  onBlur(): void;
  onChange(): void;
  openLink(url: string): void;
  clipboard: Clipboard;
  /** Container for the right-click menu (positioned relative to it). */
  menuContainer: HTMLElement;
  /** Items after Cut/Copy/Paste/Select All in the right-click menu (e.g. Delete note). */
  extraMenuItems?: MenuItem[];
  /** Items before them (the colour row), built when the menu opens. */
  topMenuItems?(e: MouseEvent): MenuItem[];
  /** Right-click on a label: its colour row (D40). */
  labelColourItems?(label: string): MenuItem[];
  /** "Copy task / note as Markdown" for the text and the clicked line (0-based, null: none). */
  copyMenuItems?(md: string, line: number | null): MenuItem[];
  /** Cmd+Option+1…8 / Ctrl+Alt+1…8: palette colour by index (D29). */
  onColourKey?(index: number): void;
  /** Setting: Cmd/Ctrl+L turns a ticked checkbox back into text (read on every press). */
  cycleToText?(): boolean;
  /** Setting: numbered lists renumber themselves after an edit (on unless switched off). */
  renumberLists?(): boolean;
  /** Setting: dates show the year always (the editor's own copy of the date code is set from it). */
  alwaysYear?(): boolean;
  /** Emails for the link picker (D39). Without it, [[, << and Cmd+K don't open a picker. */
  searchEmails?(query: string): Promise<EmailCandidate[]>;
  /** Setting: Cmd/Ctrl+K opens the link picker (on unless switched off); off: links to web addresses only. */
  linkPicker?(): boolean;
  /** Labels used in notes before, for autocomplete after "#" (D38). */
  knownLabels?(): Promise<string[]>;
}

export interface LiveEditor {
  getValue(): string;
  /** Selects [from, to) (tests, programmatic use). */
  select(from: number, to: number): void;
  focus(): void;
  /** The cursor's box on screen, or null (no layout). */
  cursorCoords(): { left: number; top: number; bottom: number } | null;
  /** Takes the focus out of the editor (it stays open, selection kept). */
  blur(): void;
  /** Puts the cursor at the document position under a viewport point (else at the end). */
  /** Cursor at `point` (end of the note without one); with `to`, a selection from point to `to`. */
  placeCursor(point?: { x: number; y: number }, to?: { x: number; y: number }): void;
  /** Cursor at the end of a line of the note (0 = the first), scrolled into view (the task view, D38). */
  placeAtLine(line: number): void;
  destroy(): void;
}

const markdown = new Language(defineLanguageFacet(), parser.configure([
  TaskList,
  Autolink,
  Strikethrough,
  // No underlined (setext) headings: "---" under a line of text is a rule, as in the rendered
  // note (markdown-it's "lheading" is off); otherwise it became a heading and the line vanished.
  { remove: ["SetextHeading"] },
  // A numbered list right under a list item may start at any number, as in the shown note
  // (core markdown.ts). The parser already allows that inside numbered lists; this ends the
  // item's paragraph for such a line under a bullet item too.
  {
    parseBlock: [
      {
        name: "AnyStartSublist",
        endLeaf(cx, line) {
          const m = /^(\d{1,9})[.)](?:\s|$)/.exec(line.text.slice(line.pos));
          return !!m && m[1] !== "1" && cx.parentType().name === "ListItem";
        },
      },
    ],
  },
]), [], "markdown");

// ---- live preview -------------------------------------------------------------------------------

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-tn-bullet";
    span.textContent = "•";
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(): HTMLElement {
    const box = document.createElement("span");
    // Same drawn box as the rendered note (tn-box, styled in the card's CSS).
    box.className = `cm-tn-task tn-box${this.checked ? " tn-box-done" : ""}`;
    // No text: the tick comes from the card's CSS (::before), the same in both states.
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    return box;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** A date that can't be (month 13, 30 February): text with a dotted underline saying so. */
const invalidDate = Decoration.mark({ class: "cm-tn-loose-date", attributes: { title: "Not a valid date" } });

/** When a task was finished, off the cursor line (D38): "done Sat 17 Oct", small and grey. */
class DoneChip extends WidgetType {
  constructor(readonly iso: string) {
    super();
  }
  eq(other: DoneChip): boolean {
    return other.iso === this.iso;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-tn-done-date";
    span.textContent = `done ${formatDue(this.iso)}`;
    span.title = `Done on ${new Date(`${this.iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`;
    return span;
  }
}

/** A date off the cursor line (D38): "Sat 24 Oct" in a lozenge, the full date as tooltip. */
class DateChip extends WidgetType {
  constructor(
    readonly iso: string,
    /** In an open checklist item: a due date, red when past. */
    readonly due: boolean,
    /** In a web link's text: the link's colour and underline (marks don't wrap widgets). */
    readonly inWebLink = false
  ) {
    super();
  }
  eq(other: DateChip): boolean {
    return other.iso === this.iso && other.due === this.due && other.inWebLink === this.inWebLink;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-tn-chip cm-tn-date${this.due && isOverdue(this.iso) ? " cm-tn-overdue" : ""}${this.inWebLink ? " cm-tn-chip-in-link" : ""}`;
    span.textContent = formatDue(this.iso);
    span.title = new Date(`${this.iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** A label's lozenge, with its name for the label's colour (D40). */
const labelChips = new Map<string, Decoration>();
function labelChip(label: string): Decoration {
  const key = label.toLowerCase();
  let deco = labelChips.get(key);
  if (!deco) labelChips.set(key, (deco = Decoration.mark({ class: "cm-tn-chip cm-tn-label", attributes: { "data-label": key } })));
  return deco;
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
/**
 * A rule line: drawn by its line's background (see theme). The "---" stays but is transparent:
 * hiding it completely left the line empty, CodeMirror collapsed it to zero height and the
 * stripe disappeared.
 */
const ruleLine = Decoration.line({ class: "cm-tn-hr-line" });
const ruleText = Decoration.mark({ class: "cm-tn-hr-text" });
const mark = (cls: string) => Decoration.mark({ class: cls });
const strong = mark("cm-tn-strong");
const em = mark("cm-tn-em");
const strike = mark("cm-tn-strike");
const code = mark("cm-tn-code");
const link = mark("cm-tn-link");
/** A link with its destination as tooltip, as on the shown note. */
/**
 * Links to other emails (mid:, D37) look different from web links: a rounded lozenge; on the
 * cursor line (`editing`) underlined like a web link, the Markdown around it showing.
 */
const EMAIL_TITLE = `Email in Thunderbird (${MOD}click opens it)`;
const linkTo = (url: string, editing = false) =>
  /^mid:/i.test(url)
    ? Decoration.mark({ class: editing ? "cm-tn-link" : "cm-tn-link cm-tn-email-link", attributes: { title: EMAIL_TITLE } })
    : Decoration.mark({ class: "cm-tn-link", attributes: { title: url } });
const codeBlockText = mark("cm-tn-cb-text");
/** Fence lines (```): the code box's top and bottom padding; the text shows only inside the block. */
const fenceShown = mark("cm-tn-fence");
const fenceHidden = mark("cm-tn-fence cm-tn-fence-hidden");
const line = (cls: string) => Decoration.line({ class: cls });
const selectedEmpty = Decoration.line({ class: "cm-tn-selected-empty" });
const listNumber = mark("cm-tn-list-number");
const listNumberBox = mark("cm-tn-list-number cm-tn-list-number-box");
/** Width of every list marker (bullet, number, checkbox), in em; the same in the shown note (card.ts). */
const MARK = 1.4;

/**
 * While a click on the shown note is turned into a cursor position: no line shows its markup,
 * so the editor looks exactly like the note that was clicked. (The cursor starts at the top; a
 * long link there, expanded, wrapped onto more lines and moved every line below it down.)
 */
const setPlacing = StateEffect.define<boolean>();
const placing = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setPlacing) ? e.value : v), value),
});

/** Lines with the cursor or a selection: their markup stays visible. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  if (state.field(placing, false)) return lines;
  for (const r of state.selection.ranges) {
    const from = state.doc.lineAt(r.from).number;
    const to = state.doc.lineAt(r.to).number;
    for (let n = from; n <= to; n++) lines.add(n);
  }
  return lines;
}

/**
 * Leading spaces, quote markers and a list marker (a bullet with its spaces, a task's box, or
 * a number): drawn by the rules above, so space collapsing starts after them.
 */
const LINE_PREFIX = /^\s*(?:>\s?)*(?:[-*+][ \t]+(?:\[[ xX]\])?|\d+[.)])?/;

/** `[text](url)` links (email, web, mail) in the visible lines: text may hold balanced brackets and escapes. */
const EMAIL_LINK = /\[((?:\\.|[^[\]\\\n]|\[(?:\\.|[^[\]\\\n])*\])*)\]\(((?:mid|https?|mailto):[^)\s]+)\)/g;

/**
 * A click on a shown note lands at the end of a link's visible text when it was behind the
 * link: in the Markdown that is before "](url)", which appears once the line is edited. Such
 * a position goes to the end of the whole link, where the click was meant.
 */
export function pastLinkText(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  for (const m of line.text.matchAll(EMAIL_LINK)) {
    const start = line.from + m.index!;
    const textTo = start + 1 + m[1]!.length;
    const to = start + m[0].length;
    if (pos >= textTo && pos < to) return to;
  }
  return pos;
}

function findEmailLinks(view: EditorView): { from: number; to: number; textFrom: number; textTo: number; url: string }[] {
  const out: { from: number; to: number; textFrom: number; textTo: number; url: string }[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      for (const m of line.text.matchAll(EMAIL_LINK)) {
        const start = line.from + m.index!;
        out.push({ from: start, to: start + m[0].length, textFrom: start + 1, textTo: start + 1 + m[1]!.length, url: m[2]! });
      }
      pos = line.to + 1;
    }
  }
  return out;
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const active = activeLines(state);
  const ranges: Range<Decoration>[] = [];
  /** Lines in code blocks: their spaces are kept as typed. */
  const codeLines = new Set<number>();
  const off = (pos: number) => !active.has(doc.lineAt(pos).number);
  /** Hide [from, to), plus one following space (after `#`, `>`). */
  const hideWithSpace = (from: number, to: number) => {
    const end = doc.sliceString(to, to + 1) === " " ? to + 1 : to;
    ranges.push(hidden.range(from, end));
  };

  // Links found by their own pattern, nested brackets included: the parser reads an inner "[x]"
  // in link text as a link of its own and then misses the outer one ("[[tn-spike] C](mid:…)",
  // valid CommonMark, which the shown note renders). Inside them the parse is ignored.
  // Only where the parser got it wrong: links it parsed whole keep their normal handling
  // (bold and other markup inside them).
  const emailLinks = findEmailLinks(view).filter((l) => {
    for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(l.from, 1); n; n = n.parent) {
      if (n.name === "Link") return !(n.from === l.from && n.to === l.to);
    }
    return true;
  });
  const insideEmailLink = (from: number, to: number) => emailLinks.some((l) => from >= l.from && to <= l.to);
  for (const l of emailLinks) {
    ranges.push(linkTo(l.url, !off(l.from)).range(l.textFrom, l.textTo));
    if (off(l.from)) {
      ranges.push(hidden.range(l.from, l.textFrom));
      ranges.push(hidden.range(l.textTo, l.to));
      for (const e of doc.sliceString(l.textFrom, l.textTo).matchAll(/\\[\\[\]]/g)) {
        ranges.push(hidden.range(l.textFrom + e.index!, l.textFrom + e.index! + 1));
      }
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (insideEmailLink(node.from, node.to)) return false;
        const name = node.name;
        const parent = node.node.parent?.name;
        switch (name) {
          case "StrongEmphasis":
            ranges.push(strong.range(node.from, node.to));
            break;
          case "Emphasis":
            ranges.push(em.range(node.from, node.to));
            break;
          case "EmphasisMark":
          case "StrikethroughMark":
            if (off(node.from)) ranges.push(hidden.range(node.from, node.to));
            break;
          case "Strikethrough":
            ranges.push(strike.range(node.from, node.to));
            break;
          case "InlineCode":
            ranges.push(code.range(node.from, node.to));
            break;
          case "CodeMark":
            if (parent === "InlineCode" && off(node.from)) ranges.push(hidden.range(node.from, node.to));
            break;
          case "CodeBlock": {
            // Indented code (4+ spaces): the same box, no fence lines; the 4 spaces show only
            // while the cursor is in the block (the shown note drops them).
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            let inside = false;
            for (const n of active) if (n >= first && n <= last) inside = true;
            for (let n = first; n <= last; n++) {
              const l = doc.line(n);
              const cls = `cm-tn-cb${n === first ? " cm-tn-cb-first" : ""}${n === last ? " cm-tn-cb-last" : ""}`;
              ranges.push(line(cls).range(l.from));
              codeLines.add(n);
              const k = Math.min(4, leading(l.text));
              if (!inside && k) ranges.push(hidden.range(l.from, l.from + k));
            }
            break;
          }
          case "Paragraph":
            // Up to 3 leading spaces mean nothing in Markdown (the shown note drops them):
            // hidden off the cursor line. Only paragraphs of their own, not in lists or quotes.
            if (parent === "Document") {
              for (let n = doc.lineAt(node.from).number; n <= doc.lineAt(node.to).number; n++) {
                const l = doc.line(n);
                const k = leading(l.text);
                if (k && k < l.text.length && off(l.from)) ranges.push(hidden.range(l.from, l.from + k));
              }
            }
            break;
          case "ListItem": {
            // Off the cursor line, list lines are drawn as in the shown note: one marker width
            // (MARK) per nesting level instead of their few narrow spaces (also spaces that don't
            // nest, e.g. under "-  " with two spaces); the item's continuation lines one more,
            // so they start where its text starts (after a blank line the shown note ends the
            // list, so there they start at the left edge). On the cursor line the spaces are
            // plain text, so the cursor moves through them normally.
            let depth = -1;
            for (let p = node.node.parent; p; p = p.parent) if (p.name === "BulletList" || p.name === "OrderedList") depth++;
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            for (let n = first; n <= last; n++) {
              const l = doc.line(n);
              const k = leading(l.text);
              if (!off(l.from) || k === l.text.length) continue;
              // Only lines of this item itself: not nested items' lines, not code or quotes in it.
              let steps = depth;
              if (n > first) {
                let owner: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(l.from + k, 1);
                while (owner && !["ListItem", "FencedCode", "CodeBlock", "Blockquote"].includes(owner.name)) owner = owner.parent;
                if (!owner || owner.name !== "ListItem" || owner.from !== node.from) continue;
                let blank = false;
                for (let b = first + 1; b < n; b++) if (!doc.line(b).text.trim()) blank = true;
                steps = blank ? 0 : depth + 1;
              }
              if (steps > 0) ranges.push(Decoration.line({ attributes: { style: `padding-left: ${steps * MARK}em` } }).range(l.from));
              if (k) ranges.push(hidden.range(l.from, l.from + k));
            }
            break;
          }
          case "FencedCode": {
            // Drawn as a box like the shown note's <pre>: the fence lines stay as its top and
            // bottom padding (no jump when the cursor enters), their ``` shown only while the
            // cursor is in the block. Markdown needs no blank lines around a fenced block.
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            let inside = false;
            for (const n of active) if (n >= first && n <= last) inside = true;
            const closed = last > first && /^\s*(```|~~~)/.test(doc.line(last).text);
            for (let n = first; n <= last; n++) {
              const l = doc.line(n);
              const cls = `cm-tn-cb${n === first ? " cm-tn-cb-first" : ""}${n === last ? " cm-tn-cb-last" : ""}`;
              ranges.push(line(cls).range(l.from));
              codeLines.add(n);
              const fence = n === first || (n === last && closed);
              if (fence && l.to > l.from) ranges.push((inside ? fenceShown : fenceHidden).range(l.from, l.to));
            }
            break;
          }
          case "CodeText":
            if (parent === "FencedCode" || parent === "CodeBlock") ranges.push(codeBlockText.range(node.from, node.to));
            break;
          case "ATXHeading1":
          case "ATXHeading2":
          case "ATXHeading3":
          case "ATXHeading4":
          case "ATXHeading5":
          case "ATXHeading6":
            ranges.push(line(`cm-tn-h cm-tn-h${Math.min(3, Number(name.slice(-1)))}`).range(doc.lineAt(node.from).from));
            break;
          case "HeaderMark":
            if (off(node.from)) hideWithSpace(node.from, node.to);
            break;
          case "Blockquote":
            // One bar per line; each further level (">>") moves bar and text one step in
            // (1.2em, as the shown note) instead of adding another bar. On the cursor line the
            // markers show instead.
            if (parent === "Blockquote") break;
            // A conflict box (D32, "> [!conflict]"): drawn as a warning box.
            const conflictBox = /^> \[!conflict\]/.test(doc.lineAt(node.from).text);
            for (let n = doc.lineAt(node.from).number; n <= doc.lineAt(node.to).number; n++) {
              const l = doc.line(n);
              const depth = (/^\s*((?:>\s?)*)/.exec(l.text)![1]!.match(/>/g) ?? []).length;
              const extra = depth > 1 && off(l.from) ? { style: `margin-left: ${(depth - 1) * 1.2}em` } : undefined;
              const cls = conflictBox ? "cm-tn-quote cm-tn-conflict" : "cm-tn-quote";
              ranges.push(Decoration.line({ class: cls, ...(extra && { attributes: extra }) }).range(l.from));
            }
            break;
          case "QuoteMark":
            if (off(node.from)) hideWithSpace(node.from, node.to);
            break;
          case "ListMark": {
            const text = doc.sliceString(node.from, node.to);
            // A box with nothing after it ("- [ ]") is a task too; the parser wants a space after it.
            const rest = doc.sliceString(node.to, doc.lineAt(node.to).to);
            const bare = node.node.nextSibling?.name === "Task" ? null : /^([ \t]+)\[([ xX])\][ \t]*$/.exec(rest);
            const isTask = node.node.nextSibling?.name === "Task" || !!bare;
            if (bare && off(node.from)) {
              const box = node.to + bare[1]!.length;
              ranges.push(Decoration.replace({ widget: new CheckboxWidget(bare[2] !== " ") }).range(box, doc.lineAt(node.to).to));
            }
            // Numbers in equal-width digits, as the shown note's list markers (browsers draw
            // those tabular): a proportional "1." is narrower and its line jumped.
            if (/^\d+[.)]$/.test(text)) {
              if (off(node.from)) {
                // Off the cursor line: one marker width, its spaces hidden, as in the shown note.
                const after = /^[ \t]*/.exec(doc.sliceString(node.to, doc.lineAt(node.to).to))![0].length;
                ranges.push(listNumberBox.range(node.from, node.to));
                if (after) ranges.push(hidden.range(node.to, node.to + after));
              } else {
                ranges.push(listNumber.range(node.from, node.to));
              }
            }
            if (off(node.from) && /^[-*+]$/.test(text)) {
              // The marker and all spaces after it: a task's bullet disappears (the checkbox
              // takes its place), a bullet becomes one of fixed width, as in the shown note.
              const after = /^[ \t]*/.exec(doc.sliceString(node.to, doc.lineAt(node.to).to))![0].length;
              ranges.push((isTask ? hidden : bullet).range(node.from, node.to + after));
            }
            break;
          }
          case "TaskMarker":
            if (off(node.from)) {
              const checked = /x/i.test(doc.sliceString(node.from, node.to));
              // With the spaces after it: the box's own margin makes up the marker width.
              const after = /^[ \t]*/.exec(doc.sliceString(node.to, doc.lineAt(node.to).to))![0].length;
              ranges.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to + after));
            }
            break;
          case "Link":
            break;
          case "Escape":
            // "\[" shows as "[" off the cursor line, as in the shown note.
            if (off(node.from)) ranges.push(hidden.range(node.from, node.from + 1));
            break;
          case "LinkMark":
            if (off(node.from)) ranges.push(hidden.range(node.from, node.to));
            break;
          case "URL":
            if (parent === "Link") {
              if (off(node.from)) ranges.push(hidden.range(node.from, node.to));
            } else {
              // Bare URL / autolink.
              ranges.push(linkTo(doc.sliceString(node.from, node.to)).range(node.from, node.to));
            }
            break;
          case "HorizontalRule":
            if (off(node.from)) {
              ranges.push(ruleText.range(node.from, node.to));
              ranges.push(ruleLine.range(doc.lineAt(node.from).from));
            }
            break;
        }
        // Link text: everything between the first LinkMark pair.
        if (name === "Link") {
          // The text runs from the first LinkMark ("[") to the second ("]"); other nodes may sit
          // in between (escapes like "\[", emphasis), so not simply the next sibling.
          const [open, close] = node.node.getChildren("LinkMark");
          if (open && close && close.from > open.to) {
            const url = node.node.getChild("URL");
            const target = url ? doc.sliceString(url.from, url.to) : "";
            // An email link is a lozenge only off the cursor line; there it is underlined like a
            // web link, its Markdown showing.
            ranges.push((url ? linkTo(target, !off(node.from)) : link).range(open.to, close.from));
          }
        }
      },
    });
  }
  // Empty lines inside a selection: the browser draws nothing for them, so they get a small
  // block in the selection colour (as if the line break were selected).
  for (const r of state.selection.ranges) {
    if (r.empty) continue;
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) {
      const l = doc.line(n);
      if (l.length === 0 && r.from <= l.from && l.to < r.to) ranges.push(selectedEmpty.range(l.from));
    }
  }
  // Due dates and labels (D38) off the cursor line: lozenges, a date showing as "Sat 24 Oct"
  // (red when overdue, unless the task is ticked); also in a link's text, not in code or a link's address.
  const inLinkOrCode = (pos: number) => {
    if (emailLinks.some((l) => pos >= l.textTo && pos < l.to)) return true;
    for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
      if (["InlineCode", "URL", "Autolink", "CodeText"].includes(n.name)) return true;
    }
    return false;
  };
  /** In the text of a link to a web address (not an email link). */
  const inWebLinkText = (pos: number) => {
    const manual = emailLinks.find((l) => pos >= l.textFrom && pos < l.textTo);
    if (manual) return !/^mid:/i.test(manual.url);
    for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
      if (n.name === "Link") {
        const url = n.getChild("URL");
        return !!url && !/^mid:/i.test(doc.sliceString(url.from, url.to));
      }
    }
    return false;
  };
  for (const { from, to } of view.visibleRanges) {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
      if (codeLines.has(n)) continue;
      const l = doc.line(n);
      if (!off(l.from) || (!l.text.includes("@") && !l.text.includes("#") && !l.text.includes("✅"))) continue;
      // Due dates only in an open checklist item's own text (its first line or continuation lines,
      // not its sub-items): the nearest list item around the line starts with "[ ]".
      let due = false;
      for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(l.from + /^[\s>]*/.exec(l.text)![0].length, 1); node; node = node.parent) {
        if (node.name !== "ListItem") continue;
        due = /^(?:[-*+]|\d+[.)])\s+\[ \]/.test(doc.sliceString(node.from, doc.lineAt(node.from).to));
        break;
      }
      for (const m of l.text.matchAll(new RegExp(DUE_DATE.source, "gu"))) {
        const start = l.from + m.index! + m[1]!.length;
        if (inLinkOrCode(start)) continue;
        // Impossible dates (month 13, 30 February) stay text, marked as such.
        if (!isValidDate(m[2]!)) ranges.push(invalidDate.range(start, start + 1 + m[2]!.length));
        else ranges.push(Decoration.replace({ widget: new DateChip(m[2]!, due, inWebLinkText(start)) }).range(start, start + 1 + m[2]!.length));
      }
      for (const m of l.text.matchAll(new RegExp(DONE_DATE.source, "gu"))) {
        const start = l.from + m.index!;
        if (inLinkOrCode(start)) continue;
        if (!isValidDate(m[1]!)) ranges.push(invalidDate.range(start, start + m[0].length));
        else ranges.push(Decoration.replace({ widget: new DoneChip(m[1]!) }).range(start, start + m[0].length));
      }
      for (const m of l.text.matchAll(new RegExp(LABEL.source, "gu"))) {
        const start = l.from + m.index! + m[1]!.length;
        if (!inLinkOrCode(start)) ranges.push(labelChip(m[2]!).range(start, start + 1 + m[2]!.length));
      }
      // "@" dates that aren't ISO yet: dotted, saying what they would mean (right-click converts).
      for (const d of looseDates(l.text)) {
        if (inLinkOrCode(l.from + d.from)) continue;
        const title = `Not a date reference yet: would be ${formatDue(d.iso)}. Right-click → Convert to date.`;
        ranges.push(Decoration.mark({ class: "cm-tn-loose-date", attributes: { title } }).range(l.from + d.from, l.from + d.to));
      }
    }
  }
  // Runs of spaces show as one, as in the shown note (HTML collapses them), off the cursor
  // line and outside code. Leading spaces and list/quote markers are handled above.
  for (const { from, to } of view.visibleRanges) {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
      if (codeLines.has(n)) continue;
      const l = doc.line(n);
      if (!off(l.from)) continue;
      const prefix = LINE_PREFIX.exec(l.text)![0].length;
      const runs = / {2,}/g;
      runs.lastIndex = prefix;
      for (let m = runs.exec(l.text); m; m = runs.exec(l.text)) {
        if (m.index + m[0].length === l.text.length) break; // trailing: not visible anyway
        ranges.push(hidden.range(l.from + m.index + 1, l.from + m.index + m[0].length));
      }
    }
  }
  // `true`: let CodeMirror sort (marks and hidden markup share positions; spike finding).
  return Decoration.set(ranges, true);
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      const parsed = syntaxTree(u.startState) !== syntaxTree(u.state);
      const placed = u.transactions.some((tr) => tr.effects.some((e) => e.is(setPlacing)));
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || parsed || placed) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// ---- commands -----------------------------------------------------------------------------------

const LIST_ITEM = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\](?:\s+|$))?/;

/** Enter in a list item continues the list; on an empty item it ends the list. */
function continueList(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const lineAt = state.doc.lineAt(range.head);
  const before = state.doc.sliceString(lineAt.from, range.head);
  const m = LIST_ITEM.exec(before);
  if (!m) return false;
  if (before.length === m[0].length && lineAt.to === range.head) {
    view.dispatch({ changes: { from: lineAt.from, to: lineAt.to, insert: "" } });
    return true;
  }
  const [, indent, , number, delimiter, space, task] = m;
  const marker = number ? `${Number(number) + 1}${delimiter}` : m[2];
  const insert = `\n${indent}${marker}${space}${task ? "[ ] " : ""}`;
  view.dispatch({ changes: { from: range.head, insert }, selection: { anchor: range.head + insert.length }, userEvent: "input" });
  return true;
}

// ---- Tab (D28): indentation only where Markdown has it -------------------------------------------
// In a list: nest the item under the one above (to that item's text column: 2 spaces under
// "-", 3 under "1."), Shift+Tab back to its parent's level; its sub-items move along. In code:
// spaces (4, as in Python), at the cursor or before every selected line. Elsewhere a quote
// level ("> "), the only indentation Markdown has for plain text. Every selected line is
// treated by its own kind.

const CODE_INDENT = 4;
const QUOTE_MARK = /^(\s*)> ?/;

const leading = (text: string) => /^\s*/.exec(text)![0].length;

/** Whether a line belongs to a code block, or to a list item without being its first line. */
function lineContext(state: EditorState, from: number): "code" | "inList" | null {
  for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return "code";
    if (node.name === "ListItem") return "inList";
  }
  return null;
}

/** How far Tab (+) or Shift+Tab (−) moves list item `n`; 0 = it can't. */
function listShift(state: EditorState, n: number, out: boolean): number {
  const indent = leading(state.doc.line(n).text);
  for (let k = n - 1; k >= 1; k--) {
    const text = state.doc.line(k).text;
    if (!text.trim()) continue;
    const m = LIST_ITEM.exec(text);
    const ind = leading(text);
    if (!m) {
      if (ind === 0) break; // a paragraph: the list ends above
      continue; // a continuation line of an item above
    }
    // Tab: under the previous item of the same level, at its text's column.
    if (!out && ind === indent) return m[1]!.length + m[2]!.length + m[5]!.length - indent;
    if (!out && ind < indent) return 0; // first item of its level: nothing to nest under
    // Shift+Tab: to the level of the parent item.
    if (out && ind < indent) return ind - indent;
  }
  return out ? -indent : 0;
}

/** The number for item `n` once nested to `indent`: after the sub-list it joins, or 1. */
function nestedNumber(state: EditorState, n: number, indent: number): number {
  for (let k = n - 1; k >= 1; k--) {
    const text = state.doc.line(k).text;
    if (!text.trim()) continue;
    const ind = leading(text);
    const m = LIST_ITEM.exec(text);
    if (m && ind === indent) return m[3] ? Number(m[3]) + 1 : 1;
    if (ind < indent) return 1;
  }
  return 1;
}

/** Line `n` and the lines that belong to its list item (indented deeper, blank lines between). */
function itemLines(state: EditorState, n: number): number[] {
  const indent = leading(state.doc.line(n).text);
  const lines = [n];
  let pending: number[] = [];
  for (let k = n + 1; k <= state.doc.lines; k++) {
    const text = state.doc.line(k).text;
    if (!text.trim()) {
      pending.push(k);
      continue;
    }
    if (leading(text) <= indent) break;
    lines.push(...pending, k);
    pending = [];
  }
  return lines;
}

function tabCommand(out: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const ranges = state.selection.ranges;
    // Code, no selection: spaces at the cursor up to the next step.
    if (!out && ranges.every((r) => r.empty && lineContext(state, state.doc.lineAt(r.head).from) === "code")) {
      view.dispatch(
        state.changeByRange((r) => {
          const col = r.head - state.doc.lineAt(r.head).from;
          const spaces = " ".repeat(CODE_INDENT - (col % CODE_INDENT));
          return { changes: { from: r.head, insert: spaces }, range: EditorSelection.cursor(r.head + spaces.length) };
        }),
        { userEvent: "input" }
      );
      return true;
    }
    const lines = new Set<number>();
    for (const r of ranges) {
      const first = state.doc.lineAt(r.from).number;
      let last = state.doc.lineAt(r.to).number;
      // A selection ending at the start of a line doesn't include that line.
      if (last > first && state.doc.line(last).from === r.to) last--;
      for (let n = first; n <= last; n++) lines.add(n);
    }
    const changes: { from: number; to?: number; insert?: string }[] = [];
    const done = new Set<number>();
    const shift = (n: number, by: number) => {
      if (done.has(n)) return;
      done.add(n);
      const line = state.doc.line(n);
      if (by > 0) changes.push({ from: line.from, insert: " ".repeat(by) });
      else if (by < 0) changes.push({ from: line.from, to: line.from + Math.min(-by, leading(line.text)) });
    };
    for (const n of [...lines].sort((a, b) => a - b)) {
      if (done.has(n)) continue;
      const line = state.doc.line(n);
      const context = lineContext(state, line.from);
      if (context === "code") {
        shift(n, out ? -Math.min(CODE_INDENT, leading(line.text)) : CODE_INDENT);
      } else if (LIST_ITEM.test(line.text)) {
        const by = listShift(state, n, out);
        if (by) {
          for (const k of itemLines(state, n)) shift(k, by);
          // A numbered item nested by Tab: 1 for a new sub-list, else the next number. Markdown
          // reads a sub-list written right under an item as a list only if it starts at 1.
          const m = LIST_ITEM.exec(line.text)!;
          if (!out && m[3]) {
            const number = nestedNumber(state, n, leading(line.text) + by);
            const at = line.from + leading(line.text);
            if (number !== Number(m[3])) changes.push({ from: at, to: at + m[3].length, insert: String(number) });
          }
        } else done.add(n);
      } else if (context === "inList") {
        done.add(n); // part of an item: moves with the item's own line
      } else {
        done.add(n);
        const q = QUOTE_MARK.exec(line.text);
        if (out) {
          if (q) changes.push({ from: line.from + q[1]!.length, to: line.from + q[0].length });
        } else {
          changes.push({ from: line.from + leading(line.text), insert: "> " });
        }
      }
    }
    if (changes.length) {
      // A cursor where the marker or spaces go ends up after them (on an empty line: "> |").
      const set = state.changes(changes);
      view.dispatch({ changes: set, selection: state.selection.map(set, 1), userEvent: "input" });
    }
    return true; // Tab never leaves the editor
  };
}

// ---- joining list items --------------------------------------------------------------------------
// Joining two list items brings up only the lower item's text; its marker ("- ", "1. ",
// "- [ ] ") goes, the upper item keeps its own. Then Enter splits them back into two items.

/** Delete at the end of a line followed by a list item: append that item's text. */
function joinNextItem(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  if (!r.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(r.head);
  if (r.head !== line.to || line.number === state.doc.lines) return false;
  const next = state.doc.line(line.number + 1);
  const m = LIST_ITEM.exec(next.text);
  if (!m || !LIST_ITEM.test(line.text)) return false;
  view.dispatch({ changes: { from: line.to, to: next.from + m[0].length }, userEvent: "delete.forward" });
  return true;
}

/**
 * Backspace at the start of a list item's text (or of its line): joins its text to the item
 * above. With no item above, the first Backspace only removes the marker.
 */
function joinPreviousItem(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  if (!r.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(r.head);
  const m = LIST_ITEM.exec(line.text);
  if (!m) return false;
  const textStart = line.from + m[0].length;
  if (r.head !== textStart && r.head !== line.from) return false;
  const prev = line.number > 1 ? state.doc.line(line.number - 1) : null;
  if (prev && LIST_ITEM.test(prev.text)) {
    view.dispatch({ changes: { from: prev.to, to: textStart }, selection: { anchor: prev.to }, userEvent: "delete.backward" });
    return true;
  }
  if (r.head !== textStart) return false; // at the line start with no item above: an ordinary Backspace
  view.dispatch({ changes: { from: line.from, to: textStart }, selection: { anchor: line.from }, userEvent: "delete.backward" });
  return true;
}

// ---- numbered lists ------------------------------------------------------------------------------
// After an edit in a numbered list (an item inserted, deleted, moved, nested), its numbers are
// put back in sequence from the first item's number, as the shown note displays them anyway
// (Markdown keeps only the first number). It is a step of its own in the undo history: Cmd+Z
// right after it restores the numbers as they were, and an undo never renumbers again.

const Renumbered = Annotation.define<boolean>();

/** Changes that put the numbered lists touching [from, to] in sequence. */
function renumberChanges(state: EditorState, from: number, to: number): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "OrderedList") return;
      let expected: number | null = null;
      for (let item = node.node.firstChild; item; item = item.nextSibling) {
        if (item.name !== "ListItem") continue;
        const mark = item.getChild("ListMark");
        const m = mark && /^(\d+)[.)]$/.exec(state.doc.sliceString(mark.from, mark.to));
        if (!mark || !m) continue;
        if (expected === null) expected = Number(m[1]);
        else if (Number(m[1]) !== expected) changes.push({ from: mark.from, to: mark.from + m[1]!.length, insert: String(expected) });
        expected++;
      }
    },
  });
  return changes;
}

const renumberLists = (enabled: () => boolean) => EditorView.updateListener.of((u) => {
  if (!u.docChanged || !enabled()) return;
  if (u.transactions.some((tr) => tr.annotation(Renumbered) || tr.isUserEvent("undo") || tr.isUserEvent("redo"))) return;
  if (!u.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("move"))) return;
  let from = Infinity;
  let to = -1;
  u.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    from = Math.min(from, fromB);
    to = Math.max(to, toB);
  });
  const doc = u.state.doc;
  // Not during the update itself; skipped if something else changed the text meanwhile.
  setTimeout(() => {
    const view = u.view;
    if (view.state.doc !== doc) return;
    const changes = renumberChanges(view.state, Math.max(0, from - 1), Math.min(doc.length, to + 1));
    if (changes.length) {
      view.dispatch({ changes, annotations: [Renumbered.of(true), isolateHistory.of("full")], userEvent: "input.renumber" });
    }
  }, 0);
});

/** Wraps the selection in a marker; with no selection, places the cursor between a pair. */
function wrap(marker: string) {
  return (view: EditorView): boolean => {
    view.dispatch(
      view.state.changeByRange((r) => ({
        changes: [
          { from: r.from, insert: marker },
          { from: r.to, insert: marker },
        ],
        range: EditorSelection.range(r.from + marker.length, r.to + marker.length),
      }))
    );
    return true;
  };
}

/** Rewrites every line touched by the selection; the cursor moves with the text. */
function rewriteLines(change: (lines: string[]) => string[]) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const first = state.doc.lineAt(state.selection.main.from);
    const last = state.doc.lineAt(state.selection.main.to);
    const lines: string[] = [];
    for (let n = first.number; n <= last.number; n++) lines.push(state.doc.line(n).text);
    const next = change(lines);
    // Only the part of each line that changed (usually its marker), so the cursor keeps its
    // place in the text; one where the marker goes ends up after it (empty line: "- [ ] |").
    const changes = next
      .map((text, i) => ({ line: state.doc.line(first.number + i), text }))
      .filter(({ line, text }) => line.text !== text)
      .map(({ line, text }) => {
        const old = line.text;
        let start = 0;
        while (start < old.length && start < text.length && old[start] === text[start]) start++;
        let end = 0;
        while (end < old.length - start && end < text.length - start && old[old.length - 1 - end] === text[text.length - 1 - end]) end++;
        return { from: line.from + start, to: line.to - end, insert: text.slice(start, text.length - end) };
      });
    if (changes.length) {
      const set = state.changes(changes);
      view.dispatch({ changes: set, selection: state.selection.map(set, 1), userEvent: "input" });
    }
    return true;
  };
}

/** "[]" or "[ ]" + space at the start of a line becomes "- [ ] " (as in Notion). */
/**
 * The link picker (D39) for [from, to): its link replaces that range; cancelled, `restore` does
 * (the typed [[ or <<, or the selected text).
 */
function startPicker(view: EditorView, o: LiveEditorOptions, from: number, to: number, label: string | undefined, restore: string): void {
  let coords: { left: number; bottom: number } | null = null;
  try {
    coords = view.coordsAtPos(from);
  } catch {
    // no layout (tests): below the editor's top left
  }
  coords ??= { left: view.contentDOM.getBoundingClientRect().left, bottom: view.contentDOM.getBoundingClientRect().top };
  openLinkPicker({
    container: o.menuContainer,
    at: { left: coords.left, bottom: coords.bottom },
    search: (q) => o.searchEmails!(q),
    label,
    done(markdown) {
      const insert = markdown ?? restore;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input" });
      view.focus();
    },
  });
}

/** Typing [[ or << (outside code) opens the link picker; the two characters make way for the link. */
const pickerTrigger = (o: LiveEditorOptions) =>
  EditorView.inputHandler.of((view, from, to, text) => {
    if (!o.searchEmails || from !== to || (text !== "[" && text !== "<") || from === 0) return false;
    if (view.state.sliceDoc(from - 1, from) !== text || lineContext(view.state, view.state.doc.lineAt(from).from) === "code") return false;
    startPicker(view, o, from - 1, from, undefined, text + text);
    return true;
  });

/**
 * A typed date after "@" becomes the ISO date when a space or punctuation follows (D38): number
 * dates (24.10.27, 1.3.27, 24.10) and whole words (friday, freitag, morgen, today); two-letter
 * abbreviations are only offered in the list. Its own undo step: Cmd+Z brings back the typed text.
 * "." doesn't trigger it (it belongs to "24.10.").
 */
const inCode = (state: EditorState, pos: number) => lineContext(state, state.doc.lineAt(pos).from) === "code";

const dateAutocorrect = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || !/^[\s,;:!?)\]]$/.test(text)) return false;
  const line = view.state.doc.lineAt(from);
  const m = /(^|[^\p{L}\p{N}_@.])@([\p{L}\p{N}.-]+)$/u.exec(line.text.slice(0, from - line.from));
  if (!m || lineContext(view.state, line.from) === "code") return false;
  const word = m[2]!.replace(/\.$/, (dot) => (/^\d{1,2}\.\d{1,2}\.$/.test(m[2]!) ? dot : ""));
  if (/^\d{4}-\d{2}-\d{2}$/.test(word) || (!/\d/.test(word) && word.length < 3)) return false;
  const iso = parseDateWord(word);
  if (!iso) return false;
  const start = from - m[2]!.length;
  view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length }, userEvent: "input.type" });
  view.dispatch({
    changes: { from: start, to: start + word.length, insert: iso },
    annotations: isolateHistory.of("before"),
    userEvent: "input.autocorrect",
  });
  return true;
});

const taskShortcut = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== " " || from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const expanded = expandTaskShortcut(view.state.sliceDoc(line.from, from));
  if (!expanded) return false;
  view.dispatch({
    changes: { from: line.from, to, insert: expanded },
    selection: { anchor: line.from + expanded.length },
    userEvent: "input.type",
  });
  return true;
});

/** Clicking a checkbox widget ticks or unticks the task in the text. */
function toggleTask(view: EditorView, target: Element): boolean {
  if (!target.closest(".cm-tn-task")) return false;
  const pos = view.posAtDOM(target);
  const text = view.state.doc.sliceString(pos, pos + 3);
  if (!/^\[[ xX]\]$/.test(text)) return false;
  // Ticked with the date it was finished, unticked without (D38).
  const line = view.state.doc.lineAt(pos);
  view.dispatch({ changes: { from: line.from, to: line.to, insert: markDone(line.text, text[1] === " ") } });
  return true;
}

/**
 * Keeps the cursor visible while typing or moving it with the keys. CodeMirror scrolls its
 * scroll parents itself, but the editor sits in a shadow root hosted on <html>, so in a
 * quirks-mode message (body is the scrolling element) its walk never reaches the one that
 * scrolls. Mouse clicks don't ask to scroll (they would make long notes jump).
 */
const followCursor = EditorView.updateListener.of((u) => {
  if (!u.selectionSet || !u.transactions.some((tr) => tr.scrollIntoView)) return;
  u.view.requestMeasure({
    read: (v) => v.coordsAtPos(v.state.selection.main.head),
    write: (c) => {
      if (!c) return;
      const room = 24;
      if (c.top < room) window.scrollBy(0, c.top - room);
      else if (c.bottom > window.innerHeight - room) window.scrollBy(0, c.bottom - window.innerHeight + room);
    },
  });
});

/** A bare URL (not already a Markdown link or `<…>`) at a document position. */
function bareUrlAt(state: EditorState, pos: number): { from: number; to: number } | null {
  for (const side of [-1, 1] as const) {
    for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, side); node; node = node.parent) {
      if (node.name === "Link" || node.name === "Autolink" || node.name === "Image") break;
      if (node.name === "URL") {
        const parent = node.parent?.name;
        if (parent === "Link" || parent === "Autolink" || parent === "Image") break;
        return { from: node.from, to: node.to };
      }
    }
  }
  return null;
}

/** Replaces a bare URL with `[label](url)`; the cursor goes after it. */
function linkifyRange(view: EditorView, range: { from: number; to: number }): void {
  const url = view.state.doc.sliceString(range.from, range.to);
  const insert = linkForPaste(url, "") ?? url;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    userEvent: "input",
  });
}

/**
 * Cmd/Ctrl+K: on a bare URL, makes it a Markdown link. Otherwise inserts a link around the
 * selection (`[text](url)`), with the URL from the clipboard if it holds one, else the cursor
 * where the URL goes (or, with nothing selected, where the link text goes).
 */
function makeLink(view: EditorView, o: LiveEditorOptions): boolean {
  const r = view.state.selection.main;
  const selected = view.state.doc.sliceString(r.from, r.to);
  const bare = r.empty ? bareUrlAt(view.state, r.head) : isUrl(selected) ? { from: r.from, to: r.to } : null;
  if (bare) {
    linkifyRange(view, bare);
    return true;
  }
  const line = view.state.doc.lineAt(r.from);
  const { lead, label, trail } = splitForLink(selected, view.state.doc.sliceString(line.from, r.from));
  // Setting on (default): the link picker, the selected text becoming the link text (D39).
  if (o.searchEmails && (o.linkPicker?.() ?? true)) {
    const from = r.from + lead.length;
    startPicker(view, o, from, from + label.length, label || undefined, label);
    return true;
  }
  o.clipboard
    .read()
    .catch(() => "")
    .then((text) => {
      const url = isUrl(text) ? text.trim() : "";
      const link = markdownLink(label, url);
      const insert = lead + link + trail;
      // Cursor: after the link when it is complete, else in the part still to fill in.
      const at = lead.length + (url && label ? link.length : label ? link.length - 1 : 1);
      view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: { anchor: r.from + at }, userEvent: "input" });
      view.focus();
    });
  return true;
}

/** The URL of a link (or bare URL) at a document position. */
function urlAt(state: EditorState, pos: number): string | null {
  // Email links the parser misses (nested brackets, see findEmailLinks).
  const line = state.doc.lineAt(pos);
  for (const m of line.text.matchAll(EMAIL_LINK)) {
    const start = line.from + m.index!;
    if (pos >= start && pos <= start + m[0].length) return m[2]!;
  }
  let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1);
  for (; node; node = node.parent) {
    if (node.name === "URL") return webUrl(state.doc.sliceString(node.from, node.to)); // "www.…": https://
    if (node.name === "Link") {
      const url = node.getChild("URL");
      return url ? state.doc.sliceString(url.from, url.to) : null;
    }
  }
  return null;
}

/** Removes the selected text (as typing would), if anything is selected. */
function deleteSelection(view: EditorView): void {
  if (view.state.selection.ranges.every((r) => r.empty)) return;
  view.dispatch(view.state.replaceSelection(""), { userEvent: "input.type" });
}

// ---- theme -----------------------------------------------------------------------------------------

const theme = EditorView.theme({
  "&": { fontSize: "13px", color: "inherit", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "system-ui, sans-serif", lineHeight: "1.45" },
  ".cm-content": { padding: "0", caretColor: "currentColor" },
  ".cm-line": { padding: "0" },
  ".cm-tn-strong": { fontWeight: "bold" },
  ".cm-tn-em": { fontStyle: "italic" },
  ".cm-tn-strike": { textDecoration: "line-through", textDecorationThickness: "0.11em" },
  ".cm-tn-code": { fontFamily: "ui-monospace, monospace", fontSize: "0.92em", backgroundColor: "#0000000f", borderRadius: "3px" },
  // Underline as a line under the whole link, running on through a lozenge inside it (card.ts alike).
  ".cm-tn-link": {
    color: "#0b57d0",
    textDecoration: "none",
    cursor: "pointer",
    background: "linear-gradient(currentColor, currentColor) 0 calc(100% - 0.12em) / 100% 1px no-repeat",
  },
  // An email link (D37): a see-through rounded lozenge with an envelope, no underline (card.ts alike).
  ".cm-tn-email-link": {
    color: "inherit",
    textDecoration: "none",
    backgroundImage: "none", // no underline line in a lozenge
    backgroundColor: "#0000000f",
    border: "1px solid #00000024",
    borderRadius: "0.8em",
    padding: "0 0.45em",
    // Across a line break the lozenge stays open at the break (slice, the browser default).
  },
  ".cm-tn-email-link::before": { content: '"✉ "', opacity: "0.65" },
  // Fenced code: a box like the shown note's <pre> (card.ts), fence lines as its padding.
  ".cm-line.cm-tn-cb": { backgroundColor: "#0000000f", paddingLeft: "8px", paddingRight: "8px" },
  ".cm-line.cm-tn-cb-first": { borderTopLeftRadius: "4px", borderTopRightRadius: "4px" },
  ".cm-line.cm-tn-cb-last": { borderBottomLeftRadius: "4px", borderBottomRightRadius: "4px" },
  ".cm-tn-cb-text, .cm-tn-fence": { fontFamily: "ui-monospace, monospace", fontSize: "0.92em" },
  ".cm-tn-fence": { opacity: "0.55" },
  ".cm-tn-fence-hidden": { color: "transparent" },
  ".cm-tn-h": { fontWeight: "bold" },
  ".cm-tn-h1": { fontSize: "1.25em" },
  ".cm-tn-h2": { fontSize: "1.12em" },
  ".cm-tn-h3": { fontSize: "1.04em" },
  // Lines take the card's colour (--card-border, set by the card), as in the rendered note.
  ".cm-line.cm-tn-conflict": { borderLeftColor: "#e8590c", backgroundColor: "#e8590c14", opacity: "1" },
  ".cm-tn-quote": { borderLeft: "3px solid var(--card-border, #d8c66a)", paddingLeft: "8px !important", opacity: "0.85" },
  ".cm-tn-list-number": { fontVariantNumeric: "tabular-nums" },
  // Due dates and labels (D38): lozenges like email links (card.ts alike), open at line breaks.
  ".cm-tn-chip": { backgroundColor: "#0000000f", border: "1px solid #00000024", borderRadius: "0.8em", padding: "0 0.45em", whiteSpace: "nowrap" },
  ".cm-tn-label": { whiteSpace: "normal" },
  ".cm-tn-loose-date": { textDecoration: "underline dotted", textUnderlineOffset: "0.2em", cursor: "help" },
  ".cm-tn-done-date": { fontSize: "0.82em", opacity: "0.6", whiteSpace: "nowrap" },
  ".cm-tn-chip-in-link": {
    color: "#0b57d0",
    backgroundImage: "linear-gradient(currentColor, currentColor)",
    backgroundPosition: "0 calc(100% - 0.12em)",
    backgroundSize: "100% 1px",
    backgroundRepeat: "no-repeat",
  },
  // Red only while the setting "Past dates shown in red" is on (the card host lacks "no-overdue").
  ":host(:not(.no-overdue)) & .cm-tn-overdue": { color: "#c92a2a", borderColor: "#c92a2a80", backgroundColor: "#e0313114", fontWeight: "600" },
  ".cm-tn-list-number-box": { display: "inline-block", width: `${MARK}em` },
  ".cm-line.cm-tn-selected-empty": {
    backgroundImage: "linear-gradient(Highlight, Highlight)",
    backgroundRepeat: "no-repeat",
    backgroundSize: "0.6em 100%",
  },
  // The bullet replaces "-" and its spaces: one fixed width, the same as in the shown note (card.ts).
  ".cm-tn-bullet": { display: "inline-block", width: `${MARK}em` },
  // A 1px line at exactly half the line height, like the rendered note's <hr> (an inline element
  // aligned "middle" sat half an x-height above the baseline: slightly lower).
  ".cm-tn-hr-text": { color: "transparent" },
  ".cm-tn-hr-line": {
    backgroundImage:
      "linear-gradient(to bottom, transparent calc(50% - 0.5px), var(--card-border, #d8c66a) calc(50% - 0.5px), var(--card-border, #d8c66a) calc(50% + 0.5px), transparent calc(50% + 0.5px))",
  },
  "@media (prefers-color-scheme: dark)": {
    ".cm-tn-code": { backgroundColor: "#ffffff1a" },
    ".cm-line.cm-tn-cb": { backgroundColor: "#ffffff1a" },
    ".cm-tn-link": { color: "#8ab4f8" },
  },
});

// ---- editor -----------------------------------------------------------------------------------------

export function createLiveEditor(o: LiveEditorOptions): LiveEditor {
  setAlwaysShowYear(o.alwaysYear?.() ?? false);
  const extensions: Extension[] = [
    placing,
    history(),
    followCursor,
    renumberLists(() => o.renumberLists?.() ?? true),
    keymap.of([
      { key: "Mod-Enter", run: () => (o.onDone(), true) },
      // Ctrl+Enter too on macOS, as the hint under the note says (elsewhere Mod is Ctrl already).
      { key: "Ctrl-Enter", run: () => (o.onDone(), true) },
      { key: "Escape", run: () => (o.onCancel(), true) },
      { key: "Enter", run: continueList },
      { key: "Backspace", run: joinPreviousItem },
      { key: "Delete", run: joinNextItem },
      { key: "Tab", run: tabCommand(false), shift: tabCommand(true) },
      { key: "Mod-b", run: wrap("**") },
      { key: "Mod-k", run: (v) => makeLink(v, o) },
      { key: "Mod-i", run: wrap("_") },
      { key: "Mod-Shift-x", run: wrap("~~") },
      // Checkboxes: Cmd/Ctrl+L cycles (Obsidian), Cmd/Ctrl+Shift+L turns a checklist on/off (Apple Notes).
      { key: "Mod-l", run: (v) => rewriteLines((lines) => lines.map((l) => cycleTask(l, o.cycleToText?.() ?? false)))(v) },
      { key: "Mod-Shift-l", run: rewriteLines(toggleChecklist) },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    markdown,
    taskShortcut,
    pickerTrigger(o),
    dateAutocorrect,
    suggestions({
      container: o.menuContainer,
      knownLabels: o.knownLabels,
      inCode: (s, pos) => lineContext(s, s.doc.lineAt(pos).from) === "code",
    }),
    livePreview,
    theme,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": "Note in Markdown", spellcheck: "true" }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) o.onChange();
      if (u.focusChanged && !u.view.hasFocus) o.onBlur();
    }),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        const target = e.target as Element;
        if (e.button === 0 && toggleTask(view, target)) {
          e.preventDefault();
          return true;
        }
        // Cmd+click (Ctrl+click elsewhere) opens a link, also to an email (a plain click edits it, as in Obsidian).
        if (e.button === 0 && opensLink(e) && target.closest(".cm-tn-link, .cm-tn-chip-in-link")) {
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          const url = pos !== null ? urlAt(view.state, pos) : null;
          if (url && /^(?:https?:|mailto:|mid:|www\.)/i.test(url)) {
            e.preventDefault();
            o.openLink(url);
            return true;
          }
        }
        return false;
      },
      // Typing over a selection: in Thunderbird (Firefox, closed shadow root) the browser's own
      // insertion over a selection doesn't reach CodeMirror, so we replace the selection ourselves.
      // Backspace worked because CodeMirror handles it as a command.
      beforeinput(e, view) {
        const data = (e as InputEvent).data;
        if ((e as InputEvent).inputType !== "insertText" || !data || view.composing) return false;
        if (view.state.selection.ranges.every((r) => r.empty)) return false;
        e.preventDefault();
        view.dispatch(view.state.replaceSelection(data), { userEvent: "input.type", scrollIntoView: true });
        return true;
      },
      // Composed characters (dead keys like Option+U then u, input methods) over a selection:
      // the composition would be inserted next to the selection, so remove it first.
      compositionstart(_e, view) {
        deleteSelection(view);
        return false;
      },
      paste(e, view) {
        // Pasting a URL writes a Markdown link (over selected text: with that text).
        const r = view.state.selection.main;
        const line = view.state.doc.lineAt(r.from);
        const link = linkForPaste(
          e.clipboardData?.getData("text/plain") ?? "",
          view.state.doc.sliceString(r.from, r.to),
          view.state.doc.sliceString(line.from, r.from)
        );
        if (link) {
          e.preventDefault();
          view.dispatch(view.state.replaceSelection(link), { userEvent: "input.paste", scrollIntoView: true });
          return true;
        }
        // Pasted text with "@" number dates (@24.10.27): pasted, then the dates turned into ISO
        // dates as their own undo step (Cmd+Z keeps them as pasted). Words (@freitag) are left:
        // they meant a day relative to when they were written.
        const text = e.clipboardData?.getData("text/plain") ?? "";
        const dates = text.includes("@") && !inCode(view.state, r.from) ? looseDates(text).filter((d) => d.numeric) : [];
        if (!dates.length) return false;
        e.preventDefault();
        view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
        view.dispatch({
          changes: dates.map((d) => ({ from: r.from + d.from, to: r.from + d.to, insert: `@${d.iso}` })),
          annotations: isolateHistory.of("before"),
          userEvent: "input.autocorrect",
        });
        return true;
      },
      // Keys stay with the editor: not the page's or Thunderbird's shortcuts.
      keydown(e, view) {
        e.stopPropagation();
        // Ctrl+Shift+7 / 8 (also on macOS: Cmd+Shift+7 is the system's Help search on German
        // keyboards): numbered / bulleted list, by physical key.
        if (e.ctrlKey && !e.metaKey && e.shiftKey && !e.altKey && (e.code === "Digit7" || e.code === "Digit8")) {
          e.preventDefault();
          return rewriteLines(e.code === "Digit7" ? toggleNumbered : toggleBullets)(view);
        }
        // Colour shortcuts by physical key: with Option held, macOS reports special characters.
        const digit = /^Digit([1-8])$/.exec(e.code);
        if (digit && e.altKey && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          o.onColourKey?.(Number(digit[1]) - 1);
          return true;
        }
        // A dead key (Option+U on macOS) starts a composition: clear a selection before it does.
        if (e.key === "Dead") deleteSelection(view);
        return false;
      },
    }),
  ];

  const view = new EditorView({
    root: o.root,
    parent: o.parent,
    state: EditorState.create({ doc: o.doc, extensions }),
  });

  const removeMenu = attachEditMenu(
    {
      element: view.contentDOM,
      selectedText: () => {
        const r = view.state.selection.main;
        return view.state.doc.sliceString(r.from, r.to);
      },
      replaceSelection: (text) => view.dispatch(view.state.replaceSelection(text)),
      selectAll: () => {
        view.focus();
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      },
    },
    o.menuContainer,
    o.clipboard,
    o.extraMenuItems,
    (e) => {
      // The colour row stays on top; then what applies where the click was; then Cut/Copy/…
      let colours = o.topMenuItems?.(e) ?? [];
      const here: MenuItem[] = [];
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      // On a link: open it (the email, for an email link).
      const url = pos === null ? null : urlAt(view.state, pos);
      if (url && /^(?:https?:|mailto:|mid:|www\.)/i.test(url)) {
        here.push({ label: /^mid:/i.test(url) ? "Open email" : "Open link", kbd: `${MOD}click`, run: () => o.openLink(url) });
      }
      // On an "@" date that isn't ISO yet: convert it.
      if (pos !== null) {
        const line = view.state.doc.lineAt(pos);
        const loose = looseDates(line.text).find((d) => pos >= line.from + d.from && pos <= line.from + d.to);
        if (loose) {
          here.push({
            label: `Convert to date (${formatDue(loose.iso)})`,
            run: () => view.dispatch({ changes: { from: line.from + loose.from, to: line.from + loose.to, insert: `@${loose.iso}` }, userEvent: "input" }),
          });
        }
      }
      // On a label: its colour (D40).
      if (pos !== null && o.labelColourItems) {
        const line = view.state.doc.lineAt(pos);
        for (const m of line.text.matchAll(new RegExp(LABEL.source, "gu"))) {
          const start = line.from + m.index! + m[1]!.length;
          if (pos >= start && pos <= start + 1 + m[2]!.length) {
            here.push(...o.labelColourItems(m[2]!));
            colours = []; // the label's colour row replaces the note's (two were confusing)
          }
        }
      }
      // On a bare URL: write it as a Markdown link.
      const bare = pos === null ? null : bareUrlAt(view.state, pos);
      if (bare) here.push({ label: "Turn link into Markdown format", run: () => linkifyRange(view, bare) });
      // Copy the task on this line (anywhere on it) or the note as Markdown (D38's conventions).
      here.push(...(o.copyMenuItems?.(view.state.doc.toString(), pos === null ? null : view.state.doc.lineAt(pos).number - 1) ?? []));
      if (colours.length && here.length) here[0] = { ...here[0]!, separator: true };
      const items = [...colours, ...here];
      return items;
    }
  );

  return {
    getValue: () => view.state.doc.toString(),
    select: (from, to) => view.dispatch({ selection: { anchor: from, head: to } }),
    focus: () => view.focus(),
    blur: () => view.contentDOM.blur(),
    cursorCoords() {
      try {
        return view.coordsAtPos(view.state.selection.main.head);
      } catch {
        return null;
      }
    },
    placeCursor(point, to) {
      // Measured with every line as in the shown note (`placing`), then the cursor goes there.
      view.dispatch({ effects: setPlacing.of(true) });
      const pos = point ? view.posAtCoords(point) : null;
      const anchor = pastLinkText(view.state, pos ?? view.state.doc.length);
      const head = to ? pastLinkText(view.state, view.posAtCoords(to) ?? anchor) : anchor;
      // No scrollIntoView: the cursor is where the user clicked, so it is visible already;
      // scrolling made long notes jump.
      view.dispatch({ selection: { anchor, head }, effects: setPlacing.of(false) });
      view.focus();
    },
    placeAtLine(line) {
      const pos = view.state.doc.line(Math.min(Math.max(line + 1, 1), view.state.doc.lines)).to;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    },
    destroy() {
      removeMenu();
      view.destroy();
    },
  };
}
