/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Visible text of a rendered email body (D21), using standard DOM APIs only, so
 * it works in Thunderbird's message display script and in any other web view.
 */

import { TextBuilder, type NormalisedText } from "./normalise.js";

// DOM constants as numbers: no dependency on globals such as NodeFilter.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SHOW_ELEMENT = 0x1;
const SHOW_TEXT = 0x4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE"]);
const BLOCK_SELECTOR =
  "p,div,li,ul,ol,dl,dt,dd,tr,td,th,table,thead,tbody,tfoot,caption,blockquote,pre," +
  "h1,h2,h3,h4,h5,h6,section,article,aside,nav,header,footer,main,center,address,figure,figcaption,body";

export interface ExtractOptions {
  /** Whether an element is rendered. Defaults to `checkVisibility()` or computed styles. */
  isVisible?: (el: Element) => boolean;
  /** Elements to leave out entirely (e.g. the add-on's own UI). */
  exclude?: (el: Element) => boolean;
}

export interface ExtractedText extends NormalisedText<Node> {
  /** Characters of text skipped because they are not visible. */
  hiddenChars: number;
}

function defaultIsVisible(el: Element): boolean {
  const check = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  if (typeof check === "function" && !check.call(el, { checkOpacity: true, checkVisibilityCSS: true })) {
    return false;
  }
  // Also check computed styles: environments without layout (e.g. jsdom) report everything as visible.
  const view = el.ownerDocument.defaultView;
  if (!view) return true;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const style = view.getComputedStyle(e);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

/** Extracts the normalised visible text under `root`. */
export function extractText(root: Element, options: ExtractOptions = {}): ExtractedText {
  const isVisible = options.isVisible ?? defaultIsVisible;
  const exclude = options.exclude;
  const visibility = new Map<Element, boolean>();
  const visible = (el: Element) => {
    let v = visibility.get(el);
    if (v === undefined) visibility.set(el, (v = isVisible(el)));
    return v;
  };

  const builder = new TextBuilder<Node>();
  let hiddenChars = 0;
  let lastBlock: Element | null = null;

  const walker = root.ownerDocument.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, {
    acceptNode(n: Node) {
      if (n.nodeType === ELEMENT_NODE && (SKIP_TAGS.has((n as Element).tagName) || exclude?.(n as Element))) {
        return FILTER_REJECT;
      }
      return FILTER_ACCEPT;
    },
  });

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === ELEMENT_NODE) {
      const tag = (n as Element).tagName;
      if (tag === "BR" || tag === "HR") builder.boundary(n);
      continue;
    }
    const parent = n.parentElement;
    const data = (n as Text).data;
    if (!parent || !visible(parent)) {
      hiddenChars += data.trim().length;
      continue;
    }
    const block = parent.closest(BLOCK_SELECTOR);
    if (block !== lastBlock) {
      builder.boundary(n);
      lastBlock = block;
    }
    builder.append(n, data);
  }

  return { ...builder.finish(), hiddenChars };
}

/**
 * DOM point -> text offset. `side` matters when the point sits between elements,
 * e.g. a triple-click selection that ends at the start of the next block:
 * a start point maps to the next text, an end point to the end of the previous text.
 */
export function pointToOffset(
  extracted: NormalisedText<Node>,
  container: Node,
  offset: number,
  side: "start" | "end" = "start"
): number {
  const map = container.nodeType === TEXT_NODE ? extracted.maps.get(container) : undefined;
  if (map) return map[offset]!;
  const point = container.ownerDocument!.createRange();
  point.setStart(container, offset);
  if (side === "start") {
    for (const [node, nodeMap] of extracted.maps) {
      if (point.comparePoint(node, 0) >= 0) return nodeMap[0]!;
    }
    return extracted.text.length;
  }
  let result = 0;
  for (const [node, nodeMap] of extracted.maps) {
    if (point.comparePoint(node, nodeMap.length - 1) > 0) break;
    result = nodeMap[nodeMap.length - 1]!;
  }
  return result;
}

/** Shrinks [start, end) so it neither starts nor ends on a space. */
export function trimOffsets(text: string, start: number, end: number): { start: number; end: number } {
  while (start < end && text[start] === " ") start++;
  while (end > start && text[end - 1] === " ") end--;
  return { start, end };
}

/** A DOM selection range -> trimmed text offsets. */
export function rangeToOffsets(extracted: NormalisedText<Node>, range: AbstractRange): { start: number; end: number } {
  const start = pointToOffset(extracted, range.startContainer, range.startOffset, "start");
  const end = pointToOffset(extracted, range.endContainer, range.endOffset, "end");
  return end > start ? trimOffsets(extracted.text, start, end) : { start, end: start };
}

/**
 * Text offsets [start, end) -> DOM Range. Edge spaces are left out: a space made
 * from a block boundary points at the first character of the next block.
 */
export function offsetsToRange(extracted: NormalisedText<Node>, start: number, end: number): Range {
  ({ start, end } = trimOffsets(extracted.text, start, end));
  const first = extracted.refs[start]!;
  const range = first.ownerDocument!.createRange();
  if (first.nodeType === TEXT_NODE) range.setStart(first, extracted.offsets[start]!);
  else range.setStartBefore(first);
  if (end <= start) return range;
  const last = extracted.refs[end - 1]!;
  if (last.nodeType === TEXT_NODE) range.setEnd(last, extracted.offsets[end - 1]! + 1);
  else range.setEndAfter(last); // a <br>/<hr> boundary
  return range;
}
