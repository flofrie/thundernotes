/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Quick ways to write checkboxes, shared by both note editors (live editor, textarea):
// - cycleTask (Cmd/Ctrl+L, as in Obsidian): text -> "- [ ]" -> "- [x] … ✅ date" -> "- [ ]" ...
//   (setting "checkboxCycleToText": "- [x]" -> text instead)
// - toggleChecklist (Cmd/Ctrl+Shift+L, as in Apple Notes): lines become a checklist, or a
//   checklist goes back to plain text.
// - expandTaskShortcut ("[]" or "[ ]" + space at the start of a line, as in Notion): "- [ ] ".
// - toggleNumbered / toggleBullets (Ctrl+Shift+7 / 8, on macOS too):
//   lines become a numbered or bulleted list (checkboxes stay), or go back to plain text.

import { DONE_DATE, markDone } from "@thundernotes/core";

/** indent, list marker (with its spaces), task box (with its space), rest. */
const LINE = /^(\s*)((?:[-*+]|\d+[.)])\s+)?(\[[ xX]\]\s?)?(.*)$/;

function parts(line: string): { indent: string; marker: string; box: string; rest: string } {
  const m = LINE.exec(line)!;
  return { indent: m[1]!, marker: m[2] ?? "", box: m[3] ?? "", rest: m[4]! };
}

export const isTask = (line: string): boolean => parts(line).box !== "";

/** Removes a line's checkbox, a bullet that only existed for it (numbers stay) and its finished date. */
function plain(line: string): string {
  const { indent, marker, rest } = parts(line);
  const text = rest.replace(new RegExp(`[ \\t]*${DONE_DATE.source}`, "gu"), "");
  return /^\d/.test(marker) ? `${indent}${marker}${text}` : `${indent}${text}`;
}

/**
 * Cmd/Ctrl+L: one step through plain -> unchecked -> checked -> unchecked; with
 * `toText`, a checked task goes back to plain text instead.
 */
export function cycleTask(line: string, toText = false): string {
  const { indent, marker, box, rest } = parts(line);
  if (!box) return `${indent}${marker || "- "}[ ] ${rest}`;
  // Ticked: with the date it was finished; unticked or back to text: without (D38).
  if (/x/i.test(box)) return toText ? plain(line) : markDone(line, false);
  return markDone(marker ? line : `${indent}- ${box}${rest}`, true);
}

/** Cmd/Ctrl+Shift+L: all tasks -> plain text; otherwise every non-empty line -> unchecked task. */
export function toggleChecklist(lines: string[]): string[] {
  const content = lines.filter((l) => l.trim());
  if (content.length && content.every(isTask)) return lines.map((l) => (l.trim() ? plain(l) : l));
  return lines.map((l) => (!l.trim() || isTask(l) ? l : cycleTask(l)));
}

/**
 * Typing a space after "[]" or "[ ]" at the start of a line (after indentation or a bullet):
 * the text before the cursor, rewritten as "- [ ] ", or null if it isn't the shortcut.
 */
export function expandTaskShortcut(beforeCursor: string): string | null {
  const m = /^(\s*)((?:[-*+]|\d+[.)])\s+)?\[ ?\]$/.exec(beforeCursor);
  return m ? `${m[1]}${m[2] ?? "- "}[ ] ` : null;
}

/**
 * Ctrl+Shift+7: every non-empty line numbered (1., 2., … per indentation level), keeping
 * checkboxes; if all already are, back to plain text. The editor's renumbering then fits the
 * numbers into a list the lines continue.
 */
export function toggleNumbered(lines: string[]): string[] {
  const content = lines.filter((l) => l.trim());
  if (content.length && content.every((l) => /^\d/.test(parts(l).marker))) {
    return lines.map((l) => (l.trim() ? `${parts(l).indent}${parts(l).rest}` : l));
  }
  const counters = new Map<number, number>();
  return lines.map((l) => {
    if (!l.trim()) return l;
    const { indent, box, rest } = parts(l);
    for (const level of [...counters.keys()]) if (level > indent.length) counters.delete(level);
    const n = (counters.get(indent.length) ?? 0) + 1;
    counters.set(indent.length, n);
    return `${indent}${n}. ${box}${rest}`;
  });
}

/** Ctrl+Shift+8: every non-empty line a bullet ("- "), keeping checkboxes; if all are, plain text. */
export function toggleBullets(lines: string[]): string[] {
  const content = lines.filter((l) => l.trim());
  if (content.length && content.every((l) => /^[-*+]/.test(parts(l).marker))) {
    return lines.map((l) => (l.trim() ? `${parts(l).indent}${parts(l).rest}` : l));
  }
  return lines.map((l) => {
    if (!l.trim()) return l;
    const { indent, box, rest } = parts(l);
    return `${indent}- ${box}${rest}`;
  });
}
