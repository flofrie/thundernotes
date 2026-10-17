/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Word-style margin: a column on the right of the message pane, outside the email
// text, with one card per note at the height of its highlight. The email's width
// shrinks to make room while the margin is open.

import type { Annotation, AnnotationSet } from "@thundernotes/core";
import { NoteCard, type CardActions, type CardEvents, type Draft } from "./card.js";

export const MARGIN_CSS = `
  .resize { position: absolute; top: 0; bottom: 0; left: -5px; width: 9px; cursor: ew-resize; z-index: 2; }
  .resize:hover, .margin.resizing .resize { background: linear-gradient(to right, transparent 3px, #c9a40066 3px, #c9a40066 6px, transparent 6px); }
  .margin.resizing, .margin.resizing * { cursor: ew-resize !important; user-select: none; }
  .margin { position: absolute; top: 0; display: none; }
  .margin.open { display: block; }
  .toggle { position: fixed; top: 6px; right: 8px; font: 12px system-ui, sans-serif; display: none;
            padding: 2px 8px; border-radius: 10px; }
  .toggle.shown { display: block; }
  @media print { .toggle.shown { display: none; } }
`;

import { EMAIL_NOTE_ID } from "./protocol.js";
/** Id of the card for the note on the whole email (pinned at the top). */
export { EMAIL_NOTE_ID };

/** The whole-email note as a pseudo annotation, so it can use a normal card. */
export function emailNoteAnnotation(set: AnnotationSet | null): Annotation {
  const at = set?.updated ?? new Date().toISOString();
  const note: Annotation = { id: EMAIL_NOTE_ID, selectors: [], bodyMd: set?.emailNoteMd ?? "", created: at, updated: at };
  if (set?.emailNoteColour) note.colour = set.emailNoteColour;
  return note;
}

export type CardStatus = "partial" | "orphan" | null;

const GAP = 8;
/** Space at the top for the show/hide toggle. */
const TOP = 36;
const SIDE_PADDING = 12;
const MIN_WIDTH = 200;
const MAX_WIDTH = 320;
const SHARE = 0.3;
/** Limits when the user drags the width (left edge of a card). */
const DRAG_MIN = 180;
const DRAG_MAX_SHARE = 0.6;

/** Where a card ended up, in document coordinates. */
export interface CardBox {
  id: string;
  left: number;
  top: number;
  height: number;
}

export interface MarginHost {
  /** Page box of a highlight (document coordinates), or null if not drawn. */
  rectOf(id: string): DOMRect | null;
  /** Emphasise or clear a highlight's text while its card is hovered or active. */
  emphasise(id: string, on: boolean): void;
  setCollapsed(collapsed: boolean): void;
  /** The user dragged the margin's width (null: back to automatic). */
  setWidth(width: number | null): void;
  /** Card folding (D30). */
  isFolded(id: string): boolean;
  setFolded(id: string, folded: boolean): void;
  /** Unsaved text left from an editing session that never ended (D34). */
  draftFor(id: string): Draft | null;
  /** Where a highlight starts in the email's text (for highlights on the same line). */
  textOrder(id: string): number;
  /**
   * After each layout: the cards (left edge and top, document coordinates), the one active, and
   * the gap between the email and the column; empty when the column is closed (for the lines
   * from cards to their highlights, D23).
   */
  laidOut?(cards: CardBox[], active: string | null): void;
}

export class Margin {
  private column: HTMLElement;
  private toggle: HTMLButtonElement;
  private cards = new Map<string, NoteCard>();
  private active: string | null = null;
  private collapsed: boolean;
  private pending = 0;
  private reserved = 0;
  /** A card clicked directly keeps its place (no jump under the mouse) while it is active. */
  private hold: { id: string; top: number } | null = null;
  /** Width chosen by dragging a card's left edge; null = automatic. */
  private customWidth: number | null;
  private width = 0;

  constructor(
    root: ShadowRoot,
    private actions: CardActions,
    private host: MarginHost,
    collapsed: boolean,
    width: number | null = null
  ) {
    this.collapsed = collapsed;
    this.customWidth = width;
    this.column = document.createElement("div");
    this.column.className = "margin";
    this.toggle = document.createElement("button");
    this.toggle.className = "toggle";
    this.toggle.addEventListener("click", () => this.setCollapsed(!this.collapsed));
    root.append(this.column, this.toggle);

    const relayout = () => this.schedule();
    window.addEventListener("resize", relayout);
    // Images loading, fonts, view changes: the email reflows, highlights move.
    new ResizeObserver(relayout).observe(document.body);
  }

  /**
   * Cards for the whole-email note and all annotations with a note; keeps open editors.
   * `status` marks notes partly shown or not found in this view.
   */
  /** Printing with every note expanded: unfolded and laid out anew for the print (not saved). */
  private printExpanded = false;
  private printShown = false;

  /** Printing with notes: shown even while hidden with "Hide notes" (on), then as before (off). */
  showForPrint(on: boolean): void {
    if (on === this.printShown) return;
    this.printShown = on;
    this.layoutNow();
  }

  /** For a print with all notes expanded (on), then back to each card's own folding (off). */
  expandAllForPrint(on: boolean): void {
    this.printExpanded = on;
    for (const [id, card] of this.cards) card.setFolded(!on && this.host.isFolded(id));
    this.layoutNow();
  }

  sync(set: AnnotationSet | null, status: (id: string) => CardStatus): void {
    const notes = [emailNoteAnnotation(set), ...(set?.annotations ?? [])];
    const keep = new Set<string>();
    for (const a of notes) {
      let card = this.cards.get(a.id);
      // A note without text still gets a card while it has a draft to restore (D34).
      const wanted = !!a.bodyMd || !!this.host.draftFor(a.id);
      if (wanted || card?.isEditing) keep.add(a.id);
      if (wanted && !card) card = this.add(a);
      else if (card && !card.isEditing) card.update(a);
      card?.setStatus(status(a.id));
      card?.setFolded(!this.printExpanded && this.host.isFolded(a.id));
      if (card && !card.isEditing) card.setDraft(this.host.draftFor(a.id));
    }
    for (const id of [...this.cards.keys()]) if (!keep.has(id)) this.drop(id);
    this.schedule();
  }

  /** Opens (or creates) a card in edit mode and makes it the active one. */
  /** With `line` (from the task view, D38): the cursor at the end of that line of the note. */
  open(annotation: Annotation, edit = true, line?: number): void {
    if (this.collapsed) this.setCollapsed(false);
    this.hold = null; // opened from the text or the popup: align with the highlight
    const card = this.cards.get(annotation.id) ?? this.add(annotation);
    this.activate(annotation.id);
    this.layoutNow();
    this.bringIntoView(card);
    if (edit) card.edit(undefined, undefined, undefined, line);
  }

  /**
   * A card opened from its highlight (or the popup) that isn't fully on screen is scrolled to,
   * even if the highlight then leaves the view: the whole card if it fits, else its top.
   * Cards clicked directly are visible already and never move (D23).
   */
  private bringIntoView(card: NoteCard): void {
    const r = card.el.getBoundingClientRect();
    const room = 12;
    const bottom = window.innerHeight - room;
    if (r.top >= room && r.bottom <= bottom) return;
    if (r.top < room || r.height > bottom - room) window.scrollBy(0, r.top - room);
    else window.scrollBy(0, r.bottom - bottom);
  }

  /** Saves any card being edited (the message is about to unload). */
  commitAll(): void {
    for (const card of this.cards.values()) card.commit();
  }

  /** Left edge of the cards' column on screen while it is open (menus over the email stop there). */
  leftEdge(): number | null {
    return this.column.classList.contains("open") && this.cards.size ? this.column.getBoundingClientRect().left - 4 : null;
  }

  /** Whether a note is being edited (open editor, also while parked). */
  isEditing(): boolean {
    return [...this.cards.values()].some((c) => c.isEditing);
  }

  /** The message lost the focus: an open editor gives it up but stays open. */
  suspendEditing(): void {
    for (const card of this.cards.values()) card.suspend();
  }

  /** The message got the focus back (from another pane or app): into the open editor. */
  refocusEditing(): void {
    for (const card of this.cards.values()) card.refocus();
  }

  /** The active card's id, if any. */
  get activeId(): string | null {
    return this.active;
  }

  /** A highlight's colour changed: recolour its card (also while it is being edited). */
  recolour(annotation: Annotation): void {
    const card = this.cards.get(annotation.id);
    if (!card) return;
    card.annotation = { ...card.annotation, colour: annotation.colour };
    card.applyColour();
  }

  hover(id: string, on: boolean): void {
    this.cards.get(id)?.el.classList.toggle("active", on || this.active === id);
  }

  remove(id: string): void {
    this.drop(id);
    this.schedule();
  }

  deactivate(): void {
    if (this.active && !this.cards.get(this.active)?.isEditing) this.activate(null);
  }

  private add(annotation: Annotation): NoteCard {
    const events: CardEvents = {
      changed: () => this.schedule(),
      closedEmpty: (id) => this.remove(id),
      activate: (id, fromCard) => {
        const card = this.cards.get(id);
        if (fromCard && card && this.active !== id) this.hold = { id, top: parseFloat(card.el.style.top) || 0 };
        this.activate(id);
      },
      hover: (id, on) => this.host.emphasise(id, on || this.active === id),
      fold: (id, folded) => this.host.setFolded(id, folded),
    };
    const card = new NoteCard(annotation, this.actions, events);
    card.setFolded(this.host.isFolded(annotation.id));
    const handle = document.createElement("div");
    handle.className = "resize";
    handle.title = "Drag to change the width of the notes · double-click for the automatic width";
    handle.addEventListener("mousedown", (e) => this.startResize(e));
    handle.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.customWidth = null;
      this.host.setWidth(null);
      this.layoutNow();
    });
    card.el.append(handle);
    this.cards.set(annotation.id, card);
    this.column.append(card.el);
    return card;
  }

  /** Dragging a card's left edge: the whole column gets wider or narrower. */
  private startResize(e: MouseEvent): void {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection, no focus change
    e.stopPropagation(); // not "activate the card"
    const startX = e.clientX;
    const startWidth = this.width;
    this.column.classList.add("resizing");
    const move = (ev: MouseEvent) => {
      this.customWidth = this.clampDrag(startWidth + (startX - ev.clientX));
      this.layoutNow();
    };
    const up = () => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", up, true);
      this.column.classList.remove("resizing");
      if (this.customWidth !== null) this.host.setWidth(this.customWidth);
    };
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
  }

  private clampDrag(width: number): number {
    const max = Math.max(DRAG_MIN, document.documentElement.clientWidth * DRAG_MAX_SHARE);
    return Math.round(Math.min(max, Math.max(DRAG_MIN, width)));
  }

  private drop(id: string): void {
    this.cards.get(id)?.el.remove();
    this.cards.delete(id);
    if (this.active === id) this.activate(null);
  }

  private activate(id: string | null): void {
    if (this.active === id) return;
    if (this.hold && this.hold.id !== id) this.hold = null;
    if (this.active) {
      const previous = this.cards.get(this.active);
      previous?.setActive(false);
      this.host.emphasise(this.active, false);
      // A card opened without a note and never edited (e.g. from the popup) goes away again.
      if (previous && !previous.isEditing && !previous.annotation.bodyMd) this.drop(previous.id);
    }
    this.active = id;
    if (id) {
      this.cards.get(id)?.setActive(true);
      this.host.emphasise(id, true);
    }
    this.schedule();
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.host.setCollapsed(collapsed);
    this.layoutNow();
  }

  private schedule(): void {
    // A zero-delay timer, not requestAnimationFrame: in the message pane rAF callbacks
    // can wait until something else repaints (cards stayed put after a delete).
    if (this.pending) return;
    this.pending = window.setTimeout(() => {
      this.pending = 0;
      this.layoutNow();
    });
  }

  /** Reserves the margin, then stacks cards at their highlights' height without overlaps. */
  private layoutNow(): void {
    const count = this.cards.size;
    const open = count > 0 && (!this.collapsed || this.printShown);
    this.toggle.classList.toggle("shown", count > 0);
    this.toggle.textContent = this.collapsed ? `✎ Show ${count} note${count === 1 ? "" : "s"}` : "Hide notes";
    this.column.classList.toggle("open", open);

    // The root's padding doesn't change clientWidth: it is always the viewport width.
    const viewport = document.documentElement.clientWidth;
    const width =
      this.customWidth !== null
        ? this.clampDrag(this.customWidth)
        : Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, viewport * SHARE)));
    this.width = width;
    const reserve = open ? width + 2 * SIDE_PADDING : 0;
    if (reserve !== this.reserved) {
      this.reserved = reserve;
      // Shrink the email by padding the root element; !important beats the email's own CSS.
      if (reserve) document.documentElement.style.setProperty("padding-right", `${reserve}px`, "important");
      else document.documentElement.style.removeProperty("padding-right");
    }
    if (!open) {
      this.host.laidOut?.([], null);
      return;
    }

    // Fixed-width emails can be wider than the space left: put the margin after their content.
    const contentRight = document.body.getBoundingClientRect().left + window.scrollX + document.body.scrollWidth;
    const left = Math.max(document.documentElement.clientWidth - width - SIDE_PADDING, contentRight + SIDE_PADDING);
    this.column.style.left = `${left}px`;
    this.column.style.width = `${width}px`;

    const items = [...this.cards.values()]
      .map((card) => {
        card.el.style.width = `${width}px`;
        // Email note first, then notes whose passage can't be found (with a warning, so they
        // aren't missed at the bottom), then cards at their highlights.
        const rect = card.id === EMAIL_NOTE_ID ? null : this.host.rectOf(card.id);
        const want = rect ? rect.top : -Infinity;
        return { card, want, height: card.el.offsetHeight, at: this.host.textOrder(card.id) };
      })
      // Order always follows the highlights in the email (a held card keeps its rank); highlights
      // on the same line by their place in the text, not by when they were made or restored.
      .sort((a, b) => (a.want === b.want ? 0 : a.want - b.want) || a.at - b.at)
      .map(({ at: _, ...item }) => item);

    const pivot = items.findIndex((i) => i.card.id === this.active);
    const target = pivot === -1 ? null : this.hold?.id === this.active ? this.hold.top : null;
    const tops = stackCards(items, pivot, target, TOP, GAP);
    items.forEach((item, i) => (item.card.el.style.top = `${tops[i]}px`));
    if (this.host.laidOut) {
      // Where the cards go, not where they are: they slide there (a CSS transition on top), so
      // measuring them now gave their old places (lines went to where a card was before unfolding).
      const column = this.column.getBoundingClientRect();
      const cards = items.map(({ card, height }, i) => ({
        id: card.id,
        left: column.left + window.scrollX + card.el.offsetLeft,
        top: column.top + window.scrollY + this.column.clientTop + tops[i]!,
        height,
      }));
      this.host.laidOut(cards, this.active);
    }
  }
}

/** A card's wish for the stack: its highlight's top (-Infinity: pinned first; MAX: no highlight, last). */
export interface StackItem {
  want: number;
  height: number;
}

/**
 * Card tops for the margin, items sorted by `want`. Without an active card: each card at its
 * highlight, pushed down where it would overlap (the natural layout). With an active card
 * (`pivot`): it goes to `target` if given (clicked directly: where it is, so nothing moves),
 * else level with its highlight; cards above make room but never go below their natural place;
 * cards below follow. Nothing goes above `top`, nothing overlaps.
 */
export function stackCards(items: StackItem[], pivot: number, target: number | null, top: number, gap: number): number[] {
  const natural: number[] = [];
  let floor = top;
  for (const item of items) {
    const t = item.want === Number.MAX_SAFE_INTEGER ? floor : Math.max(item.want, floor);
    natural.push(t);
    floor = t + item.height + gap;
  }
  if (pivot === -1) return natural;

  const tops = [...natural];
  const want = items[pivot]!.want;
  tops[pivot] = target ?? (Number.isFinite(want) && want !== Number.MAX_SAFE_INTEGER ? want : natural[pivot]!);
  for (let i = pivot - 1; i >= 0; i--) {
    tops[i] = Math.min(natural[i]!, tops[i + 1]! - items[i]!.height - gap);
  }
  for (let i = pivot + 1; i < items.length; i++) {
    const w = items[i]!.want === Number.MAX_SAFE_INTEGER ? -Infinity : items[i]!.want;
    tops[i] = Math.max(w, tops[i - 1]! + items[i - 1]!.height + gap);
  }
  // Not above the top, no overlaps (the active card yields only if there is no room above).
  floor = top;
  return tops.map((t, i) => {
    const placed = Math.max(t, floor);
    floor = placed + items[i]!.height + gap;
    return placed;
  });
}

