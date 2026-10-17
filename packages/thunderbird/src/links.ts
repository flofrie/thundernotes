/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Pasting a URL into a note writes a Markdown link, so the file says what the card shows
// (before, a bare URL was only linked when displayed). Used by both editors and their
// right-click Paste; Cmd/Ctrl+K and the right-click menu turn a bare URL into one.

import { linkText } from "@thundernotes/core";

// A web address starts with https://, http:// or www. (as in the editor's link look and the
// shown note); mailto: too. Bare "example.com" isn't one: without a list of top-level domains
// it would catch "file.txt" or "node.js".
const URL_ONLY = /^(?:https?:\/\/|mailto:|www\.)\S+$/i;

/** Whether the text is a single URL (http(s), www. or mailto). */
export function isUrl(text: string): boolean {
  return URL_ONLY.test(text.trim());
}

/** The address a link goes to: "www.…" gets "https://" in front. */
export function webUrl(url: string): string {
  return /^www\./i.test(url) ? `https://${url}` : url;
}

/** Link text for a bare URL: without scheme, "www." and a trailing slash; mailto: the address. */
export function linkLabel(url: string): string {
  if (/^mailto:/i.test(url)) return url.slice(7).split("?")[0]!;
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/** Heading, quote, list and task markers at the start of a line: they stay outside a link. */
const LINE_MARKUP = /^\s*(?:(?:#{1,6}|>)\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)*/;

/**
 * Splits a selection into what stays outside a link and what becomes its text: line markup
 * (`# `, `- [ ] `, `> `…) when the selection starts at the line's start (`before` is blank),
 * and surrounding whitespace.
 */
export function splitForLink(selected: string, before = ""): { lead: string; label: string; trail: string } {
  const lead = (!before.trim() ? LINE_MARKUP.exec(selected)?.[0] : /^\s*/.exec(selected)?.[0]) ?? "";
  const rest = selected.slice(lead.length);
  const trail = /\s*$/.exec(rest)![0];
  return { lead, label: rest.slice(0, rest.length - trail.length), trail };
}

/** `[label](url)`: unmatched brackets in the label escaped, brackets in the URL encoded. */
export function markdownLink(label: string, url: string): string {
  return `[${linkText(label)}](${url.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
}

/**
 * What to insert when `text` is pasted over `selected`, with `before` = the text before the
 * cursor on its line. A URL becomes `[selected](url)`, or `[label](url)` with nothing selected;
 * null = paste as is (not a URL, or already inside a link's `](…)` or `<…>`).
 */
export function linkForPaste(text: string, selected: string, before = ""): string | null {
  const url = text.trim();
  if (!URL_ONLY.test(url) || /\]\($|<$/.test(before)) return null;
  const { lead, label, trail } = splitForLink(selected, before);
  return `${lead}${markdownLink(label || linkLabel(url), webUrl(url))}${trail}`;
}
