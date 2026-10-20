/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Where the email's content ends on the right (D23, 0.76.1): the notes may use the empty space
// beside it. Content is what carries information: visible text, pictures and other media, form
// fields, and elements with a background image (banners are often drawn that way). A plain
// background colour isn't: newsletters fill the whole width with one around a centred column.
// When unsure, an element counts: a wrong guess only narrows the email as before.

/** Elements whose own box is content (tag names, upper case). */
const MEDIA = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "IFRAME", "OBJECT", "EMBED", "INPUT", "SELECT", "TEXTAREA", "BUTTON", "METER", "PROGRESS"]);
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE"]);

/** Whether an element is drawn at all (for environments without checkVisibility: computed styles). */
function shown(el: Element, style: CSSStyleDeclaration): boolean {
  const check = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  if (typeof check === "function") return check.call(el, { checkOpacity: true, checkVisibilityCSS: true });
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

/**
 * The rightmost edge of the content under `root`, in viewport coordinates; -Infinity if there is
 * none. Boxes without size don't count.
 */
export function contentRight(root: Element): number {
  const view = root.ownerDocument.defaultView;
  if (!view) return Infinity;
  const range = root.ownerDocument.createRange();
  let right = -Infinity;
  const take = (r: DOMRect | DOMRectReadOnly) => {
    if (r.width > 0 && r.height > 0 && r.right > right) right = r.right;
  };
  const visit = (el: Element) => {
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    const style = view.getComputedStyle(el);
    if (!shown(el, style)) return;
    if (MEDIA.has(tag)) return take(el.getBoundingClientRect());
    if (style.backgroundImage && style.backgroundImage !== "none") take(el.getBoundingClientRect());
    for (const child of el.childNodes) {
      if (child.nodeType === 1) visit(child as Element);
      else if (child.nodeType === 3 && (child as Text).data.trim()) {
        range.selectNodeContents(child);
        for (const r of range.getClientRects()) take(r);
      }
    }
  };
  visit(root);
  return right;
}
