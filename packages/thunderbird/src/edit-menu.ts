/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { COLOURS, COLOUR_NAMES, darker, effective } from "@thundernotes/core";
import { linkForPaste } from "./links.js";

// The note editors' own right-click menu: Cut / Copy / Paste / Select All. Thunderbird's
// message-pane menu offers Copy but no Paste for text fields inside an email, and items
// added through the menus API end up in a "ThunderNotes" submenu. Used by the CodeMirror
// editor (D28) and the textarea fallback (D22).

/** Colour dots (D29), used in menus, on cards and next to the Highlight button. */
export const SWATCH_CSS = `
  /* Specific enough to win over the general button styles of the display script (toolbar shadow,
     yellow hover) and the browser's own button look: those gave a yellow hover and a 3D offset. */
  button.swatch.swatch { appearance: none; width: 16px; height: 16px; border-radius: 50%; padding: 0; margin: 0; cursor: pointer;
                         flex: none; border: 1px solid var(--sw-border); background: var(--sw-bg); box-shadow: none; }
  button.swatch.swatch:hover { transform: scale(1.15); background: var(--sw-strong); }
  /* The current colour: a crisp ring at an even gap (an outline; the box-shadow ring with a
     fractional width rendered unevenly, like a slightly offset shadow). */
  button.swatch.swatch.current { box-shadow: none; outline: 1.5px solid var(--sw-border); outline-offset: 2px; }
  /* Hovering the current colour: only the stronger colour, the ringed dot keeps its size. */
  button.swatch.swatch.current:hover { transform: none; }
  /* "No colour": a red stroke from corner to corner over the grey dot. */
  button.swatch.swatch.none { background-image: linear-gradient(to top right, transparent calc(50% - 1px), #e03131 calc(50% - 1px),
                              #e03131 calc(50% + 1px), transparent calc(50% + 1px)); }
`;

/** A colour dot button for a palette colour. */
export function swatch(name: string, current: boolean): HTMLButtonElement {
  const colour = COLOURS[name as keyof typeof COLOURS];
  const b = document.createElement("button");
  b.className = current ? "swatch current" : "swatch";
  b.title = colour.label;
  b.setAttribute("aria-label", colour.label);
  b.style.setProperty("--sw-bg", effective(colour));
  // Hover: the same colour, stronger.
  b.style.setProperty("--sw-strong", effective(colour, "#ffffff", Math.min(1, colour.alpha + 0.35)));
  b.style.setProperty("--sw-border", darker(colour));
  b.dataset.colour = name;
  return b;
}

export const EDIT_MENU_CSS = `
  .edit-menu { position: absolute; z-index: 20; display: none; min-width: 140px; padding: 4px 0; margin: 0;
               list-style: none; font: 13px system-ui, sans-serif; color: #222; background: #fff;
               border: 1px solid #c8c8c8; border-radius: 6px; box-shadow: 0 3px 12px #0003; }
  .edit-menu li { padding: 4px 14px; cursor: default; display: flex; justify-content: space-between; gap: 18px; }
  .edit-menu li:hover:not(.disabled) { background: #0b57d0; color: #fff; }
  .edit-menu li.disabled { color: #aaa; }
  .edit-menu li.danger { color: #e03131; }
  .edit-menu li.swatches, .edit-menu li.swatches:hover { background: none; color: inherit; padding: 4px 10px 6px; gap: 6px; justify-content: flex-start; }
  ${SWATCH_CSS}
  .edit-menu li.danger:hover { background: #e03131; color: #fff; }
  .edit-menu li.info, .edit-menu li.info:hover { display: block; background: none; color: inherit; opacity: 0.75; font-size: 12px;
                                                 max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .edit-menu li kbd { font: inherit; color: inherit; opacity: 0.6; }
  .edit-menu hr { border: none; border-top: 1px solid #e3e3e3; margin: 4px 0; }
  @media (prefers-color-scheme: dark) {
    .edit-menu { color: #eee; background: #2f2f2f; border-color: #555; } .edit-menu hr { border-top-color: #444; }
    .edit-menu li.disabled { color: #777; }
  }
`;

export const IS_MAC = /Mac/.test(navigator.platform);
export const MOD = IS_MAC ? "⌘" : "Ctrl+";

/** The modifier that opens a link with a click: Cmd on macOS (Ctrl+click is a right-click there), else Ctrl. */
export function opensLink(e: MouseEvent): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

/** Clipboard access. Message documents aren't a secure context, so `navigator.clipboard`
 * doesn't exist there: the background (with clipboardRead/Write) does the work. */
export interface Clipboard {
  read(): Promise<string>;
  write(text: string): Promise<void>;
}

export interface MenuItem {
  label: string;
  /** Shortcut shown on the right, e.g. "⌘C". */
  kbd?: string;
  enabled?: boolean;
  /** Red, for deleting. */
  danger?: boolean;
  /** A line above this item. */
  separator?: boolean;
  /** Instead of a text entry: a line that only informs, e.g. where a link goes (host in bold). */
  info?: { strong: string; rest: string };
  /** Instead of a text entry: a row of colour dots (D29); with `none`, a last dot for "no colour" (labels, D40). */
  swatches?: { current: string | null; pick(name: string): void; none?(): void };
  run(): void | Promise<void>;
}

/** The colour row for menus. */
export function colourItem(current: string, pick: (name: string) => void): MenuItem {
  return { label: "Colour", swatches: { current, pick }, run() {} };
}

/** A label's colour row (D40): the palette and "no colour"; `current` null = no colour. No title: the dots say it. */
export function labelColourItems(_label: string, current: string | null, pick: (name: string | null) => void): MenuItem[] {
  return [{ label: "Label colour", swatches: { current, pick, none: () => pick(null) }, run() {} }];
}

/** The "no colour" dot: grey, struck through in red (not to be read as the colour grey). */
function noColourSwatch(current: boolean): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = current ? "swatch none current" : "swatch none";
  b.title = "No colour";
  b.setAttribute("aria-label", "No colour");
  b.style.setProperty("--sw-bg", "#e9ecef");
  b.style.setProperty("--sw-strong", "#dee2e6");
  b.style.setProperty("--sw-border", "#868e96");
  return b;
}

/**
 * Opens a menu at the mouse position, inside `container` (positioned relative to it). One menu
 * at a time; it closes on a click elsewhere, Esc or when an item is chosen. Clicking it doesn't
 * take focus away from an editor (leaving the editor would save the note).
 */
export function openMenu(container: HTMLElement, e: MouseEvent, items: MenuItem[], rightLimit = window.innerWidth - 4): void {
  closeMenu();
  listenOnce();
  const menu = document.createElement("ul");
  menu.className = "edit-menu";
  for (const item of items) {
    if (item.separator) menu.append(document.createElement("hr"));
    const li = document.createElement("li");
    if (item.info) {
      li.className = "info";
      li.title = item.label;
      const strong = document.createElement("b");
      strong.textContent = item.info.strong;
      li.append(strong, item.info.rest);
      menu.append(li);
      continue;
    }
    if (item.swatches) {
      const { current, pick, none } = item.swatches;
      li.className = "swatches";
      for (const name of COLOUR_NAMES) {
        const dot = swatch(name, name === current);
        dot.addEventListener("click", (ev) => {
          ev.stopPropagation();
          closeMenu();
          pick(name);
        });
        li.append(dot);
      }
      if (none) {
        const dot = noColourSwatch(current === null);
        dot.addEventListener("click", (ev) => {
          ev.stopPropagation();
          closeMenu();
          none();
        });
        li.append(dot);
      }
      menu.append(li);
      continue;
    }
    li.textContent = item.label;
    if (item.kbd) {
      const kbd = document.createElement("kbd");
      kbd.textContent = item.kbd;
      li.append(kbd);
    }
    li.classList.toggle("disabled", item.enabled === false);
    li.classList.toggle("danger", !!item.danger);
    li.addEventListener("click", () => {
      if (item.enabled === false) return;
      closeMenu();
      Promise.resolve(item.run()).catch((err) => console.error("ThunderNotes: menu", err));
    });
    menu.append(li);
  }
  // Nor reach the document's mousedown listener, which would close the menu before the click lands.
  menu.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });
  container.append(menu);
  // Open towards the inside near the pane's right or bottom edge: an HTML menu can't
  // extend beyond the message pane the way Thunderbird's native menus can.
  menu.style.display = "block";
  const box = container.getBoundingClientRect();
  const { offsetWidth: w, offsetHeight: h } = menu;
  // `rightLimit`: e.g. the note cards' column, which a menu over the email shouldn't cover.
  const x = e.clientX + w > rightLimit ? Math.max(4, e.clientX - w) : e.clientX;
  const y = e.clientY + h > window.innerHeight - 4 ? Math.max(4, e.clientY - h) : e.clientY;
  menu.style.left = `${x - box.left}px`;
  menu.style.top = `${y - box.top}px`;
  open = menu;
}

let open: HTMLElement | null = null;

export function closeMenu(): void {
  open?.remove();
  open = null;
}

let listening = false;

/** Closing on a click elsewhere or Esc; registered with the first menu. */
function listenOnce(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("mousedown", closeMenu);
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && open) {
        closeMenu();
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true
  );
}

/** What the edit menu acts on: a textarea or a CodeMirror editor. */
export interface EditTarget {
  /** Receives the contextmenu event; keeps focus while the menu is used. */
  element: HTMLElement;
  selectedText(): string;
  replaceSelection(text: string): void;
  selectAll(): void;
}

/**
 * The editors' right-click menu: Cut / Copy / Paste / Select All, then `extra` items (e.g.
 * Delete note). Returns a function that detaches it.
 */
export function attachEditMenu(
  target: EditTarget,
  container: HTMLElement,
  clipboard: Clipboard,
  extra: MenuItem[] = [],
  top: (e: MouseEvent) => MenuItem[] = () => [],
  /** Paste a web address as a Markdown link (notes); off: as plain text (e.g. a filter field). */
  linkPaste = true
): () => void {
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault(); // instead of Thunderbird's menu
    e.stopPropagation();
    const selected = target.selectedText();
    const first = top(e);
    openMenu(container, e, [
      ...first,
      {
        label: "Cut",
        separator: first.length > 0,
        kbd: `${MOD}X`,
        enabled: !!selected,
        run: async () => {
          await clipboard.write(selected);
          target.replaceSelection("");
        },
      },
      { label: "Copy", kbd: `${MOD}C`, enabled: !!selected, run: () => clipboard.write(selected) },
      {
        label: "Paste",
        kbd: `${MOD}V`,
        run: async () => {
          const text = await clipboard.read();
          if (text) target.replaceSelection((linkPaste && linkForPaste(text, target.selectedText())) || text);
        },
      },
      { label: "Select All", kbd: `${MOD}A`, separator: true, run: () => target.selectAll() },
      ...extra.map((item, i) => (i === 0 ? { ...item, separator: true } : item)),
    ]);
  };
  target.element.addEventListener("contextmenu", onContextMenu);
  target.element.addEventListener("focusout", closeMenu);
  return () => {
    target.element.removeEventListener("contextmenu", onContextMenu);
    target.element.removeEventListener("focusout", closeMenu);
    closeMenu();
  };
}
