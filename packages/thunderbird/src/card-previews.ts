/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The whole-email notes' previews for the message list's cards (D26): one line of plain text per
// email, handed to the Experiment, which shows it on that email's card. It never reads the notes
// itself. Setting "Show the email note's preview in the cards view" (on unless switched off).

import { colourOf, darker, hasContent, notePreview, rgba, textOn, type AnnotationSet } from "@thundernotes/core";

/** One card's preview: its text, and the note's colour for the lozenge it sits in (as the margin's cards). */
export interface CardPreview {
  text: string;
  background: string;
  color: string;
  border: string;
}

export const CARD_PREVIEW_KEY = "cardPreview";

/** The key the Experiment finds a card's email by: its account and its Message-ID (no brackets). */
export function cardKey(accountId: string | undefined, messageId: string): string {
  return `${accountId ?? ""}|${messageId.replace(/^<|>$/g, "")}`;
}

/** Previews of all emails with a whole-email note, by cardKey. */
export function cardPreviews(sets: AnnotationSet[]): Record<string, CardPreview> {
  const out: Record<string, CardPreview> = {};
  for (const set of sets) {
    if (!hasContent(set) || !set.emailNoteMd?.trim()) continue;
    const text = notePreview(set.emailNoteMd);
    if (!text) continue;
    const colour = colourOf(set.emailNoteColour);
    out[cardKey(set.email.accountId, set.email.messageId)] = { text, background: rgba(colour), color: textOn(colour), border: darker(colour) };
  }
  return out;
}
