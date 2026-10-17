/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Text normalisation for anchoring (D21). Every view of an email (original HTML,
 * simple HTML, plain text) is reduced to the same kind of text, so selectors made
 * in one view match in another:
 * - whitespace runs (incl. no-break space) and block boundaries become one space;
 * - `>` quote markers at the start of a line are dropped;
 * - soft hyphens and zero-width characters are dropped;
 * - bracketed URLs (`<https://…>`) are dropped, because plain-text views print a
 *   link as `text <url>` where HTML views show only `text`.
 *
 * The builder keeps a map between source positions and text offsets, so a
 * selection can be turned into offsets and offsets back into a selection.
 */

/** Normalised text plus the way back to its source. */
export interface NormalisedText<R> {
  text: string;
  /** Source of each text character. */
  refs: R[];
  /** Offset within its source of each text character. */
  offsets: number[];
  /** Per source: source offset -> text offset (length = source length + 1). */
  maps: Map<R, Int32Array>;
}

const SPACE = /[\s ]/;
const DROP = /[­​‌‍⁠﻿]/;
const BRACKETED_URL = / ?<(?:https?|ftp|mailto):[^\s<>]*>/g;

export class TextBuilder<R> {
  private chars: string[] = [];
  private refs: R[] = [];
  private offsets: number[] = [];
  private maps = new Map<R, Int32Array>();
  private atLineStart = true;
  /** Source position that caused the pending space, if any. */
  private pending: [R, number] | null = null;

  /** A block boundary or line break: acts as whitespace and starts a new line. */
  boundary(ref: R, offset = 0): void {
    this.atLineStart = true;
    this.pending ??= [ref, offset];
  }

  /** Appends one source string (e.g. a DOM text node's data). */
  append(ref: R, data: string): void {
    const map = new Int32Array(data.length + 1);
    for (let i = 0; i < data.length; i++) {
      const c = data[i]!;
      map[i] = this.chars.length;
      if (c === "\n" || c === "\r") {
        this.boundary(ref, i);
      } else if (SPACE.test(c)) {
        this.pending ??= [ref, i];
      } else if (DROP.test(c) || (this.atLineStart && c === ">")) {
        // dropped
      } else {
        if (this.pending && this.chars.length) {
          this.push(" ", this.pending[0], this.pending[1]);
        }
        this.pending = null;
        this.atLineStart = false;
        map[i] = this.chars.length;
        this.push(c, ref, i);
      }
    }
    map[data.length] = this.chars.length;
    this.maps.set(ref, map);
  }

  finish(): NormalisedText<R> {
    const text = this.chars.join("");
    const drop = new Uint8Array(text.length);
    for (const m of text.matchAll(BRACKETED_URL)) {
      drop.fill(1, m.index, m.index + m[0].length);
    }
    if (!drop.includes(1)) {
      return { text, refs: this.refs, offsets: this.offsets, maps: this.maps };
    }
    // Compact: newIndex[i] = number of kept characters before i.
    const newIndex = new Int32Array(text.length + 1);
    const chars: string[] = [];
    const refs: R[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < text.length; i++) {
      newIndex[i] = chars.length;
      if (!drop[i]) {
        chars.push(text[i]!);
        refs.push(this.refs[i]!);
        offsets.push(this.offsets[i]!);
      }
    }
    newIndex[text.length] = chars.length;
    const maps = new Map<R, Int32Array>();
    for (const [ref, map] of this.maps) {
      maps.set(ref, map.map((i) => newIndex[i]!));
    }
    return { text: chars.join(""), refs, offsets, maps };
  }

  private push(c: string, ref: R, offset: number): void {
    this.chars.push(c);
    this.refs.push(ref);
    this.offsets.push(offset);
  }
}

/** Normalises a plain string (e.g. a text/plain body). */
export function normaliseText(source: string): NormalisedText<number> {
  const builder = new TextBuilder<number>();
  builder.append(0, source);
  return builder.finish();
}
