/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// One note card in the margin (D24, D28). Click the note to edit it in the live-preview editor
// (loaded on first use; the textarea of D22 is the fallback); leaving the card
// saves, Esc discards this editing session's changes, Ctrl/Cmd+Enter saves and
// stops editing. The bin deletes the note and its highlight. An empty note is a plain
// highlight: its card leaves the margin. A click on the quote line folds the card to that
// line or opens it again, as does the tab on its top edge (D30); a folded card still opens its editor when asked to edit.

import {
  COLOUR_NAMES,
  colourOf,
  formatDue,
  markDone,
  darker,
  parseConflicts,
  resolveConflict,
  rgba,
  textOn,
  type Annotation,
  type TextQuoteSelector,
  taskAtLine,
} from "@thundernotes/core";
import { EDIT_MENU_CSS, MOD, attachEditMenu, colourItem, labelColourItems, openMenu, type Clipboard, type MenuItem } from "./edit-menu.js";
import { attachMarkdownHelpers, textareaTarget } from "./editor.js";
import { loadLiveEditor } from "./live-loader.js";
import type { LiveEditor } from "./live/editor.js";
import type { EmailCandidate } from "./protocol.js";

export interface CardActions {
  /** Markdown -> sanitised HTML (rendered in the background). */
  render(md: string): Promise<string>;
  /** Clipboard via the background, for the editor's Cut/Copy/Paste menu. */
  clipboard: Clipboard;
  save(id: string, bodyMd: string): Promise<void>;
  remove(id: string): Promise<void>;
  openLink(url: string): void;
  /** Setting: Cmd/Ctrl+L turns a ticked checkbox back into text. */
  cycleToText(): boolean;
  /** Setting: numbered lists renumber themselves (D28). */
  renumberLists(): boolean;
  /** Setting: dates show the year always (off: "Hide the current year in dates"). */
  alwaysYear(): boolean;
  /** Emails for the link picker, and the setting "Cmd/Ctrl+K opens the link picker" (D39). */
  searchEmails(query: string): Promise<EmailCandidate[]>;
  linkPicker(): boolean;
  /** Labels used before, for autocomplete after "#" (D38). */
  knownLabels(): Promise<string[]>;
  /** Changes the highlight's colour (D29). */
  setColour(id: string, colour: string): void;
  /** A label's colour, null for none (D40); and choosing it. */
  labelColour(label: string): string | null;
  setLabelColour(label: string, colour: string | null): void;
  /** Keeps (text) or drops (null) the unsaved draft of a note being edited (D34). */
  draft(id: string, text: string | null): void;
  /** Copies as Markdown (D38's conventions): the task at `line` of the note's text, or the note. */
  copyTask(id: string, md: string, line: number): void;
  copyNote(id: string, md: string): void;
  /**
   * The text with its k-th "@" date shaped `text` converted to an ISO date (null: not there):
   * worked out in the background, which has the Markdown parser (D22).
   */
  convertLooseDate(md: string, text: string, k: number): Promise<string | null>;
}

/** Text typed into a note's editor but never saved (Thunderbird closed or crashed meanwhile). */
export interface Draft {
  text: string;
  at: string;
}

export const CARD_CSS = `
  /* Colour (D29): set per card by applyColour(): the highlight's colour over the card's base,
     text in black or white by WCAG contrast. */
  .card { position: absolute; box-sizing: border-box; font: 13px/1.45 system-ui, sans-serif;
          color: var(--card-fg, #222); background-color: var(--card-base, #fff);
          background-image: linear-gradient(var(--card-bg, transparent), var(--card-bg, transparent));
          border: 1px solid var(--card-border, #e3d690); border-radius: 8px; padding: 8px 10px;
          box-shadow: 0 1px 3px #0002; transition: top 0.12s ease, box-shadow 0.12s ease; }
  .card.active { box-shadow: 0 0 0 1px var(--card-border, #c9a400), 0 2px 10px #0003; }
  /* Colour picker button: four quadrants, so it reads as "colours" (the card shows the current one). */
  .colour-btn { position: absolute; top: 5px; right: 27px; width: 14px; height: 14px; border-radius: 50%; padding: 0;
                cursor: pointer; border: 1px solid #0006; box-shadow: none;
                background: conic-gradient(#fff04a 0 25%, #69db7c 0 50%, #74c0fc 0 75%, #f783ac 0); }
  .colour-btn:hover { transform: scale(1.15); }
  .bin { position: absolute; top: 4px; right: 4px; border: none; background: none; box-shadow: none; cursor: pointer;
         color: #c92a2a; display: flex; padding: 3px; border-radius: 4px; opacity: 0.75; }
  .bin svg { width: 14px; height: 14px; }
  .bin:hover { opacity: 1; background: #e0313120; }
  .quote.email { font-style: normal; font-weight: 600; }
  .status { display: none; font-size: 11px; font-weight: 600; margin: -4px 40px 6px 0; }
  .card.has-status .status { display: block; }
  .card.orphan .status { font-weight: normal; margin-right: 0; padding: 3px 6px; border-radius: 4px; cursor: help;
                         background: #fff4e6; color: #a63c06; border: 1px solid #ffc078; }
  .quote { opacity: 0.75; font-style: italic; margin: 0 40px 6px 0; overflow: hidden; text-overflow: ellipsis;
           white-space: nowrap; font-size: 12px; }
  /* Folding (D30): a small tab centred on the card's top edge while the card is hovered, so it never
     covers the quote; the quote line folds too. Chevron up = fold, down = open. Same colours as the card. */
  .card.has-text .quote { cursor: pointer; }
  .fold { display: none; position: absolute; top: -7px; left: 50%; transform: translateX(-50%); box-sizing: border-box;
          width: 26px; height: 13px; padding: 0; border: 1px solid var(--card-border, #e3d690); border-radius: 7px;
          cursor: pointer; color: var(--card-fg, #222); opacity: 0.75; box-shadow: none;
          background-color: var(--card-base, #fff);
          background-image: linear-gradient(var(--card-bg, transparent), var(--card-bg, transparent)); }
  .card.has-text:hover .fold { display: flex; align-items: center; justify-content: center; }
  .fold:hover { opacity: 1; }
  .fold svg { width: 10px; height: 6px; transition: transform 0.12s ease; }
  /* While editing the chevron always says "fold": a click there saves, leaves the editor and folds. */
  .card.folded:not(.editing) .fold svg { transform: rotate(180deg); }
  .card.folded:not(.editing) .view-note { display: none; }
  .card.folded:not(.editing) .quote { margin-bottom: 0; }
  .card.folded.has-status:not(.editing) .status { margin-bottom: 0; }
  /* A note changed on two devices (D32): a warning stripe, "2 versions" on the quote line (also
     when folded), and in the note a box per conflict with both versions and buttons to keep one. */
  .card.has-conflict { border-left: 4px solid #e8590c; }
  .conflict-badge { display: none; font-style: normal; font-weight: 600; font-size: 10.5px; color: #fff; background: #e8590c;
                    border-radius: 8px; padding: 0 6px; margin-right: 5px; }
  .card.has-conflict .conflict-badge { display: inline; }
  .tn-conflict-box { margin: 2px 0; padding: 4px 8px 6px; border: 1px solid #e8590c; border-left-width: 4px; border-radius: 6px;
                     background: #fff8f0; color: #222; cursor: default; }
  .tn-conflict-box .tn-conflict-title { font-weight: 600; }
  .tn-conflict-version { margin-top: 4px; }
  .tn-conflict-by { font-size: 11px; opacity: 0.75; }
  .tn-conflict-text:empty::before { content: "(removed)"; font-style: italic; opacity: 0.6; }
  .tn-conflict-box button { font: 11px system-ui, sans-serif; padding: 1px 9px; margin: 3px 6px 0 0; border-radius: 10px;
                            border: 1px solid #e8590c; background: #fff; color: #c2410c; cursor: pointer; box-shadow: none; }
  .tn-conflict-box button:hover { background: #ffe8cc; }
  /* Unsaved text found from an editing session that never ended (D34). */
  .draft { display: none; font-size: 11.5px; margin: -2px 0 6px; padding: 4px 8px; border-radius: 6px;
           background: #fff8f0; color: #222; border: 1px dashed #e8590c; }
  .card.has-draft .draft { display: block; }
  .draft button { font: 11px system-ui, sans-serif; padding: 1px 9px; margin: 3px 6px 0 0; border-radius: 10px;
                  border: 1px solid #e8590c; background: #fff; color: #c2410c; cursor: pointer; box-shadow: none; }
  .draft button:hover { background: #ffe8cc; }
  /* Due dates and labels (D38): lozenges like email links; dates in open checklist items are due
     dates, red when past (the renderer marks them) unless the setting "Past dates shown in red" is off. */
  .tn-chip { background: #0000000f; border: 1px solid #00000024; border-radius: 0.8em; padding: 0 0.45em; }
  .tn-date { white-space: nowrap; }
  /* An "@" date that isn't ISO yet: not a due date; dotted, its tooltip says what it would be. */
  .tn-loose-date { text-decoration: underline dotted; text-underline-offset: 0.2em; cursor: help; }
  /* When a task was finished (D38): small and grey, not struck through with the done task's text. */
  .tn-done-date { font-size: 0.82em; opacity: 0.6; white-space: nowrap; display: inline-block; text-decoration: none; }
  :host(:not(.no-overdue)) .tn-overdue { color: #c92a2a; border-color: #c92a2a80; background: #e0313114; font-weight: 600; }
  /* Autocomplete for @dates and #labels while editing. */
  .tn-suggest { position: absolute; z-index: 6; min-width: 160px; margin: 0; padding: 4px; list-style: none; font: 13px system-ui, sans-serif;
                color: #222; background: #fff; border: 1px solid #c8c8c8; border-radius: 8px; box-shadow: 0 4px 16px #0003; }
  .tn-suggest li { padding: 3px 8px; border-radius: 5px; cursor: pointer; display: flex; justify-content: space-between; gap: 12px; }
  .tn-suggest li.selected { background: #e8f0fe; }
  .tn-suggest .hint { opacity: 0.6; font-size: 11px; }
  /* The link picker (D39): a search box with a list of emails at the cursor. */
  .tn-picker { position: absolute; z-index: 6; width: 280px; padding: 6px; font: 13px system-ui, sans-serif; color: #222;
               background: #fff; border: 1px solid #c8c8c8; border-radius: 8px; box-shadow: 0 4px 16px #0003; }
  .tn-picker input { box-sizing: border-box; width: 100%; font: inherit; padding: 4px 6px; border: 1px solid #c8c8c8; border-radius: 5px;
                     color: inherit; background: #fff; }
  .tn-picker ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 260px; overflow-y: auto; }
  .tn-picker li { padding: 4px 6px; border-radius: 5px; cursor: pointer; }
  .tn-picker li.selected { background: #e8f0fe; }
  .tn-picker li.empty { color: #888; cursor: default; }
  .tn-picker .subject { font-weight: 600; overflow-wrap: anywhere; }
  .tn-picker .meta { font-size: 11px; opacity: 0.75; overflow-wrap: anywhere; }
  .tn-picker .tag { color: #0b57d0; }
  .note { overflow-wrap: anywhere; }
  .view-note { cursor: text; min-height: 1.4em; }
  .view-note:empty::before { content: "Click to write a note…"; opacity: 0.6; }
  /* Laid out line for line like the live-preview editor (src/live/editor.ts theme), so a click
     lands on the same line: no block margins (empty lines are rendered as lines), same heading
     sizes, inline bullets, same quote bar. */
  .note p, .note ul, .note ol, .note li, .note blockquote, .note pre, .note h1, .note h2, .note h3,
  .note h4, .note h5, .note h6 { margin: 0; padding: 0; }
  .note h1, .note h2, .note h3, .note h4, .note h5, .note h6 { font-weight: bold; }
  .note h1 { font-size: 1.25em; } .note h2 { font-size: 1.12em; } .note h3, .note h4, .note h5, .note h6 { font-size: 1.04em; }
  /* Lists: every marker (bullet, number, checkbox) takes the same width, 1.4em, hung into the
     item's left padding; so an item's text, its continuation lines and its sub-items all start
     one marker width in, exactly as the editor draws them (live/editor.ts, MARK). */
  .note ul, .note ol { list-style: none; }
  .note li { padding-left: 1.4em; }
  .note ul > li::before { content: "•"; display: inline-block; width: 1.4em; margin-left: -1.4em; }
  .note ol > li::before { content: counter(list-item) "."; display: inline-block; width: 1.4em; margin-left: -1.4em;
                          font-variant-numeric: tabular-nums; }
  .note ul > li.task::before { content: none; }
  .note ul > li.task > .task-box:first-child { margin-left: -1.4em; }
  /* Quotes: the bar is drawn on the quoted lines themselves, so a nested quote (> >) has one bar
     that moves in with its text, one step per level (as the editor), not a bar per level. */
  .note blockquote { opacity: 0.85; }
  .note blockquote > :not(blockquote) { border-left: 3px solid var(--card-border, #d8c66a); padding-left: 8px; }
  .note blockquote blockquote { margin-left: 1.2em; opacity: 1; }
  .note code { font-family: ui-monospace, monospace; font-size: 0.92em; background: #0000000f; border-radius: 3px; }
  /* Fenced code: a box whose top and bottom padding are one line each, where the editor shows
     the fence lines (D28), so the note doesn't change height when editing starts. Indented code
     (4 spaces) has no fence lines, so no padding. */
  .note pre { font: inherit; background: #0000000f; border-radius: 4px; padding: 0 8px; overflow-x: auto; }
  .note pre.fenced { padding: 1.45em 8px; }
  .note pre code { background: none; border-radius: 0; }
  /* One line high with the stripe at half height, drawn exactly like the editor's rule line. No
     margins: two rules in a row would otherwise share (collapse) them and sit closer together. */
  .note hr { border: none; margin: 0; height: 1.45em;
             background: linear-gradient(to bottom, transparent calc(50% - 0.5px), var(--card-border, #d8c66a) calc(50% - 0.5px),
                         var(--card-border, #d8c66a) calc(50% + 0.5px), transparent calc(50% + 0.5px)); }
  /* Underline drawn as a line under the whole link (not text-decoration), so it runs on through a
     date or label lozenge inside the link text (see-through) instead of breaking there. */
  .note a { color: inherit; text-decoration: none; cursor: pointer;
            background: linear-gradient(currentColor, currentColor) 0 calc(100% - 0.12em) / 100% 1px no-repeat; }
  /* Links to other emails (mid:, D37): a see-through rounded lozenge with an envelope, so they
     read as "an email" rather than a web link (the editor draws them alike). */
  .note a[href^="mid:"] { text-decoration: none; background: #0000000f; border: 1px solid #00000024; border-radius: 0.8em;
                          padding: 0 0.45em; } /* broken across a line break: open at the break (slice, the default) */
  .note a[href^="mid:"]::before { content: "✉ "; opacity: 0.65; }
  .note a[href^="mid:"]:hover { background: #0000001a; }
  .note s { text-decoration-thickness: 0.11em; }
  .hint { opacity: 0.65; font-size: 11px; margin-top: 4px; }
  /* First Esc with changes: a small framed message floating at the cursor (also in long notes,
     also with hints switched off), gone again after 3 s. */
  .esc-warning { display: none; position: fixed; z-index: 7; padding: 4px 10px; font: 600 12px system-ui, sans-serif;
                 color: #c92a2a; background: #fff; border: 1px solid #c92a2a; border-radius: 6px; box-shadow: 0 2px 10px #0003;
                 white-space: nowrap; pointer-events: none; }
  .card.esc-armed .esc-warning { display: block; }
  :host(.no-hints) .hint { display: none; }
  .edit { position: relative; }
  ${EDIT_MENU_CSS}
  textarea { box-sizing: border-box; width: 100%; min-height: 80px; resize: vertical; font: 12.5px/1.4 ui-monospace, monospace;
             border: 1px solid #ccc; border-radius: 4px; padding: 6px; color: inherit; background: #fff; }
  .preview { margin-top: 6px; padding-top: 6px; border-top: 1px dashed #d8c66a; max-height: 200px; overflow: auto; }
  .preview:empty { display: none; }
  .edit { display: none; } .card.editing .edit { display: block; } .card.editing .view-note { display: none; }
  .fallback { display: none; } .card.fallback .fallback { display: block; } .card.fallback .live { display: none; }
  .fallback-note { font-size: 11px; font-style: italic; opacity: 0.75; margin: 0 0 4px; }
  .live { min-height: 1.45em; cursor: text; }
  /* Task boxes, rendered note and editor alike (D28); 1.1em + 0.3em = one list marker width: drawn, not characters, so the size is the
     same in every font. Ticked: a green square with a white bold tick that brings its own
     background, so it reads on every card colour. Fits within one line (no layout shift). */
  /* Both states have the same content (the tick, from ::before, invisible when open), so they share
     one baseline and sit at the same height; overflow is clipped so a box never grows the line. */
  .tn-box { display: inline-block; box-sizing: border-box; width: 1.1em; height: 1.1em; vertical-align: -0.22em;
            margin-right: 0.3em; border: 1.5px solid currentColor; border-radius: 3px; overflow: hidden;
            font-size: 1em; line-height: calc(1.1em - 3px); text-align: center; font-weight: bold; cursor: pointer; opacity: 0.8; }
  .tn-box::before { content: "✓"; visibility: hidden; }
  .tn-box-done { background: #2f9e44; border-color: #1e6e30; color: #fff; opacity: 1; }
  .tn-box-done::before { visibility: visible; }
  @media (prefers-color-scheme: dark) {
    textarea { background: #1e1e1e; border-color: #555; }
    .note a[href^="mid:"] { background: #ffffff14; border-color: #ffffff33; }
    .note code, .note pre { background: #ffffff1a; } .note pre code { background: none; }
    .tn-picker, .tn-picker input, .tn-suggest { background: #2f2f2f; color: #eee; border-color: #555; }
    .esc-warning { background: #2f2f2f; color: #ff8787; border-color: #ff8787; }
    .tn-suggest li.selected { background: #283a55; }
    .tn-chip { background: #ffffff14; border-color: #ffffff33; }
    .tn-picker li.selected { background: #283a55; } .tn-picker .tag { color: #8ab4f8; }
    .tn-conflict-box, .draft { background: #2b2a24; color: #eee; } .draft button { background: #2b2a24; color: #ffa94d; }
    .tn-conflict-box .tn-conflict-box button { background: #2b2a24; color: #ffa94d; }
    .tn-conflict-box button:hover { background: #3a2e22; } .bin { color: #ff6b6b; } .bin:hover { background: #ff6b6b26; }
  }
`;

const CARD_TEMPLATE = `
  <button class="bin" title="Delete note and highlight"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5"/></svg></button>
  <span class="colour-slot"></span>
  <button class="fold"><svg viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 5l4-4 4 4"/></svg></button>
  <div class="quote"></div>
  <div class="status"></div>
  <div class="draft"><span class="draft-text"></span> <button class="draft-restore">Restore</button><button class="draft-discard">Discard</button></div>
  <div class="note view-note" title="Click to edit"></div>
  <div class="edit">
    <div class="live"></div>
    <div class="fallback">
      <div class="fallback-note">Simple editor: the full editor couldn't be loaded. Your notes are safe; please report this (the reason is in the error console).</div>
      <textarea placeholder="Note in Markdown: **bold**, _italic_, - lists, - [ ] tasks, links. Leave empty for a plain highlight."></textarea>
      <div class="note preview"></div>
    </div>
    <div class="esc-warning">Press Esc again to discard your changes to this note</div>
    <div class="hint">Saved when you click elsewhere · Esc twice discards changes · Ctrl/⌘+Enter done · ⌘/Ctrl+click opens a link</div>
  </div>`;

export interface CardEvents {
  /** The card's size changed (rendered, edited, typed): the margin re-lays out. */
  changed(): void;
  /** Editing ended with no note: the margin drops the card. */
  closedEmpty(id: string): void;
  /** `fromCard`: the card itself was clicked, so it must not move under the mouse. */
  activate(id: string, fromCard?: boolean): void;
  hover(id: string, on: boolean): void;
  /** The user folded or opened the card (D30). */
  fold(id: string, folded: boolean): void;
}

export class NoteCard {
  readonly el: HTMLElement;
  private note: HTMLElement;
  private text: HTMLTextAreaElement;
  private preview: HTMLElement;
  private previewTimer = 0;
  private liveHost: HTMLElement;
  private editBox: HTMLElement;
  /** The live-preview editor while editing; null with the textarea fallback. */
  private live: LiveEditor | null = null;
  /** Editing was requested; the editor is still loading. */
  private opening = false;
  private colourSlot!: HTMLElement;
  /** Mouse-down position relative to the rendered note (see the mousedown listener). */
  private pressAt: { x: number; y: number } | null = null;
  /** True while a save started by leaving the card is running. */
  private saving = false;
  /** Unsaved text from an earlier session, offered for restoring (D34). */
  private pendingDraft: Draft | null = null;
  private draftTimer = 0;
  /** Text the current editing session started from, when not the saved note (a restored draft). */
  private startDoc: string | null = null;

  constructor(
    public annotation: Annotation,
    private actions: CardActions,
    private events: CardEvents
  ) {
    this.el = document.createElement("div");
    this.el.className = "card";
    this.el.dataset.id = annotation.id;
    this.el.innerHTML = CARD_TEMPLATE;
    const $ = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    this.note = $(".view-note");
    this.text = $<HTMLTextAreaElement>("textarea");
    this.preview = $(".preview");
    this.liveHost = $(".live");
    this.editBox = $(".edit");
    const quote = annotation.selectors.find((s): s is TextQuoteSelector => s.type === "TextQuoteSelector");
    // No quote: the note on the whole email.
    $(".quote").textContent = quote ? `“${quote.exact}”` : "Note on this email";
    const badge = document.createElement("span");
    badge.className = "conflict-badge";
    badge.textContent = "2 versions";
    badge.title = "Changed on two devices at once: keep one version in the note";
    $(".quote").prepend(badge);
    $(".quote").classList.toggle("email", !quote);
    this.el.classList.toggle("email", !quote);
    this.colourSlot = $(".colour-slot");
    this.applyColour();
    if (!quote) $(".bin").title = "Delete note";

    // Clicked while editing: save, leave the editor and fold. Noted on mousedown, because
    // a click on the quote line blurs (= saves and closes) the editor before the click arrives.
    let fromEditor = false;
    const noteEditing = () => (fromEditor = this.isEditing);
    const toggleFold = () => {
      const editing = fromEditor;
      fromEditor = false;
      if (editing) this.commit();
      if (!this.annotation.bodyMd) return;
      const folded = editing || !this.el.classList.contains("folded");
      this.setFolded(folded);
      this.events.fold(this.annotation.id, folded);
    };
    $(".quote").addEventListener("mousedown", noteEditing);
    $(".quote").addEventListener("click", toggleFold);
    const fold = $(".fold");
    fold.addEventListener("mousedown", (e) => {
      e.preventDefault(); // no blur: toggleFold saves itself
      noteEditing();
    });
    fold.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFold();
    });

    $(".draft-restore").addEventListener("click", (e) => {
      e.stopPropagation();
      const draft = this.pendingDraft;
      this.setDraft(null);
      if (draft) this.edit(undefined, undefined, draft.text);
    });
    $(".draft-discard").addEventListener("click", (e) => {
      e.stopPropagation();
      this.setDraft(null);
      this.actions.draft(this.annotation.id, null);
      if (!this.annotation.bodyMd) this.events.closedEmpty(this.annotation.id);
    });

    const bin = $(".bin");
    bin.addEventListener("mousedown", (e) => e.preventDefault()); // don't blur (= save) first
    bin.addEventListener("click", () => this.run(() => this.actions.remove(this.annotation.id)));

    attachMarkdownHelpers(this.text, {
      onSave: () => this.text.blur(),
      onCancel: () => this.escape(),
      cycleToText: () => this.actions.cycleToText(),
    });
    attachEditMenu(textareaTarget(this.text), $(".fallback"), this.actions.clipboard, [this.deleteItem()], () => {
      // The textarea can't say which line was clicked: the cursor's line.
      const line = this.text.value.slice(0, this.text.selectionStart).split("\n").length - 1;
      const colours = this.colourItems();
      const copies = this.copyItems(this.text.value, line);
      return [...colours, ...(colours.length && copies.length ? [{ ...copies[0]!, separator: true }, ...copies.slice(1)] : copies)];
    });
    this.text.addEventListener("input", () => {
      this.disarmEscape();
      this.scheduleDraft();
      clearTimeout(this.previewTimer);
      this.previewTimer = window.setTimeout(() => this.renderInto(this.preview, this.text.value), 150);
      this.events.changed();
    });
    // Leaving the textarea (clicking elsewhere, switching message or window) saves.
    this.text.addEventListener("blur", () => this.leftEditor());

    this.el.addEventListener("click", (e) => {
      const link = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (link) {
        // Links open in the default browser, never inside the message pane.
        e.preventDefault();
        this.actions.openLink(link.href);
        return;
      }
      const box = (e.target as Element).closest?.(".task-box");
      if (box && this.note.contains(box)) {
        this.toggleTask(box);
        return;
      }
      if (!this.note.contains(e.target as Node)) return;
      const selection = document.getSelection();
      if (selection?.isCollapsed !== false) {
        this.edit(this.pressAt ?? undefined);
      } else if (this.pressAt && this.note.contains(selection.anchorNode)) {
        // Text selected by dragging over the shown note: edit with the same text selected
        // (by position: the editor lays out line for line like the note), so Tab, typing or
        // shortcuts act on it.
        const r = this.note.getBoundingClientRect();
        const from = this.pressAt;
        selection.removeAllRanges();
        this.edit(from, { x: e.clientX - r.left, y: e.clientY - r.top });
      }
    });
    // Right-click on a card that isn't being edited: our menu (the editors have their own).
    this.el.addEventListener("contextmenu", (e) => {
      if (this.el.classList.contains("editing")) return;
      e.preventDefault(); // instead of Thunderbird's menu
      e.stopPropagation();
      this.events.activate(this.annotation.id, true);
      const selected = document.getSelection()?.toString() ?? "";
      // On a link: open it first (the email, for an email link).
      const anchor = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      const href = anchor?.getAttribute("href") ?? "";
      // On an "@" date that isn't ISO yet: convert it (the k-th one with this text in the note).
      // The renderer put the date it would be on it (data-iso).
      const loose = (e.target as Element).closest?.(".tn-loose-date[data-iso]") as HTMLElement | null;
      const convert: MenuItem[] = [];
      if (loose) {
        const text = loose.textContent ?? "";
        const k = [...this.note.querySelectorAll(".tn-loose-date[data-iso]")].filter((s) => s.textContent === text).indexOf(loose);
        const md = this.annotation.bodyMd;
        convert.push({
          label: `Convert to date (${formatDue(loose.dataset.iso!)})`,
          run: () =>
            void this.actions.convertLooseDate(md, text, k).then((changed) => {
              if (changed !== null && this.annotation.bodyMd === md) this.saveBody(changed);
            }),
        });
      }
      // On a label: its colour (D40).
      const label = ((e.target as Element).closest?.(".tn-label") as HTMLElement | null)?.dataset.label;
      // The colour row on top; then what applies where the click was; then the rest.
      // On a task (anywhere on its line): copy it as Markdown.
      const li = (e.target as Element).closest?.("li");
      const box = li && [...li.querySelectorAll(".task-box")].find((b) => b.closest("li") === li);
      const line = box ? this.taskLine(box) : null;
      const md = this.annotation.bodyMd;
      const here: MenuItem[] = [
        ...(label ? this.labelColourRow(label) : []),
        ...(href ? [{ label: /^mid:/i.test(href) ? "Open email" : "Open link", run: () => this.actions.openLink(href) }] : []),
        ...convert,
        ...(line !== null && taskAtLine(md, line)?.text ? [{ label: "Copy task as Markdown", run: () => this.actions.copyTask(this.annotation.id, md, line) }] : []),
      ];
      // On a label its colour row replaces the note's (two colour rows were confusing).
      const colours = label ? [] : this.colourItems();
      if (colours.length && here.length) here[0] = { ...here[0]!, separator: true };
      const items: MenuItem[] = [
        ...colours,
        ...here,
        { label: "Edit note", run: () => this.edit(), separator: true },
        { label: "Copy", kbd: `${MOD}C`, enabled: !!selected, run: () => this.actions.clipboard.write(selected) },
        { label: "Copy note as Markdown", run: () => this.actions.copyNote(this.annotation.id, md) },
        { ...this.deleteItem(), separator: true },
      ];
      openMenu(this.el, e, items);
    });
    new ResizeObserver(() => this.events.changed()).observe(this.el);
    // The message isn't focused (back from the message list): the editor would handle this click
    // itself and block the browser's default, which is what focuses the message pane (and
    // window.focus() is ignored there). So the editor doesn't get this click; the browser focuses
    // the message, and the cursor then goes where the click was (refocus).
    this.el.addEventListener(
      "mousedown",
      (e) => {
        if (document.hasFocus() || !this.el.classList.contains("editing") || !this.live) return;
        if (!this.liveHost.contains(e.target as Node)) return;
        e.stopPropagation();
        this.pendingPoint = { x: e.clientX, y: e.clientY };
      },
      true
    );
    this.el.addEventListener("mousedown", (e) => {
      // Parked editor: a click into the card takes the focus back at once.
      if (this.suspended && document.hasFocus()) setTimeout(() => this.refocus(), 0);
      // Where in the note the click happened, relative to the note, taken before anything
      // can move or scroll: the editor lays out line for line like the note (D28).
      const r = this.note.getBoundingClientRect();
      this.pressAt = this.note.contains(e.target as Node) ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
      this.events.activate(this.annotation.id, true);
    });
    this.el.addEventListener("mouseenter", () => this.events.hover(this.annotation.id, true));
    this.el.addEventListener("mouseleave", () => this.events.hover(this.annotation.id, false));
    this.renderInto(this.note, annotation.bodyMd);
  }

  get id(): string {
    return this.annotation.id;
  }

  get isEditing(): boolean {
    return this.el.classList.contains("editing") || this.saving || this.opening;
  }

  /** New data from outside (e.g. after an import); re-renders if the note changed. */
  update(annotation: Annotation): void {
    const changed = annotation.bodyMd !== this.annotation.bodyMd;
    this.annotation = annotation;
    if (changed) this.renderInto(this.note, annotation.bodyMd);
    this.applyColour();
  }

  /** Card in the highlight's colour; text black or white by WCAG contrast (D29). */
  applyColour(): void {
    const colour = colourOf(this.annotation.colour);
    const base = matchMedia("(prefers-color-scheme: dark)").matches ? "#2b2a24" : "#ffffff";
    this.el.style.setProperty("--card-base", base);
    this.el.style.setProperty("--card-bg", rgba(colour));
    this.el.style.setProperty("--card-fg", textOn(colour, base));
    this.el.style.setProperty("--card-border", darker(colour));
    this.el.dataset.colour = colour.name;
    const dot = document.createElement("button");
    dot.className = "colour-btn";
    dot.title = `Colour: ${colour.label} (click to change)`;
    dot.setAttribute("aria-label", dot.title);
    dot.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor's focus
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      openMenu(this.el, e, this.colourItems());
    });
    this.colourSlot.replaceChildren(dot);
  }

  /** A label's colour row (D40). */
  private labelColourRow(label: string): MenuItem[] {
    const key = label.toLowerCase();
    return labelColourItems(key, this.actions.labelColour(key), (colour) => this.actions.setLabelColour(key, colour));
  }

  /** The colour row for menus. */
  private colourItems(): MenuItem[] {
    return [colourItem(colourOf(this.annotation.colour).name, (name) => this.actions.setColour(this.annotation.id, name))];
  }

  /** Cmd+Option+1…8 (Ctrl+Alt+1…8): the n-th palette colour. */
  pickColourByIndex(index: number): void {
    const name = COLOUR_NAMES[index];
    if (name) this.actions.setColour(this.annotation.id, name);
  }

  /** "Delete note" (with its highlight), as in the bin's tooltip. */
  private deleteItem(): MenuItem {
    const emailNote = !this.annotation.selectors.length;
    return {
      label: emailNote ? "Delete note" : this.annotation.bodyMd ? "Delete note and highlight" : "Delete highlight",
      danger: true,
      run: () => this.run(() => this.actions.remove(this.annotation.id)),
    };
  }

  /** "Partly shown" / "Not found in this view", or nothing. */
  setStatus(status: "partial" | "orphan" | null): void {
    this.el.classList.toggle("has-status", !!status);
    this.el.classList.toggle("orphan", status === "orphan");
    const line = this.el.querySelector<HTMLElement>(".status")!;
    line.textContent =
      status === "orphan"
        ? "⚠ This note belongs to a passage of this email that can't be found at the moment."
        : status === "partial"
          ? "Partly shown in this view"
          : "";
    line.title =
      status === "orphan"
        ? "It may show again in another view (View → Message Body As). If this keeps happening, please let the add-on's author know."
        : "";
  }

  /** Folded to the quote line (D30). */
  setFolded(folded: boolean): void {
    this.el.classList.toggle("folded", folded);
    const title = folded ? "Show the note" : "Collapse the note";
    this.el.querySelector(".quote")!.setAttribute("title", title);
    this.el.querySelector(".fold")!.setAttribute("title", title);
    this.el.querySelector(".fold")!.setAttribute("aria-label", title);
    this.events.changed();
  }

  /** Shows (or hides) the offer to restore unsaved text from an earlier session (D34). */
  /** `failed`: the reason saving it failed just now (else: left over from a closed or crashed Thunderbird). */
  setDraft(draft: Draft | null, failed?: string): void {
    if (this.isEditing) draft = null;
    this.pendingDraft = draft;
    this.el.classList.toggle("has-draft", !!draft);
    if (draft) {
      const at = new Date(draft.at);
      const when = Number.isNaN(at.getTime()) ? "" : ` from ${at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
      this.el.querySelector(".draft-text")!.textContent = failed
        ? `Not saved (${failed}). Your text is kept: restore it to try again.`
        : `Unsaved text${when}: Thunderbird closed while you were writing.`;
    }
    this.events.changed();
  }

  /** While typing: keep the text as a draft a moment after the last change (D34). */
  private scheduleDraft(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => {
      if (!this.el.classList.contains("editing")) return;
      const text = this.live ? this.live.getValue() : this.text.value;
      this.actions.draft(this.annotation.id, text.trim() === this.annotation.bodyMd ? null : text);
    }, 1500);
  }

  setActive(on: boolean): void {
    this.el.classList.toggle("active", on);
  }

  /**
   * Starts editing; with `at` (the click, relative to the rendered note), the cursor goes
   * to the same place in the editor, wherever the card is by then; with `to` (where a drag
   * over the note ended), the text in between is selected. `doc`: start from this text
   * instead of the saved note (a restored draft).
   */
  edit(at?: { x: number; y: number }, to?: { x: number; y: number }, doc?: string, line?: number): void {
    if (this.el.classList.contains("editing")) {
      if (this.live && line !== undefined) this.live.placeAtLine(line);
      else if (this.live) this.live.focus();
      else this.text.focus();
      return;
    }
    this.startLine = line ?? null;
    if (this.opening) return;
    // The rendered note stays visible until the editor is ready; then both are swapped in
    // one step, so the card never collapses (which shortened the page and made it jump).
    this.opening = true;
    this.startDoc = doc ?? null;
    this.setDraft(null);
    loadLiveEditor()
      .then((mod) => {
        if (!this.opening) return; // cancelled while loading
        this.opening = false;
        this.live = mod.createLiveEditor({
          parent: this.liveHost,
          root: this.el.getRootNode() as ShadowRoot,
          doc: this.startDoc ?? this.annotation.bodyMd,
          onDone: () => this.commit(),
          onCancel: () => this.escape(),
          onBlur: () => this.leftEditor(),
          onChange: () => {
            this.disarmEscape(); // typing on: keep editing
            this.events.changed();
            this.scheduleDraft();
          },
          openLink: (url) => this.actions.openLink(url),
          clipboard: this.actions.clipboard,
          cycleToText: () => this.actions.cycleToText(),
          renumberLists: () => this.actions.renumberLists(),
          alwaysYear: () => this.actions.alwaysYear(),
          searchEmails: (q) => this.actions.searchEmails(q),
          linkPicker: () => this.actions.linkPicker(),
          knownLabels: () => this.actions.knownLabels(),
          menuContainer: this.editBox,
          extraMenuItems: [this.deleteItem()],
          topMenuItems: () => this.colourItems(),
          copyMenuItems: (md, line) => this.copyItems(md, line),
          labelColourItems: (label) => this.labelColourRow(label),
          onColourKey: (index) => this.pickColourByIndex(index),
        });
        this.el.classList.add("editing");
        const host = this.liveHost.getBoundingClientRect();
        if (this.startLine !== null) this.live.placeAtLine(this.startLine);
        else this.live.placeCursor(at && { x: host.left + at.x, y: host.top + at.y }, to && { x: host.left + to.x, y: host.top + to.y });
        this.events.changed();
      })
      .catch((e) => {
        // Said in the card, not only here: a silent downgrade would never be reported.
        console.error("ThunderNotes: the full editor couldn't be loaded, using the simple one:", e);
        this.el.querySelector<HTMLElement>(".fallback-note")!.title = `Reason: ${e?.message ?? e}`;
        if (!this.opening) return;
        this.opening = false;
        this.el.classList.add("editing");
        this.editFallback();
      });
  }

  /** The textarea + preview editor (D22), if the live editor can't be loaded. */
  private editFallback(): void {
    if (!this.el.classList.contains("editing")) return;
    this.el.classList.add("fallback");
    this.text.value = this.startDoc ?? this.annotation.bodyMd;
    this.renderInto(this.preview, this.text.value);
    this.text.focus();
    this.text.setSelectionRange(this.text.value.length, this.text.value.length);
    this.events.changed();
  }

  /** The text being edited, and the end of the editing session. */
  private endEditing(): string {
    this.opening = false;
    this.disarmEscape();
    // The draft stays until the text is saved (saveBody) or discarded (discard): a save that fails
    // must not take the only copy along (issue #6).
    clearTimeout(this.draftTimer);
    this.startDoc = null;
    const text = this.live ? this.live.getValue() : this.text.value;
    this.live?.destroy();
    this.live = null;
    this.el.classList.remove("editing", "fallback");
    return text;
  }

  /**
   * The editor lost focus. Clicking elsewhere in the message saves and ends editing (D24); but
   * when the whole window lost focus (another app, Thunderbird's own panes), editing goes on,
   * as in any other program: coming back, the cursor is where it was. Switching message still
   * saves (commitAll), and the draft (D34) covers a crash meanwhile.
   */
  /** The window lost focus while this card was being edited: not leaving the card (D24). */
  private suspended = false;
  /** Where a click landed that only focused the message (see the capturing mousedown). */
  private pendingPoint: { x: number; y: number } | null = null;
  /** Opened from the task view (D38): the line to put the cursor on once the editor is ready. */
  private startLine: number | null = null;

  /**
   * The message lost the focus (Thunderbird's message list, another app): editing goes on, but
   * the editor gives up the focus properly. Otherwise it still counted as focused inside the
   * message, and a click back into it didn't register (seen with "Copy ThunderNotes link").
   */
  suspend(): void {
    if (!this.el.classList.contains("editing")) return;
    this.suspended = true;
    if (this.live) this.live.blur();
    else this.text.blur();
  }

  private leftEditor(): void {
    if (this.suspended) return;
    // A moment's grace: opening a context menu elsewhere in Thunderbird (e.g. "Copy ThunderNotes
    // link" on the message list) can blur the editor before the window counts as unfocused.
    setTimeout(() => {
      const active = (this.el.getRootNode() as ShadowRoot).activeElement;
      if (active && this.el.contains(active)) return; // focus came back into this card
      if (document.hasFocus()) this.commit();
    }, 200);
  }

  /** Coming back to the message: the cursor returns to the editor that is still open. */
  refocus(): void {
    const was = this.suspended;
    const point = this.pendingPoint;
    this.suspended = false;
    this.pendingPoint = null;
    if ((!was && !point) || !this.el.classList.contains("editing")) return;
    if (this.live) {
      if (point) this.live.placeCursor(point);
      else this.live.focus();
    } else this.text.focus();
  }

  /** Saves if anything changed and leaves edit mode. Also used before the message unloads. */
  commit(): void {
    if (this.opening && !this.el.classList.contains("editing")) {
      this.opening = false; // clicked away before the editor was ready: don't open it
      return;
    }
    if (!this.el.classList.contains("editing")) return;
    const bodyMd = this.endEditing().trim();
    if (bodyMd === this.annotation.bodyMd) {
      this.actions.draft(this.annotation.id, null); // nothing to save: no draft needed
      this.finish();
      return;
    }
    this.saveBody(bodyMd, true);
  }

  private escTimer = 0;

  /**
   * Esc while editing: without changes (to the saved note) it leaves at once; with changes the
   * first Esc only warns, and a second one within 3 s discards them. Typing on, or waiting,
   * keeps editing. (Esc in a suggestion list or the link picker only closes that.)
   */
  private escape(): void {
    const text = (this.live ? this.live.getValue() : this.text.value).trim();
    if (text === this.annotation.bodyMd.trim() || this.escTimer) {
      this.disarmEscape();
      this.discard();
      return;
    }
    this.el.classList.add("esc-armed");
    this.placeEscWarning();
    this.escTimer = window.setTimeout(() => this.disarmEscape(), 3000);
  }

  /** Under the cursor's line (above it near the window's bottom), within the window. */
  private placeEscWarning(): void {
    const box = this.el.querySelector<HTMLElement>(".esc-warning")!;
    const at = this.live?.cursorCoords() ?? (() => {
      const r = this.editBox.getBoundingClientRect();
      return { left: r.left, top: r.top, bottom: r.top };
    })();
    const height = box.offsetHeight || 26;
    const width = box.offsetWidth || 260;
    const below = at.bottom + 6 + height <= window.innerHeight;
    box.style.top = `${below ? at.bottom + 6 : Math.max(4, at.top - height - 6)}px`;
    box.style.left = `${Math.max(4, Math.min(at.left - 12, window.innerWidth - width - 4))}px`;
  }

  private disarmEscape(): void {
    if (!this.escTimer) return;
    clearTimeout(this.escTimer);
    this.escTimer = 0;
    this.el.classList.remove("esc-armed");
  }

  /** Esc: drop this session's changes; the saved note stays as it was. */
  private discard(): void {
    this.endEditing();
    this.actions.draft(this.annotation.id, null); // discarded on purpose: the draft goes too
    this.text.blur();
    this.finish();
  }

  /**
   * Saves the note's text. From the editor (`fromEditor`), the text is kept as a draft until the
   * save succeeded; if it fails, the card offers it back to restore and try again (issue #6).
   */
  private saveBody(bodyMd: string, fromEditor = false): void {
    this.saving = true;
    const id = this.annotation.id;
    if (fromEditor) this.actions.draft(id, bodyMd); // the latest text, before anything can fail
    let failed = false;
    this.actions
      .save(id, bodyMd)
      .then(async () => {
        this.annotation = { ...this.annotation, bodyMd };
        if (fromEditor) this.actions.draft(id, null);
        await this.renderInto(this.note, bodyMd);
      })
      .catch((e) => {
        console.error("ThunderNotes:", e);
        failed = true;
        this.saving = false; // no longer busy: the draft can be offered
        this.note.textContent = `Could not save: ${e?.message ?? e}`;
        if (fromEditor) this.setDraft({ text: bodyMd, at: new Date().toISOString() }, String(e?.message ?? e));
      })
      .finally(() => {
        this.saving = false;
        // Failed with text kept: the card stays (also a new note without saved text), offering it.
        if (failed && fromEditor) this.events.changed();
        else this.finish();
      });
  }

  /** A rendered checkbox names its original source line; never guess from its ordinal position. */
  private taskLine(box: Element): number | null {
    if (box.closest(".tn-conflict-box")) return null;
    const value = (box as HTMLElement).dataset.line;
    if (value === undefined || !/^\d+$/.test(value)) return null;
    const line = Number(value);
    return Number.isSafeInteger(line) && line < this.annotation.bodyMd.split("\n").length ? line : null;
  }

  /** Editor menus: copy the task on the clicked line (if it is one) or the whole note as Markdown. */
  private copyItems(md: string, line: number | null): MenuItem[] {
    return [
      ...(line !== null && taskAtLine(md, line)?.text ? [{ label: "Copy task as Markdown", run: () => this.actions.copyTask(this.annotation.id, md, line) }] : []),
      ...(md.trim() ? [{ label: "Copy note as Markdown", run: () => this.actions.copyNote(this.annotation.id, md) }] : []),
    ];
  }

  /** Ticks or unticks the n-th task of the rendered note, without entering edit mode. */
  private toggleTask(box: Element): void {
    // Tasks inside a conflict box aren't counted (their lines start with ">" in the text).
    if (box.closest(".tn-conflict-box")) return;
    const at = this.taskLine(box);
    if (at === null) return;
    const lines = this.annotation.bodyMd.split("\n");
    // Ticked with the date it was finished, unticked without (D38).
    lines[at] = markDone(lines[at]!, /^[\s>]*(?:[-*+]|\d+[.)])\s+\[ \]/.test(lines[at]!)); // its own box open: tick it
    const bodyMd = lines.join("\n");
    if (bodyMd !== this.annotation.bodyMd) this.saveBody(bodyMd);
  }

  private finish(): void {
    if (!this.annotation.bodyMd) this.events.closedEmpty(this.annotation.id);
    this.events.changed();
  }

  /**
   * Conflict boxes (D32) in the shown note: each rendered `> [!conflict]` quote is replaced by
   * a box with both versions (device, local time, text) and buttons to keep one or both.
   */
  private async showConflicts(md: string): Promise<void> {
    const boxes = parseConflicts(md);
    this.el.classList.toggle("has-conflict", boxes.length > 0);
    const quotes = [...this.note.querySelectorAll("blockquote.tn-conflict")];
    for (const [i, quote] of quotes.entries()) {
      const box = boxes[i];
      if (!box) continue;
      const el = document.createElement("div");
      el.className = "tn-conflict-box";
      const title = document.createElement("div");
      title.className = "tn-conflict-title";
      title.textContent = "Changed on two devices — keep one";
      el.append(title);
      for (const [k, v] of box.versions.entries()) {
        const version = document.createElement("div");
        version.className = "tn-conflict-version";
        const by = document.createElement("div");
        by.className = "tn-conflict-by";
        const at = new Date(v.time.replace(" UTC", "Z").replace(" ", "T"));
        by.textContent = `${v.by} · ${Number.isNaN(at.getTime()) ? v.time : at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
        const text = document.createElement("div");
        text.className = "tn-conflict-text";
        text.innerHTML = v.text.trim() ? await this.actions.render(v.text) : "";
        version.append(by, text, this.keepButton("Keep this", i, k));
        el.append(version);
      }
      el.append(this.keepButton("Keep both", i, "both"));
      quote.replaceWith(el);
    }
  }

  private keepButton(label: string, box: number, choice: number | "both"): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("mousedown", (e) => e.stopPropagation()); // no "click to edit" position
    button.addEventListener("click", (e) => {
      e.stopPropagation(); // not "click to edit"
      this.saveBody(resolveConflict(this.annotation.bodyMd, box, choice).trim());
    });
    return button;
  }

  private async renderInto(target: HTMLElement, md: string): Promise<void> {
    target.innerHTML = md.trim() ? await this.actions.render(md) : "";
    // Over a link the tooltip shows where it goes, not the note's "Click to edit".
    for (const a of target.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const href = a.getAttribute("href")!;
      a.title = /^mid:/i.test(href) ? "Open this email in Thunderbird" : href;
    }
    if (target === this.note) {
      this.el.classList.toggle("has-text", !!md.trim());
      await this.showConflicts(md);
    }
    this.events.changed();
  }

  private run(action: () => Promise<void>): Promise<void> {
    return action().catch((e) => {
      console.error("ThunderNotes:", e);
      this.note.textContent = `Could not save: ${e?.message ?? e}`;
    });
  }
}
