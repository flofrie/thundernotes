/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Message display script: draws highlights in the displayed email, creates new ones
// from the selection (floating button, Ctrl/Cmd+Shift+H or +N, context menu) or on a picture
// (context menu, D46) and
// shows note cards in a Word-style margin on the right (margin.ts). A highlight is a
// note with empty text (D24): clicking it opens its card for editing.

import {
  anchor,
  anchorImage,
  describe,
  describeImage,
  extractText,
  imageOffset,
  imageSelectorOf,
  quoteLabel,
  offsetsToRange,
  rangeToOffsets,
  type Annotation,
  type AnchorResult,
  type AnnotationSet,
  type TextPositionSelector,
  type TextQuoteSelector,
} from "@thundernotes/core";
import { COLOUR_NAMES, DEFAULT_COLOUR, colourOf, darker, hasConflict, labelColourCss, restorable, rgba, setAlwaysShowYear, textOn, type LabelColours } from "@thundernotes/core";
import { CARD_CSS, type Draft } from "./card.js";
import { openForEditing } from "./focus-edit.js";
import { cardMiddle, lineBands, passageMiddle } from "./connectors.js";
import { MOD, SWATCH_CSS, colourItem, openMenu, swatch, type MenuItem } from "./edit-menu.js";
import { EMAIL_NOTE_ID, MARGIN_CSS, Margin, emailNoteAnnotation, type CardBox, type CardStatus } from "./margin.js";
import type { ContextInfo, ListState, Responses, ToBackground, ToContent } from "./protocol.js";

const MARK_CLASS = "thundernotes-hl";
/** A highlighted picture (D46): framed, not wrapped (a wrapper could change the email's layout). */
const IMG_CLASS = "thundernotes-hl-img";
/** Any piece of a highlight: text marks and pictures. */
const HL_SELECTOR = `mark.${MARK_CLASS}, img.${IMG_CLASS}`;

/** The highlight a piece belongs to. A picture keeps its id apart, the email may use data-id. */
function hlIdOf(el: HTMLElement): string | undefined {
  return el.tagName === "IMG" ? el.dataset.thundernotesId : el.dataset.id;
}

/** The highlight piece at an event's target, if any. */
function hlAt(target: EventTarget | null): HTMLElement | null {
  return ((target as Element | null)?.closest?.(HL_SELECTOR) as HTMLElement | null) ?? null;
}

/** This email's Message-ID (from "load"): drafts are stored under it, and every request names it. */
let ref = "";

// Each request names its email: one sent while leaving (a note saved on switching to another
// email) can reach the background after the tab already shows the next email; without the
// name it was saved on that one.
function send<K extends ToBackground["type"]>(request: Extract<ToBackground, { type: K }>): Promise<Responses[K]> {
  // The email and its account (D42): a save arriving after switching to another email, or to the
  // same email's copy in another account, still goes to the notes it was made in.
  return browser.runtime.sendMessage<Responses[K]>(ref ? { ...request, ref, refAccount: accountId ?? "" } : request);
}

// crypto.randomUUID() needs a secure context; message documents are not one (spike finding).
function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- highlights in the DOM ----------------------------------------------------------

type Anchored = Exclude<AnchorResult, { status: "orphan" }>;

const PARTIAL_TITLE = "Partly shown: part of this highlight is not in this view";

/** Tooltip for debug mode: how the highlight was found. */
function matchTitle(r: Anchored): string {
  const details = [
    r.candidates !== undefined ? `${r.candidates} candidates` : "",
    r.errors !== undefined ? `${r.errors} edits` : "",
    r.coverage !== undefined ? `${Math.round(r.coverage * 100)}% of the quote` : "",
  ].filter(Boolean);
  return `ThunderNotes match: ${r.method}${details.length ? ` (${details.join(", ")})` : ""}`;
}

let debug = false;

/** Debug mode colours every highlight by match type (see content.css). */
function setDebug(on: boolean): void {
  debug = on;
  document.documentElement.classList.toggle("thundernotes-debug", on);
  for (const mark of document.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}`)) {
    const r = results.get(mark.dataset.id ?? "");
    if (!r || r.status === "orphan") continue;
    mark.title = on ? matchTitle(r) : r.status === "partial" ? PARTIAL_TITLE : "";
  }
}

function wrapRange(range: Range, id: string, result: Anchored): void {
  const partial = result.status === "partial";
  const root = range.commonAncestorContainer;
  const nodes: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) {
    nodes.push(root as Text);
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (range.intersectsNode(t)) nodes.push(t as Text);
    }
  }
  for (const t of nodes) {
    const start = t === range.startContainer ? range.startOffset : 0;
    const end = t === range.endContainer ? range.endOffset : t.length;
    if (start >= end || !t.data.slice(start, end).trim()) continue;
    // Text that isn't drawn gets no mark: e.g. the "> " quote markers of plain-text emails,
    // which Thunderbird hides behind its quote bars. Such a mark has no box (0, 0) and
    // pulled the card to the top of the email.
    if (t.parentElement && !t.parentElement.checkVisibility()) continue;
    if (end < t.length) t.splitText(end);
    const target = start > 0 ? t.splitText(start) : t;
    const mark = document.createElement("mark");
    mark.className = partial ? `${MARK_CLASS} ${MARK_CLASS}-partial` : MARK_CLASS;
    mark.dataset.id = id;
    mark.dataset.method = result.method;
    if (debug) mark.title = matchTitle(result);
    else if (partial) mark.title = PARTIAL_TITLE;
    target.parentNode!.insertBefore(mark, target);
    mark.appendChild(target);
  }
  // Rounded ends and the extra width only at the outer ends (see content.css).
  const marks = marksOf(id);
  marks[0]?.classList.add(`${MARK_CLASS}-start`);
  marks[marks.length - 1]?.classList.add(`${MARK_CLASS}-end`);
  markNote(id);
  applyMarkColour(id);
}

/** Colour variables for a highlight's marks (content.css chooses which applies, D29). */
function applyMarkColour(id: string): void {
  const colour = colourOf(set?.annotations.find((a) => a.id === id)?.colour);
  for (const m of marksOf(id)) {
    m.style.setProperty("--tn-c-bg", rgba(colour));
    m.style.setProperty("--tn-c-active", rgba(colour, Math.min(1, colour.alpha + 0.3)));
    m.style.setProperty("--tn-c-partial", rgba(colour, colour.alpha / 2));
    m.style.setProperty("--tn-c-frame", darker(colour));
    m.style.setProperty("--tn-c-fg", textOn(colour));
  }
}

/** A highlight's pieces: its marks, or its picture. */
function marksOf(id: string): HTMLElement[] {
  const q = CSS.escape(id);
  return [...document.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}[data-id="${q}"], img.${IMG_CLASS}[data-thundernotes-id="${q}"]`)];
}

const MARK_VARIABLES = ["--tn-c-bg", "--tn-c-active", "--tn-c-partial", "--tn-c-frame", "--tn-c-fg"];

/** Frames a highlighted picture (D46). */
function frameImage(img: HTMLElement, id: string): void {
  img.classList.add(IMG_CLASS);
  img.dataset.thundernotesId = id;
  markNote(id);
  applyMarkColour(id);
}

/** Highlights with a note get a frame (see content.css). */
function markNote(id: string): void {
  const hasNote = !!set?.annotations.find((a) => a.id === id)?.bodyMd;
  for (const m of marksOf(id)) m.classList.toggle(`${MARK_CLASS}-note`, hasNote);
}

/** Bounding box of all pieces of a highlight, in document coordinates. */
function highlightRect(id: string): DOMRect | null {
  // Marks without a box (inside hidden elements) would put the top at 0.
  const rects = marksOf(id)
    .map((m) => m.getBoundingClientRect())
    .filter((r) => r.width > 0 || r.height > 0);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return new DOMRect(
    left + window.scrollX,
    top + window.scrollY,
    Math.max(...rects.map((r) => r.right)) - left,
    Math.max(...rects.map((r) => r.bottom)) - top
  );
}

function unwrap(id: string): void {
  for (const mark of marksOf(id)) {
    if (mark.tagName === "IMG") {
      mark.classList.remove(IMG_CLASS, `${MARK_CLASS}-note`, `${MARK_CLASS}-active`);
      if (!mark.classList.length) mark.removeAttribute("class");
      delete mark.dataset.thundernotesId;
      for (const v of MARK_VARIABLES) mark.style.removeProperty(v);
      if (!mark.style.length) mark.removeAttribute("style");
      continue;
    }
    const parent = mark.parentNode!;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

function selectors(a: Annotation): { quote?: TextQuoteSelector; position?: TextPositionSelector } {
  return {
    quote: a.selectors.find((s): s is TextQuoteSelector => s.type === "TextQuoteSelector"),
    position: a.selectors.find((s): s is TextPositionSelector => s.type === "TextPositionSelector"),
  };
}

// ---- floating UI (Shadow DOM, outside <body>, so not part of the email text) -----------

const host = document.createElement("div");
host.className = "thundernotes-host"; // left out of printing (content.css), unless printed with notes
host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;";
const shadow = host.attachShadow({ mode: "closed" });
shadow.innerHTML = `
  <style>
    .float { position: absolute; z-index: 20; display: none; font: 13px system-ui, sans-serif; } /* above the note cards */
    button { font: inherit; cursor: pointer; border: 1px solid #b9a53c; background: #fff7c2; color: #222;
             border-radius: 6px; padding: 3px 8px; }
    .float button { box-shadow: 0 1px 4px #0004; }
    /* Not on the card's own buttons: they keep the card's colour (D29). */
    button:not(.fold, .colour-btn, .bin, .swatch):hover { background: #ffe97a; }
    ${CARD_CSS}
    ${MARGIN_CSS}
    #add { white-space: nowrap; }
    #add .dots { display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px 3px 4px;
                 background: #fff; border: 1px solid #ddd; border-radius: 12px; box-shadow: 0 1px 4px #0004; }
    #add .mark { width: 15px; height: 15px; margin-right: 2px; }
    #add .swatch { width: 13px; height: 13px; }
    ${SWATCH_CSS}
  </style>
  <div class="float" id="add">
    <span class="dots" title="Highlight in a colour · Ctrl/⌘+Shift+H: the ringed colour · Ctrl/⌘+Shift+N: highlight and write a note"><img class="mark" alt="ThunderNotes"><span id="addDots" style="display: contents"></span></span>
  </div>`;
document.documentElement.appendChild(host);

// Settings from the options page, applied live:
// "Show editing hints in notes" (on unless switched off),
// "Cmd/Ctrl+L turns a ticked checkbox back into text" (off unless switched on),
// "Renumber numbered lists automatically" (on unless switched off),
// "Cmd/Ctrl+K opens the link picker" (on unless switched off, D39),
// "Adjust text colour in highlights for contrast" (on unless switched off, D29),
// "Use last highlight colour for new highlights" (on unless switched off; else yellow, D29),
// "Past dates shown in red" (on unless switched off, D38),
// "Use empty space beside the email content for notes" (on unless switched off, D23).
const HINTS_KEY = "showEditHints";
const CYCLE_KEY = "checkboxCycleToText";
const RENUMBER_KEY = "renumberLists";
const PICKER_KEY = "cmdKLinkPicker";
const CONTRAST_KEY = "contrastText";
const USE_LAST_KEY = "useLastColour";
const LAST_KEY = "lastColour";
// Label colours (D40) of this email's account (D42), the same on all its devices: a stylesheet in
// the shadow root, kept current.
const LABEL_SETTINGS_KEY = "labelSettings";
let labelSettings: Record<string, { labelColours?: LabelColours }> = {};
let accountId: string | undefined;
function applyLabelColours(): void {
  labelColours = (accountId && labelSettings[accountId]?.labelColours) || {};
  labelStyle.textContent = labelColourCss(labelColours);
}
// Lines from note cards to their highlights (D23): on screen (off by default) and when printing
// with notes (on by default). Drawn when either is on; CSS shows them where wanted.
const LINES_SCREEN_KEY = "linesScreen";
const LINES_PRINT_KEY = "linesPrint";
host.classList.add("lines-print");
let yearShown = false;
const alwaysShowYear = () => yearShown;
let labelColours: LabelColours = {};
const labelStyle = document.createElement("style");
shadow.append(labelStyle);
const OVERDUE_KEY = "pastDatesRed";
const EMPTY_SPACE_KEY = "useEmptySpace";
let useEmptySpace = true;
const YEAR_KEY = "hideCurrentYear";
let cycleToText = false;
let renumber = true;
let linkPicker = true;
let useLastColour = true;
let lastColour: string = DEFAULT_COLOUR;
function applySettings(s: Record<string, unknown>): void {
  if (HINTS_KEY in s) host.classList.toggle("no-hints", s[HINTS_KEY] === false);
  if (OVERDUE_KEY in s) host.classList.toggle("no-overdue", s[OVERDUE_KEY] === false);
  if (LINES_SCREEN_KEY in s || LINES_PRINT_KEY in s) {
    if (LINES_SCREEN_KEY in s) host.classList.toggle("lines-screen", s[LINES_SCREEN_KEY] === true);
    if (LINES_PRINT_KEY in s) host.classList.toggle("lines-print", s[LINES_PRINT_KEY] !== false);
    if (lastLayout) drawLines(...lastLayout);
  }
  if (YEAR_KEY in s) {
    yearShown = s[YEAR_KEY] === false;
    setAlwaysShowYear(yearShown);
  }
  if (CYCLE_KEY in s) cycleToText = s[CYCLE_KEY] === true;
  if (EMPTY_SPACE_KEY in s) {
    useEmptySpace = s[EMPTY_SPACE_KEY] !== false;
    margin?.refit();
  }
  if (RENUMBER_KEY in s) renumber = s[RENUMBER_KEY] !== false;
  if (PICKER_KEY in s) linkPicker = s[PICKER_KEY] !== false;
  if (CONTRAST_KEY in s) document.documentElement.classList.toggle("thundernotes-contrast", s[CONTRAST_KEY] !== false);
  if (USE_LAST_KEY in s) useLastColour = s[USE_LAST_KEY] !== false;
  if (LAST_KEY in s && typeof s[LAST_KEY] === "string") lastColour = s[LAST_KEY] as string;
  if (LABEL_SETTINGS_KEY in s) {
    labelSettings = (s[LABEL_SETTINGS_KEY] as typeof labelSettings | undefined) ?? {};
    applyLabelColours();
  }
  renderAddDots();
}
document.documentElement.classList.add("thundernotes-contrast"); // default on
browser.storage.local.get([HINTS_KEY, CYCLE_KEY, RENUMBER_KEY, PICKER_KEY, CONTRAST_KEY, USE_LAST_KEY, LAST_KEY, OVERDUE_KEY, LABEL_SETTINGS_KEY, YEAR_KEY, LINES_SCREEN_KEY, LINES_PRINT_KEY, EMPTY_SPACE_KEY]).then(applySettings);
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  applySettings(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
});

/** The colour for a new highlight: the last one chosen, or yellow (D29). */
function newColour(): string {
  return useLastColour ? colourOf(lastColour).name : DEFAULT_COLOUR;
}

/** Remembers a chosen colour for the next new highlight. */
function chose(colour: string): void {
  lastColour = colour;
  void send({ type: "setPref", key: "lastColour", value: colour });
  renderAddDots();
}

/** Colour dots next to the Highlight button: one click highlights in that colour. */
function renderAddDots(): void {
  const dots = shadow.getElementById("addDots");
  if (!dots) return;
  dots.replaceChildren(
    ...COLOUR_NAMES.map((name) => {
      const dot = swatch(name, name === newColour());
      dot.title = `Highlight in ${colourOf(name).label}`;
      dot.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
      dot.addEventListener("click", () => {
        chose(name);
        highlightSelection(false, name).catch(console.error);
      });
      return dot;
    })
  );
}

const addBox = shadow.getElementById("add")!;

function inUi(e: Event): boolean {
  if (e.composedPath().includes(host) || e.target === host) return true;
  // While the message isn't focused (e.g. back from the message list), the first click arrives
  // without the shadow path (seen in testing): fall back to what lies under the pointer.
  return e instanceof MouseEvent && document.elementFromPoint(e.clientX, e.clientY) === host;
}

// Buttons must not take the text selection away.
for (const b of shadow.querySelectorAll("button")) b.addEventListener("mousedown", (e) => e.preventDefault());

// ---- state and actions --------------------------------------------------------------------

let set: AnnotationSet | null = null;
/** The displayed message is a ThunderNotes carrier: no highlighting (D27). */
let isCarrier = false;
const results = new Map<string, AnchorResult>();

let margin: Margin;
/** Cards folded to their quote line (D30). */
let folded = new Set<string>();
// Drafts (D34): text typed into a note's editor is kept in storage.local a moment after the
// last change and dropped when editing ends (saved or Esc). One left over means Thunderbird
// closed or crashed meanwhile; the card offers it back.
const DRAFTS_KEY = "drafts";
type Drafts = Record<string, Draft>;
let drafts: Drafts = {};

async function readDrafts(): Promise<Drafts> {
  const stored = (await browser.storage.local.get(DRAFTS_KEY))[DRAFTS_KEY];
  return stored && typeof stored === "object" ? (stored as Drafts) : {};
}

/** A draft's key: the email in its account (D42), and the note. */
const draftKey = (id: string) => `${accountId ?? ""}|${ref} ${id}`;

function draftFor(id: string): Draft | null {
  const draft = drafts[draftKey(id)] ?? drafts[`${ref} ${id}`]; // the latter: kept before D42
  if (!draft) return null;
  // Saved after all (the page closed before the draft could be dropped): nothing to offer.
  const saved = id === EMAIL_NOTE_ID ? (set?.emailNoteMd ?? "") : (set?.annotations.find((a) => a.id === id)?.bodyMd ?? "");
  return draft.text.trim() === saved ? null : draft;
}

async function saveDraft(id: string, text: string | null): Promise<void> {
  const key = draftKey(id);
  // In memory at once (the margin may redraw before storage answers), then stored.
  if (text === null) delete drafts[key];
  else drafts[key] = { text, at: new Date().toISOString() };
  const all = await readDrafts(); // other emails' drafts may have changed meanwhile
  if (text === null) {
    if (!(key in all)) return;
    delete all[key];
  } else {
    all[key] = { text, at: new Date().toISOString() };
  }
  drafts = all;
  await browser.storage.local.set({ [DRAFTS_KEY]: all });
}

function createMargin(collapsed: boolean, width: number | null): Margin {
  return new Margin(
    shadow,
    {
      render: (md) => send({ type: "render", md }),
      clipboard: {
        read: () => send({ type: "readClipboard" }),
        write: (text) => send({ type: "writeClipboard", text }),
      },
      async save(id, bodyMd, base) {
        if (id === EMAIL_NOTE_ID) {
          set = await send({ type: "setEmailNote", md: bodyMd, base });
          await reportStatus();
          return set?.emailNoteMd ?? "";
        }
        set = await send({ type: "update", id, bodyMd, base });
        markNote(id);
        await reportStatus();
        return set?.annotations.find((a) => a.id === id)?.bodyMd ?? bodyMd;
      },
      async remove(id) {
        if (id !== EMAIL_NOTE_ID) return removeHighlight(id);
        margin.remove(id);
        set = await send({ type: "setEmailNote", md: "" });
        await reportStatus();
      },
      openLink: (url) => void send({ type: "openLink", url }),
      cycleToText: () => cycleToText,
      renumberLists: () => renumber,
      copyTask: (id, md, line) => void send({ type: "copyMarkdown", what: "task", id, md, line }),
      copyNote: (id, md) => void send({ type: "copyMarkdown", what: "note", id, md }),
      convertLooseDate: (md, text, k) => send({ type: "convertLooseDate", md, text, k }),
      alwaysYear: () => alwaysShowYear(),
      searchEmails: (query) => send({ type: "searchEmails", query }),
      linkPicker: () => linkPicker,
      knownLabels: () => send({ type: "labels" }),
      setColour: (id, colour) => void setColour(id, colour),
      draft: (id, text) => void saveDraft(id, text).catch(console.error),
      labelColour: (label) => labelColours[label.toLowerCase()]?.colour ?? null,
      setLabelColour: (label, colour) => void send({ type: "setLabelColour", label, colour }),
    },
    {
      rectOf: highlightRect,
      emphasise: (id, on) => marksOf(id).forEach((m) => m.classList.toggle(`${MARK_CLASS}-active`, on)),
      setCollapsed: (collapsed) => void send({ type: "setPref", key: "marginCollapsed", value: collapsed }),
      setWidth: (width) => void send({ type: "setPref", key: "marginWidth", value: width }),
      isFolded: (id) => folded.has(id),
      draftFor,
      laidOut: (cards, active) => drawLines(cards, active),
      useEmptySpace: () => useEmptySpace,
      textOrder: (id) => {
        if (id === EMAIL_NOTE_ID) return -1; // first of the cards without a highlight
        const r = results.get(id);
        return r && r.status !== "orphan" ? r.start : Number.MAX_SAFE_INTEGER;
      },
      setFolded(id, on) {
        if (on) folded.add(id);
        else folded.delete(id);
        send({ type: "setFolded", id, folded: on })
          .then((synced) => {
            if (synced) set = synced;
          })
          .catch(console.error);
      },
    },
    collapsed,
    width
  );
}

async function reportStatus(): Promise<void> {
  let partial = 0;
  let orphan = 0;
  for (const r of results.values()) {
    if (r.status === "partial") partial++;
    if (r.status === "orphan") orphan++;
  }
  const withNote = set?.annotations.filter((a) => a.bodyMd).length ?? 0;
  const notes = withNote + (set?.emailNoteMd ? 1 : 0);
  const highlights = (set?.annotations.length ?? 0) - withNote;
  // Notes changed on two devices at once, still holding a conflict box (D32).
  const conflicts = [...(set?.annotations.map((a) => a.bodyMd) ?? []), set?.emailNoteMd ?? ""].filter(hasConflict).length;
  // For "Print with Notes" in Thunderbird's menus (the Experiment): active only with notes.
  document.documentElement.toggleAttribute("data-thundernotes-notes", notes + highlights > 0);
  await send({ type: "status", notes, highlights, partial, orphan, conflicts });
}

function renderAll(): void {
  results.clear();
  if (!set?.annotations.length) return;
  const ex = extractText(document.body);
  // Anchor everything against the untouched text first, then wrap one by one, each range
  // made from a fresh extraction (marks don't change the text). Ranges made up front broke
  // for a highlight inside an earlier one: wrapping moves the text node a range points into,
  // which collapses that range (seen with a restored highlight inside a longer one).
  const pending: { id: string; result: Anchored }[] = [];
  for (const a of set.annotations) {
    const image = imageSelectorOf(a);
    if (image) {
      // A picture is framed at once: that changes neither the text nor the other ranges.
      const { element, result } = anchorImage(document.body, ex, image);
      results.set(a.id, result);
      if (element instanceof HTMLElement && !hlIdOf(element)) frameImage(element, a.id);
      else if (element) results.set(a.id, { status: "orphan" }); // the same picture twice: framed once
      continue;
    }
    const { quote, position } = selectors(a);
    const result: AnchorResult = quote ? anchor(ex.text, quote, position) : { status: "orphan" };
    results.set(a.id, result);
    if (result.status !== "orphan") pending.push({ id: a.id, result });
  }
  for (const p of pending) {
    const now = extractText(document.body);
    wrapRange(offsetsToRange(now, p.result.start, p.result.end), p.id, p.result);
  }
}

/** Highlights the selection; with `withNote`, opens the card to write a note. */
async function highlightSelection(withNote = false, colour = newColour()): Promise<void> {
  if (isCarrier) return;
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!document.body.contains(range.commonAncestorContainer)) return;
  const ex = extractText(document.body);
  const { start, end } = rangeToOffsets(ex, range);
  selection.removeAllRanges();
  addBox.style.display = "none";
  if (end <= start) return;

  const now = new Date().toISOString();
  const annotation: Annotation = {
    id: newId(),
    selectors: describe(ex.text, start, end),
    bodyMd: "",
    colour,
    created: now,
    updated: now,
  };
  set = await send({ type: "add", annotation });
  const result: Anchored = { status: "anchored", method: "position", start, end };
  results.set(annotation.id, result);
  wrapRange(offsetsToRange(ex, start, end), annotation.id, result);
  await reportStatus();
  if (withNote) openCard(annotation.id);
}

/** Highlights the right-clicked picture (D46); with `withNote`, opens the card to write a note. */
async function highlightImage(withNote: boolean, colour = newColour()): Promise<void> {
  const img = contextImage;
  if (isCarrier || !img || !document.body.contains(img) || hlIdOf(img)) return;
  const ex = extractText(document.body);
  const now = new Date().toISOString();
  const annotation: Annotation = {
    id: newId(),
    selectors: [describeImage(document.body, ex, img)],
    bodyMd: "",
    colour,
    created: now,
    updated: now,
  };
  set = await send({ type: "add", annotation });
  const offset = imageOffset(ex, img);
  results.set(annotation.id, { status: "anchored", method: "position", start: offset, end: offset });
  frameImage(img, annotation.id);
  await reportStatus();
  if (withNote) openCard(annotation.id);
}

/** Changes a highlight's colour (any of the ways to choose, D29). */
async function setColour(id: string, colour: string): Promise<void> {
  chose(colour);
  set = await send({ type: "setColour", id, colour });
  applyMarkColour(id);
  const annotation = id === EMAIL_NOTE_ID ? emailNoteAnnotation(set) : set?.annotations.find((a) => a.id === id);
  if (annotation) margin.recolour(annotation);
}

async function removeHighlight(id: string): Promise<void> {
  margin.remove(id);
  set = await send({ type: "remove", id });
  unwrap(id);
  results.delete(id);
  await reportStatus();
}

function openCard(id: string, edit = true, line?: number): boolean {
  const annotation = id === EMAIL_NOTE_ID ? emailNoteAnnotation(set) : set?.annotations.find((a) => a.id === id);
  if (annotation) margin.open(annotation, edit, line);
  return !!annotation;
}

/**
 * From the task view (D38): the task's note opens for editing, the cursor at the end of its
 * line. The message pane gets the keyboard focus first (Thunderbird gives it to the tab), then
 * the cursor is placed again, now in a focused editor.
 */
function openForTask(id: string, line: number): boolean {
  return openForEditing(() => openCard(id, true, line), () => send({ type: "focusPane" }));
}

/** The popup closes once this message is answered; it would take the focus back if moved sooner. */
const POPUP_CLOSING_MS = 150;

function cardStatus(id: string): CardStatus {
  const status = results.get(id)?.status;
  return status === "partial" || status === "orphan" ? status : null;
}

function syncMargin(): void {
  margin.sync(set, cardStatus);
}

/** Popup: scroll to a highlight (or its card, if it has no highlight here) and open the card. */
function focus(id: string): void {
  // From the popup: go to the card (margin.open scrolls it into view), not to the highlight.
  // Editing starts only if the email has the keyboard focus, usually not right after the
  // popup closes; then the card is shown and one click edits it (wanted, D23).
  window.focus();
  openCard(id, true);
}

/** Popup: the email note and all highlights in reading order. */
/** Reading order: by where the passage is in the email, passages not found last. */
function readingPlace(id: string): number {
  const r = results.get(id);
  return r && r.status !== "orphan" ? r.start : Number.MAX_SAFE_INTEGER;
}

async function listState(): Promise<ListState> {
  const order = readingPlace;
  const items = (set?.annotations ?? [])
    .map((a) => ({
      id: a.id,
      quote: quoteLabel(a) ?? "",
      bodyMd: a.bodyMd,
      colour: colourOf(a.colour).name,
      status: results.get(a.id)?.status ?? ("orphan" as const),
    }))
    .sort((a, b) => order(a.id) - order(b.id));
  const deleted = restorable(set);
  const count = deleted.annotations.length + (deleted.emailNote !== null ? 1 : 0);
  const backlinks = await send({ type: "backlinks" }).catch(() => []);
  return { emailNoteMd: set?.emailNoteMd ?? "", emailNoteColour: set?.emailNoteColour, items, restorable: count, backlinks };
}

/** All notes of this email as Markdown, in reading order (D38's conventions; built in the background). */
async function copyAllNotes(): Promise<boolean> {
  const order = (set?.annotations ?? []).map((a) => a.id).sort((a, b) => readingPlace(a) - readingPlace(b));
  return send({ type: "copyMarkdown", what: "all", order });
}

/** Reload stored notes and redraw everything (after an import). */
async function refresh(): Promise<void> {
  await redraw(await send({ type: "load" }));
}

/** Highlights and cards drawn again from freshly loaded notes. */
async function redraw(loaded: Responses["load"]): Promise<void> {
  const drawn = document.querySelectorAll<HTMLElement>(HL_SELECTOR);
  for (const id of new Set([...drawn].map((m) => hlIdOf(m) ?? ""))) unwrap(id);
  set = loaded.set;
  folded = new Set(loaded.folded);
  drafts = await readDrafts();
  renderAll();
  for (const a of set?.annotations ?? []) markNote(a.id);
  setDebug(debug);
  syncMargin();
  await reportStatus();
}

// ---- events -----------------------------------------------------------------------------------

function onSelectionDone(): void {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    addBox.style.display = "none";
    return;
  }
  const range = selection.getRangeAt(0);
  if (!document.body.contains(range.commonAncestorContainer)) return;
  const rects = range.getClientRects();
  const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
  addBox.style.top = `${last.bottom + window.scrollY + 6}px`;
  addBox.style.display = "block";
  // Not into the note cards' column (nor past the window's edge): shifted left if needed.
  const limit = margin?.leftEdge() ?? window.innerWidth - 4;
  const left = Math.min(last.right - 60, limit - addBox.offsetWidth);
  addBox.style.left = `${Math.max(4, left) + window.scrollX}px`;
}

/** A plain left click: not the right button, not Ctrl+click (the context menu on macOS). */
function isPrimaryClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.ctrlKey;
}

/** The link around a highlight (or a highlight inside a link), if any. */
function linkOf(target: EventTarget | null): HTMLAnchorElement | null {
  return ((target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null) ?? null;
}

document.addEventListener("mouseup", (e) => {
  if (inUi(e) || !isPrimaryClick(e)) return;
  const mark = hlAt(e.target);
  const id = mark && hlIdOf(mark);
  if (id && document.getSelection()?.isCollapsed) {
    if (linkOf(mark)) return; // a highlighted link: the click listener below asks what to do
    addBox.style.display = "none";
    openCard(id);
    return;
  }
  // Let the selection settle first.
  setTimeout(onSelectionDone, 0);
});

// A highlighted link (D31): a click asks whether to open the note or the link, at the place
// clicked; Cmd/Ctrl+click opens the link directly, as in the note editor. Links that
// aren't highlighted behave as always.
const linkMenuHost = document.createElement("div");
linkMenuHost.style.cssText = "position:absolute;top:0;left:0;z-index:20;"; // above the note cards
shadow.append(linkMenuHost);

document.addEventListener(
  "click",
  (e) => {
    if (inUi(e) || e.button !== 0 || e.metaKey || e.ctrlKey) return;
    const mark = hlAt(e.target);
    const link = linkOf(mark);
    const id = mark ? hlIdOf(mark) : undefined;
    if (!link || !id || !document.getSelection()?.isCollapsed) return;
    e.preventDefault(); // no navigation
    e.stopPropagation();
    addBox.style.display = "none";
    // From the keyboard (Enter on the link) there is no mouse position: below the link.
    const r = link.getBoundingClientRect();
    const at = e.detail === 0 ? ({ clientX: r.left, clientY: r.bottom + 4 } as MouseEvent) : e;
    const url = link.href;
    let strong = url;
    let rest = "";
    try {
      const u = new URL(url);
      strong = u.protocol === "mailto:" ? u.pathname : u.host;
      rest = u.protocol === "mailto:" ? "" : `${u.pathname === "/" ? "" : u.pathname}${u.search}`;
    } catch {
      // not a URL we can split: show it whole
    }
    const hasNote = !!set?.annotations.find((a) => a.id === id)?.bodyMd;
    openMenu(
      linkMenuHost,
      at,
      [
        { label: url, info: { strong, rest }, run() {} },
        { label: hasNote ? "Edit note" : "Add note", separator: true, run: () => void openCard(id) },
        { label: "Open link", kbd: `${MOD}click`, run: () => void send({ type: "openLink", url }) },
      ],
      margin?.leftEdge() ?? undefined
    );
  },
  true
);

document.addEventListener("mousedown", (e) => {
  if (inUi(e) || !isPrimaryClick(e)) return;
  addBox.style.display = "none";
  // Normally the editor's blur already saved; this also ends editing that lost focus.
  margin.commitAll();
  margin.deactivate();
});

// Hovering a highlight emphasises its card.
let hovered: string | null = null;
document.addEventListener("mouseover", (e) => {
  const mark = hlAt(e.target);
  const id = (mark && hlIdOf(mark)) ?? null;
  if (id === hovered) return;
  if (hovered) margin.hover(hovered, false);
  hovered = id;
  if (id) margin.hover(id, true);
});

document.addEventListener("keyup", (e) => {
  if (!inUi(e) && e.shiftKey && !e.ctrlKey && !e.metaKey) setTimeout(onSelectionDone, 0);
});

document.addEventListener("keydown", (e) => {
  if (inUi(e)) return;
  const shortcut = (e.ctrlKey || e.metaKey) && e.shiftKey;
  // Cmd+Option+1…8 (Ctrl+Alt+1…8): highlight the selection in that colour, or recolour the active card.
  const digit = /^Digit([1-8])$/.exec(e.code);
  if (digit && e.altKey && (e.ctrlKey || e.metaKey)) {
    const colour = COLOUR_NAMES[Number(digit[1]) - 1]!;
    if (document.getSelection()?.isCollapsed === false) {
      e.preventDefault();
      chose(colour);
      highlightSelection(false, colour).catch(console.error);
    } else if (margin.activeId) {
      e.preventDefault();
      void setColour(margin.activeId, colour);
    }
    return;
  }
  if (shortcut && (e.code === "KeyH" || e.code === "KeyN") && document.getSelection()?.isCollapsed === false) {
    e.preventDefault();
    highlightSelection(e.code === "KeyN").catch(console.error);
  } else if (e.key === "Escape") {
    addBox.style.display = "none";
    margin.deactivate();
  }
});

// The post-it at the left of the colour bar: just a "this is ThunderNotes" marker.
(shadow.querySelector("#add .mark") as HTMLImageElement).src = browser.runtime.getURL("icons/icon.svg");

// Right-click on a highlight or a note card: the background asks which one, to offer
// Remove highlight / Remove note. The Shadow DOM is closed, so its event path is hidden
// from document listeners: cards are detected by a listener on the shadow root itself.
let contextTarget: string | null = null;
let contextInEditor = false;
/** A picture right-clicked that isn't highlighted yet: offered "Highlight picture" (D46). */
let contextImage: HTMLElement | null = null;
document.addEventListener("contextmenu", (e) => {
  if (inUi(e)) return;
  const mark = hlAt(e.target);
  contextTarget = (mark && hlIdOf(mark)) ?? null;
  contextInEditor = false;
  const img = (e.target as Element | null)?.closest?.("img") as HTMLElement | null;
  contextImage = !contextTarget && img && document.body.contains(img) ? img : null;
  // On a highlight (nothing selected): our own menu instead of Thunderbird's, the same as on
  // the cards, with the real colour dots (Thunderbird's menu shows no icons in it, D29).
  if (mark && contextTarget && document.getSelection()?.isCollapsed !== false) {
    e.preventDefault();
    e.stopPropagation();
    openHighlightMenu(mark, e);
  }
});

/** The right-click menu of a highlight: colours, the note, the link it's in, Copy, delete. */
function openHighlightMenu(mark: HTMLElement, e: MouseEvent): void {
  const id = hlIdOf(mark)!;
  const annotation = set?.annotations.find((a) => a.id === id);
  if (!annotation) return;
  const link = linkOf(mark);
  const href = link?.href ?? "";
  const text = marksOf(id).map((m) => m.textContent ?? "").join("");
  const items: MenuItem[] = [
    colourItem(colourOf(annotation.colour).name, (name) => void setColour(id, name)),
    { label: annotation.bodyMd ? "Edit note" : "Add note", separator: true, run: () => void openCard(id) },
    ...(href ? [{ label: /^mid:/i.test(href) ? "Open email" : "Open link", run: () => void send({ type: "openLink", url: href }) }] : []),
    ...(text ? [{ label: "Copy", kbd: `${MOD}C`, run: () => send({ type: "writeClipboard", text }) }] : []),
    ...(annotation.bodyMd ? [{ label: "Copy note as Markdown", run: () => void send({ type: "copyMarkdown", what: "note", id, md: annotation.bodyMd }) }] : []),
    { label: annotation.bodyMd ? "Delete note and highlight" : mark.tagName === "IMG" ? "Remove highlight from picture" : "Remove highlight", danger: true, separator: true, run: () => removeHighlight(id) },
  ];
  openMenu(linkMenuHost, e, items, margin?.leftEdge() ?? undefined);
}
shadow.addEventListener("contextmenu", (e) => {
  const target = e.target as Element | null;
  contextInEditor = target instanceof HTMLTextAreaElement;
  const card = contextInEditor ? null : (target?.closest?.(".card") as HTMLElement | null);
  contextTarget = card?.dataset.id ?? null;
});

function contextInfo(): ContextInfo {
  const annotation = set?.annotations.find((a) => a.id === contextTarget);
  const selection = document.getSelection();
  const selectionInBody =
    !contextInEditor &&
    !!selection &&
    !selection.isCollapsed &&
    selection.rangeCount > 0 &&
    document.body.contains(selection.getRangeAt(0).commonAncestorContainer);
  return {
    target: annotation ? { hasNote: !!annotation.bodyMd, colour: colourOf(annotation.colour).name } : null,
    inEditor: contextInEditor,
    selectionInBody,
    image: !!contextImage && !contextInEditor && !isCarrier,
    hasNotes: !!set && (set.annotations.some((a) => a.bodyMd) || !!set.emailNoteMd),
  };
}

// Switching message or closing: save an open editor first.
window.addEventListener("pagehide", () => margin?.commitAll());
// Back from the message list (e.g. after "Copy ThunderNotes link") or another app: the editor
// that stayed open gets the cursor again, so Cmd/Ctrl+V pastes straight into the note.
window.addEventListener("focus", () => margin?.refocusEditing());

// Notes changed while this email was in a background tab (a task ticked in the task view, D38;
// sync): drawn again on coming back, should the refresh sent then not have arrived or shown.
async function refreshIfChanged(): Promise<void> {
  if (!ref || isCarrier || margin?.isEditing()) return;
  const loaded = await send({ type: "load" });
  if ((loaded.set?.updated ?? "") !== (set?.updated ?? "") && !margin?.isEditing()) await redraw(loaded);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshIfChanged().catch(console.error);
});
window.addEventListener("focus", () => void refreshIfChanged().catch(console.error));
window.addEventListener("blur", () => margin?.suspendEditing());

browser.runtime.onMessage.addListener((message: ToContent) => {
  switch (message?.type) {
    case "highlightSelection":
      return highlightSelection();
    case "highlightImage":
      return highlightImage(message.withNote);
    case "setDebug":
      setDebug(message.on);
      return undefined;
    case "contextTarget":
      return Promise.resolve(contextInfo());
    case "noteTarget":
      if (contextTarget) openCard(contextTarget);
      return undefined;
    case "removeTarget":
      return contextTarget ? removeHighlight(contextTarget) : undefined;
    case "colourTarget":
      return contextTarget ? setColour(contextTarget, message.colour) : undefined;
    case "listState":
      return listState();
    case "focus":
      if (message.ref !== undefined) return Promise.resolve(message.ref === ref && openForTask(message.id, message.line ?? 0));
      focus(message.id);
      return undefined;
    case "editEmailNote":
      // Clicked to write: edit, also when the popup click left the focus outside the email.
      window.focus();
      openForEditing(() => openCard(EMAIL_NOTE_ID, true), () => send({ type: "focusPane" }), POPUP_CLOSING_MS);
      return undefined;
    case "isEditing":
      return Promise.resolve(margin?.isEditing() ?? false);
    case "copyAllNotes":
      return copyAllNotes();
    case "refresh":
      return refresh();
    case "restoreDeleted":
      return send({ type: "restoreDeleted" }).then(() => refresh());
    case "purgeDeleted":
      return send({ type: "purgeDeleted" }).then(() => refresh());
  }
  return undefined;
});

/**
 * Printing normally leaves the notes, highlights and the narrower email out (content.css), so
 * an email prints as without ThunderNotes. "Print with Notes" in Thunderbird's menus (added by
 * the Experiment, which then opens the print dialog) prints with them: as shown, or every note
 * expanded. The print takes a copy of the page; afterwards the page is as before.
 */
/**
 * How far the email moves down in print: Thunderbird's header table (`.moz-main-header` and the
 * line break after it, messageBody.css) is in the email's page but shown only when printing. It is
 * shown for a moment to measure, in one go with no repaint in between, then hidden again. Measured
 * on the email's own text (a highlight, else what follows the header), not on an empty marker:
 * the first paragraph's top margin merges with the page's while nothing is above it and stops
 * merging below the header, so the text moves further than the header is tall (by about half a
 * line: line ends sat at the middle of their highlights in print).
 */
function printHeaderShift(): number {
  const headers = [...document.querySelectorAll<HTMLElement>(".moz-main-header, .moz-main-header + br")];
  if (!headers.length) return 0;
  const after = headers[headers.length - 1]!.nextElementSibling;
  const ref = document.querySelector(`mark.${MARK_CLASS}`) ?? (after instanceof HTMLElement ? after : null);
  if (!ref) return 0;
  const before = ref.getBoundingClientRect().top;
  const styles = headers.map((el) => el.getAttribute("style"));
  for (const el of headers) el.style.setProperty("display", el.tagName === "BR" ? "inline" : "table", "important");
  const shift = ref.getBoundingClientRect().top - before;
  headers.forEach((el, i) => (styles[i] === null ? el.removeAttribute("style") : el.setAttribute("style", styles[i]!)));
  return Math.max(0, shift);
}

function printWithNotes(expanded: boolean): void {
  document.documentElement.classList.add("thundernotes-print-notes");
  bandLines(true);
  margin?.showForPrint(true); // also while hidden with "Hide notes"
  // All expanded: really unfolded and laid out anew (else the cards kept their folded places and
  // overlapped in the print); afterwards back as they were.
  if (expanded) margin?.expandAllForPrint(true);
  // Measured once the email has its print width (narrowed for the notes).
  host.style.setProperty("--thundernotes-print-shift", `${printHeaderShift()}px`);
  const done = () => {
    clearTimeout(fallback);
    document.documentElement.classList.remove("thundernotes-print-notes");
    bandLines(false);
    margin?.showForPrint(false);
    if (expanded) margin?.expandAllForPrint(false);
  };
  window.addEventListener("afterprint", done, { once: true });
  document.addEventListener("thundernotes-print-done", done, { once: true }); // the dialog couldn't open
  const fallback = setTimeout(done, 10_000); // no afterprint at all: back anyway
}
document.addEventListener("thundernotes-print-shown", () => printWithNotes(false));
document.addEventListener("thundernotes-print-expanded", () => printWithNotes(true));

// ---- lines from note cards to their highlights (D23) ------------------------------------------
// Straight, like a translucent felt-tip stroke, from the middle of each card's left edge to the
// middle of its underlined passage (connectors.ts), across the text; in the highlight's darker
// shade, the active card's a little stronger.

const SVG_NS = "http://www.w3.org/2000/svg";
// On screen one drawing; when printing, each line in bands of their own (connectors.ts).
const linesLayer = document.createElement("div");
linesLayer.className = "connectors";
let linesBanded = false;
const linesStyle = document.createElement("style");
linesStyle.textContent = `
  .connectors { position: absolute; top: 0; left: 0; width: 0; height: 0; pointer-events: none; display: none; }
  @media screen { :host(.lines-screen) .connectors { display: block; } }
  @media print { :host(.lines-print) .connectors { display: block; } }
  .connectors svg { position: absolute; overflow: visible; }
  .connectors line { stroke-width: 4; stroke-linecap: round; opacity: 0.3; }
  .connectors line.active { opacity: 0.5; }
`;
shadow.prepend(linesStyle, linesLayer); // behind the cards
let lastLayout: [CardBox[], string | null] | null = null;

function drawLines(cards: CardBox[], active: string | null): void {
  lastLayout = [cards, active];
  for (const anchor of printAnchors) anchor.remove();
  printAnchors = [];
  linesLayer.replaceChildren();
  const printing = linesBanded && host.classList.contains("lines-print");
  if (!printing && !host.classList.contains("lines-screen") && !host.classList.contains("lines-print")) return;
  const colourOfNote = new Map(set?.annotations.map((a) => [a.id, a.colour]) ?? []);
  const lines: { line: SVGLineElement; mark: HTMLElement }[] = [];
  for (const card of cards) {
    if (card.id === EMAIL_NOTE_ID) continue;
    const parts = marksOf(card.id).flatMap((mark) =>
      [...mark.getClientRects()].map((rect) => ({ mark, rect })),
    );
    const mid = passageMiddle(parts.map((p) => p.rect));
    if (!mid) continue; // passage not found: no line
    const from = { x: mid.x + window.scrollX, y: mid.y + window.scrollY };
    const to = cardMiddle(card);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    line.setAttribute("stroke", darker(colourOf(colourOfNote.get(card.id))));
    if (card.id === active) line.classList.add("active");
    lines.push({ line, mark: parts[mid.index]!.mark });
  }
  if (printing) return drawLinesForPrint(lines);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.append(...lines.map((l) => l.line));
  linesLayer.replaceChildren(svg);
}

/**
 * Printing: Thunderbird lays the email's lines out a little differently on paper than on screen
 * (on screen line heights are rounded to whole pixels), so positions taken on screen drift away
 * from the text further down a long email. Each line therefore starts from a marker inside its
 * highlight and moves with the text; what is left of the drift lands at the card's end, a big
 * target. A line is drawn in bands of its own, so it also shows on every page it runs over (one
 * drawing overflowing its box printed only on its first page). Removed again after the print.
 */
let printAnchors: HTMLElement[] = [];
function drawLinesForPrint(lines: { line: SVGLineElement; mark: HTMLElement }[]): void {
  for (const { line, mark } of lines) {
    const anchor = document.createElement("span");
    anchor.className = "thundernotes-line-anchor";
    // Inline styles, important: the email's own CSS for span or svg must not move them.
    anchor.style.cssText = "display:inline !important;position:static !important;margin:0 !important;padding:0 !important;";
    // A picture can't hold the marker: it goes just before it.
    if (mark.tagName === "IMG") mark.before(anchor);
    else mark.prepend(anchor);
    printAnchors.push(anchor);
    const at = (name: string) => Number(line.getAttribute(name));
    let origin: { x: number; y: number } | null = null;
    for (const band of lineBands({ x: at("x1"), y: at("y1") }, { x: at("x2"), y: at("y2") })) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", `${band.left} ${band.top} ${band.width} ${band.height}`);
      svg.setAttribute("width", String(band.width));
      svg.setAttribute("height", String(band.height));
      svg.style.cssText = "position:absolute !important;overflow:hidden !important;pointer-events:none;margin:0;";
      const stroke = line.cloneNode() as SVGLineElement;
      stroke.setAttribute("stroke-width", "4");
      stroke.setAttribute("stroke-linecap", "round");
      stroke.setAttribute("opacity", line.classList.contains("active") ? "0.5" : "0.3");
      svg.append(stroke);
      anchor.append(svg);
      // Where the marker puts a band with no offset (its place in the text), measured once.
      if (!origin) {
        const r = svg.getBoundingClientRect();
        origin = { x: r.left + window.scrollX, y: r.top + window.scrollY };
      }
      svg.style.setProperty("margin-left", `${band.left - origin.x}px`, "important");
      svg.style.setProperty("margin-top", `${band.top - origin.y}px`, "important");
    }
  }
}

/** Printing: lines in bands, so they show on every page (on), or one drawing again (off). */
function bandLines(on: boolean): void {
  linesBanded = on;
  if (lastLayout) drawLines(...lastLayout);
}

// ---- start --------------------------------------------------------------------------------

/**
 * A carrier message (D27): explain instead of offering highlights. The cover can be
 * dismissed, so nothing is withheld; the add-on's other UI stays off on carriers.
 */
function showCarrierCover(): void {
  const cover = document.createElement("div");
  cover.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
  const root = cover.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .back { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
              background: color-mix(in srgb, Canvas 86%, transparent); backdrop-filter: blur(2px); }
      .box { max-width: 440px; margin: 16px; padding: 18px 20px; font: 14px/1.5 system-ui, sans-serif; color: CanvasText;
             background: Canvas; border: 1px solid #d8c66a; border-radius: 10px; box-shadow: 0 4px 20px #0003; }
      h1 { font-size: 16px; margin: 0 0 8px; }
      p { margin: 6px 0; }
      button { font: inherit; margin-top: 10px; padding: 4px 14px; cursor: pointer; }
    </style>
    <div class="back"><div class="box">
      <h1>This message belongs to ThunderNotes</h1>
      <p>ThunderNotes keeps the highlights and notes of one email in a message like this one, so they appear on all your devices.</p>
      <p>It is internal: there is nothing to do here. ThunderNotes replaces it automatically when the notes change.</p>
      <button id="show">Show the message anyway</button>
    </div></div>`;
  root.getElementById("show")!.addEventListener("click", () => cover.remove());
  document.documentElement.appendChild(cover);
}

(async () => {
  const loaded = await send({ type: "load" });
  if (loaded.carrier) {
    isCarrier = true;
    host.remove();
    showCarrierCover();
    return;
  }
  if (loaded.unsupported === "missingMessageId") {
    const notice = document.createElement("div");
    notice.setAttribute("role", "status");
    notice.textContent = "ThunderNotes can't safely annotate this message because Thunderbird supplied no Message-ID. No notes were loaded or saved.";
    notice.style.cssText = "position:fixed;top:12px;right:12px;max-width:360px;padding:10px 14px;border:1px solid #b9a53c;border-radius:8px;background:#fff7c2;color:#222;font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px #0003;";
    shadow.append(notice);
    return;
  }
  set = loaded.set;
  folded = new Set(loaded.folded);
  ref = loaded.ref;
  accountId = loaded.accountId;
  applyLabelColours();
  drafts = await readDrafts();
  // Drafts of notes deleted since (on another device, say) are of no use.
  for (const key of Object.keys(drafts)) {
    const prefix = draftKey("");
    const id = key.startsWith(prefix) ? key.slice(prefix.length) : null;
    if (id && id !== EMAIL_NOTE_ID && !set?.annotations.some((a) => a.id === id)) void saveDraft(id, null);
  }
  margin = createMargin(loaded.marginCollapsed, loaded.marginWidth);
  renderAll();
  for (const a of set?.annotations ?? []) markNote(a.id);
  setDebug(loaded.debug);
  syncMargin();
  // Opened from the task view (D38): that note, ready to edit.
  if (loaded.focus) openForTask(loaded.focus.id, loaded.focus.line);
  await reportStatus();
})().catch((e) => console.error("ThunderNotes:", e));
