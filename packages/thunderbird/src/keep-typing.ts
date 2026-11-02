/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Keys typed in ThunderNotes' fields stay there (public issue #8). Our UI is in a closed Shadow DOM, so
// from outside a key seems to come from a plain <div>: add-ons that catch single keys in the
// Thunderbird window (tbkeys, which leaves text fields alone) then take it for a shortcut and
// swallow it. Stopped at the shadow root, those keys never reach the window.

const KEY_EVENTS = ["keydown", "keypress", "keyup"] as const;

/** Whether `target` takes typing: a text field, a list, or editable text (the note editor). */
export function takesTyping(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el?.closest) return false;
  if (el.closest("textarea, select")) return true;
  const input = el.closest("input");
  if (input) return !["button", "checkbox", "radio", "submit", "reset", "image", "color", "file", "range"].includes((input as HTMLInputElement).type);
  const editable = el.closest("[contenteditable]");
  return !!editable && editable.getAttribute("contenteditable")?.toLowerCase() !== "false";
}

/** Keeps key events from text fields and editable text inside `root` from going further up. */
export function keepTypingInside(root: ShadowRoot | Element): void {
  for (const type of KEY_EVENTS) {
    root.addEventListener(type, (e) => {
      if (takesTyping(e.composedPath()[0] ?? e.target)) e.stopPropagation();
    });
  }
}
