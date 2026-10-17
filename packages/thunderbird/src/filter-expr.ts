/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The task view's filter as an expression (D38), as in Gmail or Google: terms separated by
// spaces must all match (AND, the default; a written "and" is accepted and ignored), "or" (in
// any case; written out in capitals; the word itself in quotes: "or") binds more tightly than the space, brackets group,
// a minus excludes a term or a group, "phrases in quotes" are one term, /a regex/ between slashes
// is one term too (case ignored; while it isn't valid it counts as nothing). Incomplete input (while
// typing) is read leniently: open brackets and quotes close at the end, a dangling OR, a stray
// ")" and empty brackets count as nothing. `normaliseFilter` writes it out as understood.

export type FilterNode =
  | { kind: "term"; text: string; quoted: boolean; not: boolean }
  /** `pattern` null: not a valid regex (yet), counts as nothing. */
  | { kind: "regex"; source: string; pattern: RegExp | null; not: boolean }
  | { kind: "and"; items: FilterNode[]; not: boolean }
  | { kind: "or"; items: FilterNode[]; not: boolean };

type Token =
  | { t: "open"; not: boolean }
  | { t: "close" }
  | { t: "or" }
  | { t: "and" }
  | { t: "term"; text: string; quoted: boolean; not: boolean }
  | { t: "regex"; source: string; not: boolean };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /(-?)\/((?:\\.|[^/\\])*)\/?|(-?)\(|\)|(-?)["“”„]([^"“”„]*)["“”„]?|(-?)([^\s()"“”„]+)/g;
  for (const m of text.matchAll(re)) {
    const s = m[0];
    // A term starting with "/" (or "-/"): a regex up to the next unescaped "/" (or the end).
    if (m[2] !== undefined) {
      if (m[2]) out.push({ t: "regex", source: m[2], not: m[1] === "-" });
      continue;
    }
    if (s.endsWith("(")) out.push({ t: "open", not: m[3] === "-" });
    else if (s === ")") out.push({ t: "close" });
    else if (m[5] !== undefined) {
      const phrase = m[5].trim();
      if (phrase) out.push({ t: "term", text: phrase, quoted: true, not: m[4] === "-" });
    } else {
      const word = m[7]!;
      if (!m[6] && word.toLowerCase() === "or") out.push({ t: "or" });
      else if (!m[6] && word.toLowerCase() === "and") out.push({ t: "and" });
      else if (word !== "-") out.push({ t: "term", text: word, quoted: false, not: m[6] === "-" });
    }
  }
  return out;
}

/** The expression, or null when there is nothing to filter by. */
export function parseFilter(text: string): FilterNode | null {
  const tokens = tokenize(text);
  let i = 0;
  // and := (or-expression)+, up to ")" or the end
  const parseAnd = (inGroup: boolean): FilterNode[] => {
    const items: FilterNode[] = [];
    while (i < tokens.length) {
      const tok = tokens[i]!;
      if (tok.t === "close") {
        if (inGroup) return items;
        i++; // a stray ")": nothing
        continue;
      }
      if (tok.t === "and" || tok.t === "or") {
        i++; // AND is the default; an OR without a left side: nothing
        continue;
      }
      const first = parseUnary();
      if (!first) continue;
      const alternatives = [first];
      while (tokens[i]?.t === "or") {
        i++;
        while (tokens[i]?.t === "or" || tokens[i]?.t === "and") i++; // "OR OR", "OR AND"
        if (i >= tokens.length || tokens[i]!.t === "close") break; // a dangling OR: nothing
        const next = parseUnary();
        if (next) alternatives.push(next);
      }
      items.push(alternatives.length > 1 ? { kind: "or", items: alternatives, not: false } : first);
    }
    return items;
  };
  const parseUnary = (): FilterNode | null => {
    const tok = tokens[i++]!;
    if (tok.t === "term") return { kind: "term", text: tok.text, quoted: tok.quoted, not: tok.not };
    if (tok.t === "regex") {
      let pattern: RegExp | null = null;
      try {
        pattern = new RegExp(tok.source, "i");
      } catch {
        // not valid (yet): counts as nothing, the pill says so
      }
      return { kind: "regex", source: tok.source, pattern, not: tok.not };
    }
    if (tok.t === "open") {
      const items = parseAnd(true);
      if (tokens[i]?.t === "close") i++; // missing ")": closed at the end
      const inner = simplify({ kind: "and", items, not: false });
      if (!inner) return null; // empty brackets
      return tok.not ? { ...inner, not: !inner.not } : inner;
    }
    return null;
  };
  return simplify({ kind: "and", items: parseAnd(false), not: false });
}

/** One item in a group stands for itself; empty groups are nothing. */
function simplify(node: FilterNode): FilterNode | null {
  if (node.kind === "term" || node.kind === "regex") return node;
  const items = node.items.map(simplify).filter((n): n is FilterNode => !!n);
  if (!items.length) return null;
  if (items.length === 1) return node.not ? { ...items[0]!, not: !items[0]!.not } : items[0]!;
  return { ...node, items };
}

/** Whether the text (lower case) matches. */
export function matchesFilter(node: FilterNode | null, haystack: string): boolean {
  if (!node) return true;
  if (node.kind === "regex" && !node.pattern) return true; // not valid: nothing
  const hit =
    node.kind === "regex"
      ? node.pattern!.test(haystack)
      : node.kind === "term"
      ? haystack.includes(node.text.toLowerCase())
      : node.kind === "and"
        ? node.items.every((n) => matchesFilter(n, haystack))
        : node.items.some((n) => matchesFilter(n, haystack));
  return node.not ? !hit : hit;
}

/**
 * The filter written out as it is understood: brackets and quotes closed, a dangling OR, stray
 * ")" and AND left out, brackets around an OR among other terms (to show what belongs together),
 * none where they change nothing. The terms as typed, in their order.
 */
export function normaliseFilter(text: string): string {
  const node = parseFilter(text);
  if (!node) return "";
  return write(node, true);
}

function write(node: FilterNode, top: boolean): string {
  const minus = node.not ? "-" : "";
  if (node.kind === "regex") return `${minus}/${node.source}/`;
  if (node.kind === "term") {
    const plain = !node.quoted && !/[\s()"“”„]/.test(node.text);
    return `${minus}${plain ? node.text : `"${node.text}"`}`;
  }
  if (node.kind === "or") {
    const inner = node.items.map((n) => write(n, false)).join(" OR ");
    return top && !node.not ? inner : `${minus}(${inner})`;
  }
  // An AND inside an OR, or negated, needs brackets; at the top it is the plain list.
  const inner = node.items.map((n) => write(n, false)).join(" ");
  return top && !node.not ? inner : `${minus}(${inner})`;
}

/** Whether the filter holds a regex that isn't valid (the pill turns red until it is). */
export function hasInvalidRegex(text: string): boolean {
  const check = (n: FilterNode | null): boolean =>
    !!n && (n.kind === "regex" ? !n.pattern : n.kind === "term" ? false : n.items.some(check));
  return check(parseFilter(text));
}

/**
 * What to mark in a shown task: the terms and regexes that must (or may, in an OR) be there, not
 * those excluded (under an odd number of minuses).
 */
export function highlightTerms(text: string): { words: string[]; patterns: RegExp[] } {
  const words: string[] = [];
  const patterns: RegExp[] = [];
  const walk = (n: FilterNode | null, negated: boolean) => {
    if (!n) return;
    const not = negated !== n.not;
    if (n.kind === "term") {
      if (!not) words.push(n.text.toLowerCase());
    } else if (n.kind === "regex") {
      if (!not && n.pattern) patterns.push(new RegExp(n.pattern.source, "gi"));
    } else for (const item of n.items) walk(item, not);
  };
  walk(parseFilter(text), false);
  return { words, patterns };
}
