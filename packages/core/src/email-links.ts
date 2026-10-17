/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Links between emails (D37): plain Markdown links whose target is the email's Message-ID as
 * an RFC 2392 `mid:` URL, so they survive moving and archiving, work in every account and on
 * every device, and stay readable in any Markdown tool:
 *
 *   [Contract renewal – Anna Meier, 12 Oct 2026](mid:abc123@example.com)
 */

/** The `mid:` URL of a Message-ID (without angle brackets). */
export function midUrl(messageId: string): string {
  const id = messageId.trim().replace(/^<|>$/g, "");
  // RFC 2392: the addr-spec, percent-encoded where URLs (and Markdown link targets) need it.
  // encodeURIComponent leaves ( ) alone, which would end a Markdown link early.
  return `mid:${encodeURIComponent(id).replace(/%40/g, "@").replace(/\(/g, "%28").replace(/\)/g, "%29")}`;
}

/** The Message-ID a `mid:` URL points to, or null (other URLs, or a mid: with a content part). */
export function messageIdOf(url: string): string | null {
  const m = /^mid:([^/]+)$/i.exec(url.trim());
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

export interface LinkedEmail {
  messageId: string;
  subject?: string;
  /** "Anna Meier <anna@example.com>" or just the address. */
  author?: string;
  /** ISO time or anything Date understands. */
  date?: string | Date;
}

/**
 * Link text for Markdown: only brackets without a partner are escaped. Balanced pairs are valid
 * CommonMark link text ("[tn-spike] C" stays as it is); the editor finds such links itself
 * (its parser would read an inner "[x]" as a link of its own).
 */
export function linkText(text: string): string {
  const unmatched = new Set<number>();
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "[") open.push(i);
    else if (text[i] === "]") {
      if (open.length) open.pop();
      else unmatched.add(i);
    }
  }
  for (const i of open) unmatched.add(i);
  return [...text].map((c, i) => (unmatched.has(i) ? `\\${c}` : c)).join("");
}

/** The sender's name, or the address when there is no name. */
export function senderName(author: string | undefined): string {
  if (!author) return "";
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(author);
  return (m ? m[1]!.trim() || m[2]! : author).trim();
}

/** `[Subject – Sender, 12 Oct 2026](mid:…)`: the label tells emails with the same subject apart. */
export function emailLink(email: LinkedEmail, locale?: string): string {
  const parts = [email.subject?.trim() || "(no subject)"];
  const sender = senderName(email.author);
  const date = email.date ? new Date(email.date) : null;
  const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : "";
  const tail = [sender, when].filter(Boolean).join(", ");
  const label = linkText(`${parts[0]}${tail ? ` – ${tail}` : ""}`);
  return `[${label}](${midUrl(email.messageId)})`;
}

/** Message-IDs of the emails a note links to (`mid:` link targets and `<mid:…>` autolinks). */
export function linkedMessageIds(md: string): string[] {
  const ids = new Set<string>();
  for (const m of md.matchAll(/\]\(\s*<?(mid:[^)\s>]+)>?\s*\)|<(mid:[^>\s]+)>/gi)) {
    const id = messageIdOf(m[1] ?? m[2]!);
    if (id) ids.add(id);
  }
  return [...ids];
}
