/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// FROZEN COPY of packages/core/src/code-blocks.ts at 4116f81, for the format-1 reader. Don't edit.

// Which lines of a note are code (issues #4, #5): read line by line as CommonMark does, so that
// everything that looks at a note's lines (sections of a file, tasks, labels, headings, blank
// lines) agrees with what the renderer draws as code.
// - Fenced code: opened by 3+ backticks or tildes (up to 3 spaces in; any indentation inside a
//   list item), closed only by a line of the same character, at least as long, with nothing but
//   spaces after it; an opening backtick fence's info string may not contain a backtick.
// - Indented code: 4+ spaces (a tab counts 4) after a blank line or more indented code, outside
//   lists (in a list item such lines are its content: nested items, continuation).
// Quote markers (">") in front are looked through.

const QUOTE = /^(?:\s{0,3}>\s?)*/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

const width = (s: string) => [...s].reduce((n, c) => n + (c === "\t" ? 4 - (n % 4) : 1), 0);

export class CodeScanner {
  private fence: { char: string; length: number } | null = null;
  private blankBefore = true;
  private indentedCode = false;
  private inList = false;

  /** Starts over (a new note in a file). */
  reset(): void {
    this.fence = null;
    this.blankBefore = true;
    this.indentedCode = false;
    this.inList = false;
  }

  /** Whether code is open (an unclosed fence). */
  get inFence(): boolean {
    return this.fence !== null;
  }

  /** The fence that would close the open code ("```", "~~~~" …); null when none is open. */
  get closingFence(): string | null {
    return this.fence ? this.fence.char.repeat(this.fence.length) : null;
  }

  /** The next line: whether it is code (a fence line itself counts as code). */
  feed(raw: string): boolean {
    const line = raw.slice(QUOTE.exec(raw)![0].length);
    const indent = width(/^[ \t]*/.exec(line)![0]);
    const text = line.trimStart();
    if (this.fence) {
      const close = /^(`{3,}|~{3,})[ \t]*$/.exec(text);
      if (close && (indent <= 3 || this.inList) && close[1]![0] === this.fence.char && close[1]!.length >= this.fence.length) this.fence = null;
      this.blankBefore = false;
      return true;
    }
    if (!text) {
      this.blankBefore = true;
      return this.indentedCode; // a blank line inside indented code belongs to it
    }
    const open = /^(`{3,}|~{3,})(.*)$/.exec(text);
    if (open && (indent <= 3 || this.inList) && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      this.fence = { char: open[1]![0]!, length: open[1]!.length };
      this.blankBefore = false;
      this.indentedCode = false;
      return true;
    }
    if (indent >= 4 && !this.inList && (this.blankBefore || this.indentedCode)) {
      this.indentedCode = true;
      this.blankBefore = false;
      return true;
    }
    // Ordinary text: a list goes on with items, indented lines and lazy continuation; text that
    // isn't indented after a blank line (or a heading) ends it.
    if (LIST_ITEM.test(line)) this.inList = true;
    else if (indent === 0 && (this.blankBefore || /^#{1,6}(?:\s|$)/.test(text))) this.inList = false;
    this.indentedCode = false;
    this.blankBefore = false;
    return false;
  }
}

/** The indexes of a text's code lines. */
export function codeLines(md: string): Set<number> {
  const scanner = new CodeScanner();
  const out = new Set<number>();
  md.split("\n").forEach((line, i) => scanner.feed(line) && out.add(i));
  return out;
}
