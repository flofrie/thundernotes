/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The settings page's right-click menu (D47): none at all, except "Copy" while text is selected
// (to copy a setting's name or explanation). Thunderbird's browser menu (Back, Reload, Select
// All …) has nothing for this page. Text fields keep their usual menu (paste, undo).

const MENU_CSS = `
  .copy-menu { position: fixed; z-index: 1000; min-width: 120px; padding: 4px; margin: 0; list-style: none;
               background: var(--card, #fff); color: var(--fg, #1f2328); border: 1px solid var(--line, #d8dee4);
               border-radius: 8px; box-shadow: 0 4px 16px #0003; font: 13px system-ui, sans-serif; }
  .copy-menu button { display: flex; justify-content: space-between; gap: 24px; width: 100%; padding: 4px 10px;
                      border: 0; border-radius: 5px; background: none; color: inherit; font: inherit; text-align: left; cursor: default; }
  .copy-menu button:hover, .copy-menu button:focus-visible { background: var(--accent, #0b57d0); color: #fff; outline: none; }
  .copy-menu kbd { border: 0; background: none; padding: 0; color: inherit; opacity: 0.7; font: inherit; }
`;

/** Where the user's own menus belong: text fields and editable text. */
function editable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.("input, textarea, [contenteditable=''], [contenteditable='true']");
}

/**
 * Takes over right-clicks on `doc`: in text fields Thunderbird's menu as usual; with text selected
 * a menu with "Copy" (written with `write`); else no menu. Returns a function that removes it.
 */
export function installCopyMenu(doc: Document, write: (text: string) => Promise<void> | void): () => void {
  const style = doc.createElement("style");
  style.textContent = MENU_CSS;
  doc.head.append(style);
  let menu: HTMLElement | null = null;
  const close = () => {
    menu?.remove();
    menu = null;
  };
  const isMac = /Mac/.test(doc.defaultView?.navigator.platform ?? "");

  const onContextMenu = (e: MouseEvent) => {
    if (editable(e.target)) return close();
    e.preventDefault();
    close();
    const text = doc.getSelection()?.toString() ?? "";
    if (!text.trim()) return;
    menu = doc.createElement("div");
    menu.className = "copy-menu";
    menu.setAttribute("role", "menu");
    const copy = doc.createElement("button");
    copy.type = "button";
    copy.setAttribute("role", "menuitem");
    copy.innerHTML = `<span>Copy</span><kbd>${isMac ? "⌘C" : "Ctrl+C"}</kbd>`;
    copy.addEventListener("click", () => {
      void write(text);
      close();
    });
    menu.append(copy);
    doc.body.append(menu);
    // At the pointer, kept inside the window.
    const view = doc.defaultView!;
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(e.clientX, view.innerWidth - box.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(e.clientY, view.innerHeight - box.height - 4))}px`;
    copy.focus({ preventScroll: true });
  };
  // Clicking elsewhere, Esc, scrolling or leaving the window closes it.
  const onDown = (e: Event) => {
    if (menu && !menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  doc.addEventListener("contextmenu", onContextMenu);
  doc.addEventListener("mousedown", onDown, true);
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("scroll", close, true);
  doc.defaultView?.addEventListener("blur", close);
  return () => {
    close();
    style.remove();
    doc.removeEventListener("contextmenu", onContextMenu);
    doc.removeEventListener("mousedown", onDown, true);
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("scroll", close, true);
    doc.defaultView?.removeEventListener("blur", close);
  };
}
