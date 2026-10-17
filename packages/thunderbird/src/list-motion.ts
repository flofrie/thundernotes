/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The task view's rows and headings move to their new places when the list is drawn anew
// (another grouping or order, a task ticked, labels reordered) instead of jumping: each keyed
// element is measured before and after and slides from where it was ("FLIP"); new ones fade in.
// A redraw during a slide (the next letter typed in the filter) measures the rows where they
// appear at that moment, so the new slide starts there: no waiting, no jump. Only what is on
// screen moves; nothing does with "reduce motion" or the setting off. Kept in this module and
// one call in tasks.ts, so it can be taken out again as a whole.

const DURATION = 220;

/** Where each keyed element (data-key) is on screen now. */
export function measure(root: HTMLElement): Map<string, DOMRect> {
  const out = new Map<string, DOMRect>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-key]")) out.set(el.dataset.key!, el.getBoundingClientRect());
  return out;
}

/** After drawing anew: elements slide from where they were (`before`), new ones fade in. */
export function animateFrom(root: HTMLElement, before: Map<string, DOMRect>): void {
  if (!before.size || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  const height = window.innerHeight;
  const onScreen = (r: DOMRect) => r.bottom > -50 && r.top < height + 50;
  for (const el of root.querySelectorAll<HTMLElement>("[data-key]")) {
    const now = el.getBoundingClientRect();
    const was = before.get(el.dataset.key!);
    if (!onScreen(now) && !(was && onScreen(was))) continue; // off screen before and after: nothing to see
    if (!was) {
      el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: "ease-out" });
      continue;
    }
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate?.([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
      duration: DURATION,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  }
}
