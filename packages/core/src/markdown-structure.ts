/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Markdown syntax and source positions shared by rendering and note analysis. No DOM or host APIs. */
import MarkdownItFactory, { type Env, type MarkdownIt, type Token } from "markdown-it";

/** Every consumer uses the renderer's supported Markdown dialect. */
export function createMarkdownParser(): MarkdownIt {
  return MarkdownItFactory("zero", { breaks: true, linkify: true }).enable([
    "heading", "hr", "emphasis", "strikethrough", "list", "link", "linkify", "autolink",
    "backticks", "fence", "code", "blockquote", "newline", "escape",
  ]);
}

let parser: MarkdownIt | undefined;
const syntax = () => (parser ??= createMarkdownParser());

/** Code ranges come from the parser, including quote/list containers and indented blocks. */
export function codeLines(source: string): Set<number> {
  const lines = new Set<number>();
  for (const token of syntax().parse(source, {})) {
    if ((token.type === "fence" || token.type === "code_block") && token.map) {
      for (let i = token.map[0]; i < token.map[1]; i++) lines.add(i);
    }
  }
  return lines;
}

/** Whitespace that keeps an empty visual paragraph in its enclosing quote/list containers. */
function paragraphPrefix(lines: string[], at: number, tokens: Token[]): string {
  const quoteDepth = tokens.filter((token) => token.type === "blockquote_open" && token.map && token.map[0] <= at && at < token.map[1]).length;
  const quote = "> ".repeat(quoteDepth);
  const item = tokens
    .filter((token) => token.type === "list_item_open" && token.map && token.map[0] <= at && at < token.map[1])
    .sort((a, b) => b.level - a.level)[0];
  if (!item?.map) return quote;
  const line = lines[item.map[0]] ?? "";
  const afterQuote = line.replace(/^(?: {0,3}>[ \t]?)+/, "");
  const marker = /^( *)(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(afterQuote);
  if (!marker) return quote;
  // Keep the paragraph at the item's content column, without repeating the list marker.
  return quote + " ".repeat(marker[1]!.length + marker[0].length);
}

export interface MarkdownEnvironment extends Env {
  /** Prepared line -> original source line. */
  lineOf: number[];
  /** Ordered sublists may start at a number other than 1. Keyed by prepared line. */
  starts: Record<number, number>;
}

/**
 * Keep the existing line-for-line note layout. Record positions while inserting blank-line
 * paragraphs, so rendered controls always refer to the original Markdown, never the prepared text.
 */
export function prepareMarkdown(source: string): {
  text: string;
  env: MarkdownEnvironment;
  code: Set<number>;
  taskLines: Set<number>;
} {
  const sourceTokens = syntax().parse(source, {});
  const code = new Set<number>();
  for (const token of sourceTokens) {
    if ((token.type === "fence" || token.type === "code_block") && token.map) {
      for (let i = token.map[0]; i < token.map[1]; i++) code.add(i);
    }
  }
  const sourceLines = source.split("\n");
  const lines: string[] = [];
  const preparedCode = new Set<number>();
  const env: MarkdownEnvironment = { lineOf: [], starts: {} };
  for (const [i, line] of sourceLines.entries()) {
    const preparedLine = lines.length;
    if (!code.has(i) && !line.trim()) {
      lines.push("", `${paragraphPrefix(sourceLines, i, sourceTokens)}\u00a0`, "");
      env.lineOf.push(i, i, i);
    } else {
      lines.push(line);
      env.lineOf.push(i);
      if (code.has(i)) preparedCode.add(preparedLine);
    }
  }
  // The supported dialect allows a numbered sublist to start at any number. Normalize its
  // first marker for parsing, then let rendering restore the displayed start attribute.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = preparedCode.has(i) ? null : /^(\s*)(\d{1,9})([.)])(?=\s|$)/.exec(line);
    if (!m || Number(m[2]) === 1) continue;
    for (let k = i - 1; k >= 0 && lines[k]!.trim(); k--) {
      const item = /^(\s*)(?:[-*+]|\d{1,9}[.)])(?=\s|$)/.exec(lines[k]!);
      if (!item) continue;
      if (item[1]!.length < m[1]!.length) {
        env.starts[i] = Number(m[2]);
        lines[i] = `${m[1]}1${line.slice(m[1]!.length + m[2]!.length)}`;
      }
      break;
    }
  }
  const text = lines.join("\n");
  const tokens = syntax().parse(text, env);
  const preparedCodeLines = new Set<number>();
  for (const token of tokens) {
    if ((token.type === "fence" || token.type === "code_block") && token.map) {
      for (let i = token.map[0]; i < token.map[1]; i++) preparedCodeLines.add(env.lineOf[i]!);
    }
  }
  const taskLines = new Set<number>();
  for (const { item } of checklistTokens(tokens)) {
    if (item.map) taskLines.add(env.lineOf[item.map[0]]!);
  }
  return { text, env, code: preparedCodeLines, taskLines };
}

/** Exactly the list items drawn as checkboxes; shared by extraction and the renderer plugin. */
export function* checklistTokens(tokens: Token[]): Generator<{ item: Token; inline: Token; mark: string; prefixLength: number }> {
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]!;
    if (inline.type !== "inline" || tokens[i - 1]!.type !== "paragraph_open" || tokens[i - 2]!.type !== "list_item_open") continue;
    const match = /^\[([ xX])\](?:[  \n]|$)/.exec(inline.content);
    if (!match || inline.children?.[0]?.type !== "text") continue;
    yield { item: tokens[i - 2]!, inline, mark: match[1]!, prefixLength: match[0].length };
  }
}

export function taskSourceLines(source: string): Set<number> {
  return prepareMarkdown(source).taskLines;
}
