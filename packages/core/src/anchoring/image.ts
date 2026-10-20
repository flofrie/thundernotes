/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Highlights and notes on pictures (D46), with standard DOM APIs only (like dom.ts). A picture is
 * found by its address, else by its place among the pictures and the text around it.
 */

import type { Annotation, ImageSelector, TextQuoteSelector } from "../index.js";
import type { NormalisedText } from "./normalise.js";
import { pointToOffset } from "./dom.js";
import { CONTEXT_LENGTH, type AnchorResult } from "./match.js";

/** The longest address kept: tracking addresses can be very long, and the start tells them apart. */
const SRC_MAX = 300;

/** FNV-1a, 32 bit (as format.ts's hash8, without importing the file format here). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * A picture's address as stored, the same on every computer. A picture attached to the email
 * (`cid:`) is shown from an address naming the folder and the message on this computer
 * (`mailbox:…`, `imap:…`); only its MIME part is the same everywhere. Embedded data is hashed.
 */
export function imageKey(src: string): string {
  const part = /^[a-z-]+:[^?#]*\?(?:[^#]*&)?part=([0-9.]+)/i.exec(src);
  if (part && !/^https?:/i.test(src)) return `part:${part[1]}`;
  if (/^data:/i.test(src)) return `data:${hash(src)}`;
  return src.slice(0, SRC_MAX);
}

/** The pictures under `root`, in document order. */
export function imagesIn(root: Element): Element[] {
  return [...root.getElementsByTagName("img")];
}

/** Where a picture sits in the text: the offset of the text after it. */
export function imageOffset(extracted: NormalisedText<Node>, img: Element): number {
  const parent = img.parentNode!;
  return pointToOffset(extracted, parent, Array.prototype.indexOf.call(parent.childNodes, img), "start");
}

function context(extracted: NormalisedText<Node>, img: Element): { offset: number; prefix: string; suffix: string } {
  const offset = imageOffset(extracted, img);
  const text = extracted.text;
  return { offset, prefix: text.slice(Math.max(0, offset - CONTEXT_LENGTH), offset), suffix: text.slice(offset, offset + CONTEXT_LENGTH) };
}

/** The selector for a picture in the email under `root`. */
export function describeImage(root: Element, extracted: NormalisedText<Node>, img: Element): ImageSelector {
  const { prefix, suffix } = context(extracted, img);
  const alt = img.getAttribute("alt")?.replace(/\s+/g, " ").trim();
  return {
    type: "ImageSelector",
    src: imageKey(img.getAttribute("src") ?? ""),
    index: imagesIn(root).indexOf(img),
    ...(alt && { alt }),
    ...(prefix && { prefix }),
    ...(suffix && { suffix }),
  };
}

/**
 * Finds a picture: the only one with its address; among several with its address, the one with
 * the text around it (on a tie, the one nearest its place);
 * else, its address changed, the only picture with the same text on both sides. None: orphan.
 * `start` and `end` are its place in the text (for the reading order).
 */
export function anchorImage(
  root: Element,
  extracted: NormalisedText<Node>,
  selector: ImageSelector
): { element: Element | null; result: AnchorResult } {
  const images = imagesIn(root);
  const contexts = new Map<Element, ReturnType<typeof context>>();
  const ctx = (img: Element) => {
    let c = contexts.get(img);
    if (!c) contexts.set(img, (c = context(extracted, img)));
    return c;
  };
  const score = (img: Element) => Number(ctx(img).prefix === (selector.prefix ?? "")) + Number(ctx(img).suffix === (selector.suffix ?? ""));
  const found = (element: Element, method: "position" | "quote" | "context", candidates?: number) => {
    const { offset } = ctx(element);
    return { element, result: { status: "anchored" as const, method, start: offset, end: offset, ...(candidates !== undefined && { candidates }) } };
  };
  const same = images.filter((img) => imageKey(img.getAttribute("src") ?? "") === selector.src);
  const atPlace = images[selector.index];
  if (same.length === 1) return found(same[0]!, same[0] === atPlace ? "position" : "quote");
  if (same.length > 1) {
    // The same picture several times (a spacer, a logo): the text around it decides, then the place.
    const distance = (img: Element) => Math.abs(images.indexOf(img) - selector.index);
    const best = [...same].sort((a, b) => score(b) - score(a) || distance(a) - distance(b))[0]!;
    return best === atPlace ? found(best, "position") : found(best, "context", same.length);
  }
  const both = images.filter((img) => score(img) === 2);
  if (both.length === 1 && (selector.prefix || selector.suffix)) return found(both[0]!, "context", 1);
  return { element: null, result: { status: "orphan" } };
}

/** A note's passage for display: the quoted text, "🖼 …" for a picture; undefined for the whole-email note. */
export function quoteLabel(a: Pick<Annotation, "selectors">): string | undefined {
  for (const s of a.selectors) {
    if (s.type === "TextQuoteSelector") return (s as TextQuoteSelector).exact;
    if (s.type === "ImageSelector") return `🖼 ${(s as ImageSelector).alt || "Picture"}`;
  }
  return undefined;
}

/** The picture selector of a note on a picture. */
export function imageSelectorOf(a: Pick<Annotation, "selectors">): ImageSelector | undefined {
  return a.selectors.find((s): s is ImageSelector => s.type === "ImageSelector");
}
