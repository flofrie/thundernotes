/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Messages between the message display script and the background.

import type { Annotation, AnnotationSet } from "@thundernotes/core";

/** Id of the card (and colour target) for the note on the whole email. */
export const EMAIL_NOTE_ID = "email-note";

/** Message display script -> background. The background resolves the email from the sender's tab. */
export type ToBackground =
  | { type: "load" }
  | { type: "add"; annotation: Annotation }
  | { type: "remove"; id: string }
  | { type: "update"; id: string; bodyMd: string }
  | { type: "setEmailNote"; md: string }
  | { type: "setColour"; id: string; colour: string }
  /** The emails whose notes link to this one (D37). */
  | { type: "backlinks" }
  /** Labels used in notes, most used first, for autocomplete (D38). */
  | { type: "labels" }
  /** Candidates for the link picker (D39): emails matching the words, or likely ones without words. */
  | { type: "searchEmails"; query: string }
  /** Brings back what was deleted on this email in the last 30 days (D33). */
  | { type: "restoreDeleted" }
  /** Deletes the copies of what was deleted on this email for good, on all devices (D33). */
  | { type: "purgeDeleted" }
  /** A card folded to its quote line or opened again (D30). */
  | { type: "setFolded"; id: string; folded: boolean }
  | { type: "render"; md: string }
  | { type: "openLink"; url: string }
  | { type: "readClipboard" }
  | { type: "writeClipboard"; text: string }
  /**
   * Copies as Markdown (D38's conventions): a task (the item at `line` of the note's text `md`,
   * as shown or being edited), a note, or all notes of the email in reading order (`order`).
   * Answers whether something was copied.
   */
  | { type: "copyMarkdown"; what: "task"; id: string; md: string; line: number }
  | { type: "copyMarkdown"; what: "note"; id: string; md: string }
  | { type: "copyMarkdown"; what: "all"; order: string[] }
  /** The note's text with its k-th "@" date shaped `text` (outside code) written as an ISO date; null if gone. */
  | { type: "convertLooseDate"; md: string; text: string; k: number }
  | { type: "setPref"; key: "marginCollapsed"; value: boolean }
  | { type: "setPref"; key: "marginWidth"; value: number | null }
  | { type: "setPref"; key: "lastColour"; value: string }
  /** Counters for the header button: notes (with text, incl. the whole-email note) and plain highlights. */
  | { type: "status"; notes: number; highlights: number; partial: number; orphan: number; conflicts: number }
  /** A note opened from the task view: the keyboard focus into the message, so editing starts (D38). */
  | { type: "focusPane" }
  /** A label's colour (null: no colour), for all devices (D40). */
  | { type: "setLabelColour"; label: string; colour: string | null; accountIds?: string[] };

export interface Responses {
  load: {
    set: AnnotationSet | null;
    debug: boolean;
    marginCollapsed: boolean;
    marginWidth: number | null;
    carrier: boolean;
    /** Ids of the cards shown folded (D30). */
    folded: string[];
    /** The email's Message-ID (key of its drafts, D34). */
    ref: string;
    /** The account the email is in (D42): its label colours apply. */
    accountId?: string;
    /** Opened from the task view (D38): the note to edit, the cursor at the end of the task's line. */
    focus?: { id: string; line: number };
  };
  add: AnnotationSet;
  remove: AnnotationSet | null;
  update: AnnotationSet;
  setEmailNote: AnnotationSet | null;
  setColour: AnnotationSet;
  restoreDeleted: AnnotationSet | null;
  purgeDeleted: AnnotationSet | null;
  backlinks: Backlink[];
  searchEmails: EmailCandidate[];
  labels: string[];
  /** The set when the folding was synced into it, else null. */
  setFolded: AnnotationSet | null;
  render: string;
  openLink: void;
  readClipboard: string;
  writeClipboard: void;
  copyMarkdown: boolean;
  convertLooseDate: string | null;
  setPref: void;
  focusPane: void;
  setLabelColour: void;
  status: void;
}

/** Background -> message display script. */
export type ToContent =
  | { type: "highlightSelection" }
  | { type: "setDebug"; on: boolean }
  /** What was right-clicked: answers a ContextInfo. */
  | { type: "contextTarget" }
  | { type: "removeTarget" }
  /** Context menu "Add note" / "Edit note" on a highlight. */
  | { type: "noteTarget" }
  | { type: "colourTarget"; colour: string }
  /** For the popup: answers a ListState. */
  | { type: "listState" }
  /** From the popup: scroll to a highlight and open its card. */
  /** Also from the task view (D38): with the task's line, for this email only (`ref`); answers whether it was found. */
  | { type: "focus"; id: string; line?: number; ref?: string }
  | { type: "editEmailNote" }
  /** From the popup: restore what was deleted on this email (D33). */
  | { type: "restoreDeleted" }
  /** From the popup: delete the copies of what was deleted on this email for good (D33). */
  | { type: "purgeDeleted" }
  /** From the menus and the popup: copy all notes of this email as Markdown. */
  | { type: "copyAllNotes" }
  /** Is a note being edited in this message? (Answers a boolean.) */
  | { type: "isEditing" }
  /** Stored notes changed elsewhere (import): reload and redraw. */
  | { type: "refresh" };

/** An email offered by the link picker (D39). */
export interface EmailCandidate {
  messageId: string;
  subject: string;
  author: string;
  date: string;
  folder: string;
  hasNotes: boolean;
  /** Same conversation as the email being annotated (same subject without Re:/Fwd:). */
  sameThread: boolean;
}

/** An email whose notes link to the displayed one (D37). */
export interface Backlink {
  /** The account of the linking notes (D42): its copy is the one opened. */
  accountId?: string;
  messageId: string;
  subject: string;
  from: string;
  date: string;
  /** Quotes of the notes with the link ("" = the note on the whole email). */
  quotes: string[];
}

/** Answer to `contextTarget`: drives which of our items the context menu shows. */
export interface ContextInfo {
  /** The highlight or note card that was right-clicked, if any. */
  target: { hasNote: boolean; colour: string } | null;
  /** Right-click inside a note's text box (our items stay hidden there). */
  inEditor: boolean;
  /** A text selection in the email body that could be highlighted. */
  selectionInBody: boolean;
  /** The email has notes with text (for "Copy all notes as Markdown"). */
  hasNotes: boolean;
}

/** One entry in the popup's list, in reading order. */
export interface ListItem {
  id: string;
  quote: string;
  bodyMd: string;
  colour: string;
  status: "anchored" | "partial" | "orphan";
}

export interface ListState {
  emailNoteMd: string;
  emailNoteColour?: string;
  items: ListItem[];
  /** Notes and highlights deleted in the last 30 days that can be restored (D33). */
  restorable: number;
  /** Emails whose notes link to this one (D37). */
  backlinks: Backlink[];
}
