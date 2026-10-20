/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A note as one line of plain text, for a preview where only a line fits (the message list's
 * cards, D26): Markdown marks dropped, checklist items as ☐ / ☑, links as their text, lines
 * joined with " · ". Not a renderer: what it can't simplify stays as typed.
 */

/** Characters kept: more than a line ever shows, few enough to send for every email. */
export const PREVIEW_LENGTH = 300;

function line(text: string): string {
  return (
    text
      // Block marks at the start: headings, quotes, list bullets and numbers, checkboxes.
      .replace(/^\s*(?:>\s*)+/, "")
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s*/, (_, box: string) => (box === " " ? "☐ " : "☑ "))
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      // Inline: images and links as their text, code without backticks, emphasis without its marks.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<((?:https?|mailto|mid):[^>\s]+)>/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** The note as one line of plain text, at most `max` characters (then ending in "…"). */
export function notePreview(md: string, max = PREVIEW_LENGTH): string {
  const lines: string[] = [];
  let fence = false;
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    const text = fence ? raw.trim() : line(raw);
    if (text && !/^(?:-{3,}|\*{3,}|_{3,})$/.test(text)) lines.push(text);
  }
  const all = lines.join(" · ");
  return all.length > max ? `${all.slice(0, max - 1).trimEnd()}…` : all;
}
