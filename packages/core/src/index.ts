/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @thundernotes/core — client-independent logic (D13).
 * No Thunderbird, Outlook or Node APIs may be imported here.
 */

/** Reference to an email, keyed by its Message-ID (D2). */
export interface EmailRef {
  messageId: string;
  subject?: string;
  from?: string;
  date?: string;
  folderHint?: string;
  /**
   * The account the notes belong to, by its address (D42): written to exported files, so an
   * import lands in the matching account on any computer. Not Thunderbird's own id, which differs
   * between computers.
   */
  account?: string;
  /** Local only (not written to files): Thunderbird's id of the account the notes belong to (D42). */
  accountId?: string;
}

/** W3C Web Annotation selectors (D3). */
export interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface TextPositionSelector {
  type: "TextPositionSelector";
  start: number;
  end: number;
}

/**
 * A whole picture in the email (D46): ThunderNotes' own selector, as the W3C ones select text.
 * Found by its address, then its place among the pictures and the text around it.
 */
export interface ImageSelector {
  type: "ImageSelector";
  /** Its address as `imageKey` stores it: the same on every computer. */
  src: string;
  /** Its place among the email's pictures, 0 for the first. */
  index: number;
  alt?: string;
  /** The text just before and after it, as for a quote. */
  prefix?: string;
  suffix?: string;
}

export interface Annotation {
  id: string;
  /** Text: a quote and its position. A picture: one ImageSelector. None: the whole-email note. */
  selectors: Array<TextQuoteSelector | TextPositionSelector | ImageSelector>;
  colour?: string;
  bodyMd: string;
  created: string;
  /** Newest change of any part (text, colour, tags). */
  updated: string;
  tags?: string[];
  /** Per part (D32), so a colour change never wins over a text edit; missing = `updated`. */
  textUpdated?: string;
  colourUpdated?: string;
  /** Device that wrote the text (shown in conflict boxes). */
  textBy?: string;
  /** In carriers: hash8 of the synced text this one was edited from (the merge's base). */
  textBase?: string;
  /**
   * In carriers: hash8 of every synced text the writer remembers, newest first (the first is
   * `textBase`). The receiver merges against the newest it knows too (docs/SYNC.md).
   */
  textBases?: string[];
}

/** One set per email (D4): one file, one carrier message. */
/**
 * A deleted annotation, kept so other devices delete it too (D7): with a copy for 30 days
 * (restorable, D33), then as a bare record for a year, so a device that was away longer than
 * the 30 days doesn't bring the note back (design review, issue #1); then dropped.
 */
export interface Tombstone {
  id: string;
  deleted: string;
  /** A copy of what was deleted, so it can be restored within the 30 days (D33). */
  annotation?: Annotation;
}

/** Whether a card is folded to its quote line (D30), with its own time: never competes with note edits. */
export interface FoldState {
  folded: boolean;
  at: string;
}

export interface AnnotationSet {
  version: 1;
  email: EmailRef;
  rev: number;
  created: string;
  updated: string;
  emailNoteMd?: string;
  /** When the whole-email note last changed; merges compare this, not `updated`. */
  emailNoteUpdated?: string;
  /** Palette colour name of the whole-email note (D29); yellow when missing. */
  emailNoteColour?: string;
  emailNoteColourUpdated?: string;
  emailNoteBy?: string;
  emailNoteBase?: string;
  emailNoteBases?: string[];
  annotations: Annotation[];
  tombstones?: Tombstone[];
  /** Synced card folding by annotation id (only with the "sync collapsed notes" setting, D30). */
  folded?: Record<string, FoldState>;
  /**
   * The whole-email note's text when it was last deleted (emptied), for restoring (D33); after
   * 30 days only the time (`md` gone), kept for a year like tombstones.
   */
  deletedEmailNote?: { md?: string; deleted: string };
  /**
   * Copies of what was deleted up to this time are gone for good (purged, D33): on every device,
   * whichever copy a merge brings. The tombstones themselves stay, for the deletions to sync.
   */
  purgedBefore?: string;
  /**
   * Local only (not written to files): recent synced texts per note id (EMAIL_NOTE_KEY for the
   * whole-email note), newest last. A carrier names its base by hash; this finds the text (D32).
   */
  syncHistory?: Record<string, string[]>;
}


/** Whether a set holds anything for the user (not just tombstones). */
export function hasContent(set: AnnotationSet | null | undefined): boolean {
  return !!set && (set.annotations.length > 0 || !!set.emailNoteMd);
}

/** Whether a set still records deletions other devices must learn about (so it and its carrier stay). */
export function hasDeletions(set: AnnotationSet | null | undefined): boolean {
  return !!set && (!!set.tombstones?.length || !!set.deletedEmailNote);
}

export * from "./anchoring/normalise.js";
export * from "./anchoring/dom.js";
export * from "./anchoring/match.js";
export * from "./anchoring/image.js";
export * from "./markdown.js";
export * from "./format.js";
export * from "./restore.js";
export * from "./carrier.js";
export * from "./colours.js";
export * from "./conflict.js";
export * from "./email-links.js";
export * from "./tasks.js";
export { codeLines } from "./markdown-structure.js";
export * from "./settings.js";
export * from "./label-colours.js";
export * from "./label-order.js";
export * from "./preview.js";
