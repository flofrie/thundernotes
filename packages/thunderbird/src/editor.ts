/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { cycleTask, expandTaskShortcut, toggleChecklist } from "./checklist.js";
import type { EditTarget } from "./edit-menu.js";
import { linkForPaste } from "./links.js";

// Markdown helpers for a plain <textarea> (D22; fallback editor since D28): list continuation, indenting,
// bold/italic, a pasted URL becomes a Markdown link, save/cancel keys.

export interface EditorKeys {
  onSave(): void;
  onCancel(): void;
  /** Setting: Cmd/Ctrl+L turns a ticked checkbox back into text. */
  cycleToText?(): boolean;
}

const LIST_ITEM = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/;

/** Inserts text at the selection, keeping the textarea's undo history where possible. */
export function insertText(ta: HTMLTextAreaElement, text: string): void {
  ta.focus();
  if (!ta.ownerDocument.execCommand("insertText", false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function lineStart(value: string, pos: number): number {
  return value.lastIndexOf("\n", pos - 1) + 1;
}

function lineEnd(value: string, pos: number): number {
  const i = value.indexOf("\n", pos);
  return i === -1 ? value.length : i;
}

/** Enter in a list item: continue the list; Enter on an empty item: end it. */
function continueList(ta: HTMLTextAreaElement): boolean {
  const { value, selectionStart: pos } = ta;
  if (pos !== ta.selectionEnd) return false;
  const start = lineStart(value, pos);
  const line = value.slice(start, pos);
  const m = LIST_ITEM.exec(line);
  if (!m) return false;
  if (line.length === m[0].length && lineEnd(value, pos) === pos) {
    // Empty item: remove the marker, leave an empty line.
    ta.setSelectionRange(start, pos);
    insertText(ta, "");
    return true;
  }
  const [, indent, , number, delimiter, space, task] = m;
  const marker = number ? `${Number(number) + 1}${delimiter}` : m[2];
  insertText(ta, `\n${indent}${marker}${space}${task ? "[ ] " : ""}`);
  return true;
}

/** Tab / Shift+Tab: indent or outdent the selected lines (list lines or a multi-line selection). */
function indentLines(ta: HTMLTextAreaElement, outdent: boolean): boolean {
  const { value, selectionStart, selectionEnd } = ta;
  const start = lineStart(value, selectionStart);
  const end = lineEnd(value, selectionEnd);
  const block = value.slice(start, end);
  const multiLine = block.includes("\n");
  if (!multiLine && !LIST_ITEM.test(block)) return false;
  const lines = block.split("\n");
  const changed = lines.map((l) => (outdent ? l.replace(/^ {1,2}/, "") : `  ${l}`));
  const firstShift = changed[0]!.length - lines[0]!.length;
  ta.setSelectionRange(start, end);
  insertText(ta, changed.join("\n"));
  const newEnd = start + changed.join("\n").length;
  ta.setSelectionRange(multiLine ? start : Math.max(start, selectionStart + firstShift), multiLine ? newEnd : Math.max(start, selectionEnd + firstShift));
  return true;
}

/** Rewrites the lines touched by the selection (checkbox shortcuts). */
function rewriteLines(ta: HTMLTextAreaElement, change: (lines: string[]) => string[]): void {
  const { value, selectionStart, selectionEnd } = ta;
  const start = lineStart(value, selectionStart);
  const end = lineEnd(value, selectionEnd);
  const block = change(value.slice(start, end).split("\n")).join("\n");
  const shift = block.length - (end - start);
  ta.setSelectionRange(start, end);
  insertText(ta, block);
  ta.setSelectionRange(selectionStart + (selectionStart === selectionEnd ? shift : 0), selectionEnd + shift);
}

/** "[]" or "[ ]" + space at the start of a line becomes "- [ ] " (as in Notion). */
function taskShortcut(ta: HTMLTextAreaElement): boolean {
  const { value, selectionStart: pos } = ta;
  if (pos !== ta.selectionEnd) return false;
  const start = lineStart(value, pos);
  const expanded = expandTaskShortcut(value.slice(start, pos));
  if (!expanded) return false;
  ta.setSelectionRange(start, pos);
  insertText(ta, expanded);
  return true;
}

/** Wraps the selection in a marker (`**`, `_`); with no selection, places the caret between a pair. */
function wrap(ta: HTMLTextAreaElement, marker: string): void {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const selected = value.slice(s, e);
  insertText(ta, `${marker}${selected}${marker}`);
  ta.setSelectionRange(s + marker.length, s + marker.length + selected.length);
}

export function attachMarkdownHelpers(ta: HTMLTextAreaElement, keys: EditorKeys): void {
  ta.addEventListener("keydown", (e) => {
    // Keep keys away from the page's and Thunderbird's own shortcuts while typing.
    e.stopPropagation();
    const mod = e.ctrlKey || e.metaKey;
    let handled = false;
    if (e.key === "Enter" && mod) {
      keys.onSave();
      handled = true;
    } else if (e.key === "Escape") {
      keys.onCancel();
      handled = true;
    } else if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      handled = continueList(ta);
    } else if (e.key === "Tab" && !mod && !e.altKey) {
      handled = indentLines(ta, e.shiftKey);
    } else if (mod && !e.shiftKey && !e.altKey && e.code === "KeyB") {
      wrap(ta, "**");
      handled = true;
    } else if (mod && !e.shiftKey && !e.altKey && e.code === "KeyI") {
      wrap(ta, "_");
      handled = true;
    } else if (mod && e.shiftKey && !e.altKey && e.code === "KeyX") {
      wrap(ta, "~~");
      handled = true;
    } else if (mod && !e.altKey && e.code === "KeyL") {
      const toText = keys.cycleToText?.() ?? false;
      rewriteLines(ta, e.shiftKey ? toggleChecklist : (lines) => lines.map((l) => cycleTask(l, toText)));
      handled = true;
    } else if (e.key === " " && !mod && !e.altKey) {
      handled = taskShortcut(ta);
    }
    if (handled) e.preventDefault();
  });
  for (const type of ["keyup", "keypress"]) ta.addEventListener(type, (e) => e.stopPropagation());

  ta.addEventListener("paste", (e) => {
    const { selectionStart: s, selectionEnd: end, value } = ta;
    const before = value.slice(value.lastIndexOf("\n", s - 1) + 1, s);
    const link = linkForPaste(e.clipboardData?.getData("text/plain") ?? "", value.slice(s, end), before);
    if (!link) return;
    e.preventDefault();
    insertText(ta, link);
  });
}

// ---- context menu: textarea adapter for edit-menu.ts ---------------------------------------

/** The textarea as a target of the editor's own Cut/Copy/Paste menu. */
export function textareaTarget(ta: HTMLTextAreaElement): EditTarget {
  return {
    element: ta,
    selectedText: () => ta.value.slice(ta.selectionStart, ta.selectionEnd),
    replaceSelection: (text) => insertText(ta, text),
    selectAll: () => {
      ta.focus();
      ta.select();
    },
  };
}
