/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/index.js";

describe("renderMarkdown", () => {
  it("renders the supported subset", () => {
    const html = renderMarkdown("# Title\n\n**bold** and _italic_, `code`\n\n- one\n- two\n\n1. first\n\n> quoted\n\n---");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(renderMarkdown("~~gone~~")).toContain("<s>gone</s>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr>");
  });

  it("keeps single line breaks", () => {
    expect(renderMarkdown("line one\nline two")).toContain("line one<br>");
  });

  it("links Markdown links and bare URLs", () => {
    expect(renderMarkdown("[site](https://example.com/a)")).toContain('<a href="https://example.com/a">site</a>');
    expect(renderMarkdown("see https://example.com/b now")).toContain('<a href="https://example.com/b">https://example.com/b</a>');
    expect(renderMarkdown("<mailto:a@example.com>")).toContain('href="mailto:a@example.com"');
  });

  it("drops unsafe links and raw HTML", () => {
    const html = renderMarkdown('[x](javascript:alert(1)) <img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
  });

  it("renders tasks as drawn boxes", () => {
    const html = renderMarkdown("- [ ] open\n- [x] done\n- plain");
    expect(html).toContain('<li class="task"><span class="task-box tn-box" data-line="0"></span>open</li>');
    expect(html).toContain('<li class="task task-done"><span class="task-box tn-box tn-box-done" data-line="1"></span>done</li>');
    expect(html).toContain("<li>plain</li>");
  });

  it("keeps every empty line as one empty line", () => {
    // DOMPurify writes the no-break space as &nbsp;.
    const empty = (html: string) => (html.match(/<p>(?:&nbsp;|\u00a0)<\/p>/g) ?? []).length;
    expect(empty(renderMarkdown("a\nb"))).toBe(0);
    expect(empty(renderMarkdown("a\n\nb"))).toBe(1);
    expect(empty(renderMarkdown("a\n\n\nb"))).toBe(2);
    expect(renderMarkdown("a\n\n\nb")).toMatch(/<p>a<\/p>\s*(<p>(?:&nbsp;|\u00a0)<\/p>\s*){2}<p>b<\/p>/);
  });

  it("leaves empty lines in code blocks alone", () => {
    const html = renderMarkdown("```\nx\n\n\ny\n```");
    expect(html).toContain("x\n\n\ny");
    expect(html).not.toMatch(/&nbsp;|\u00a0/);
  });

  // Editor and note view must agree: no underlined (setext) headings, "---" under text is a rule.
  it("renders --- under a line of text as a rule, not a heading", () => {
    expect(renderMarkdown("above\n---\nbelow")).toMatch(/<p>above<\/p>\s*<hr>/);
  });

  it("marks fenced code (padded box) apart from indented code", () => {
    expect(renderMarkdown("```\nx\n```")).toContain('<pre class="fenced"><code>');
    expect(renderMarkdown("    code")).toMatch(/<pre><code>code/);
  });

  it("marks conflict boxes (D32)", () => {
    const html = renderMarkdown("> [!conflict] Changed on two devices — keep one\n> **A · 2026-10-17 09:14 UTC**\n> x");
    expect(html).toContain('<blockquote class="tn-conflict">');
    expect(html).not.toContain("[!conflict]");
  });

  it("lets a numbered list right under an item start at any number (D28)", () => {
    const html = renderMarkdown("1. some text\n   1. sub 1\n   2. sub 2\n2. other\n   3. sub 3\n   4. sub 4");
    expect(html).toMatch(/<li>other\s*<ol start="3">\s*<li>sub 3<\/li>\s*<li>sub 4<\/li>/);
    expect(renderMarkdown("- bullet\n  5. five")).toContain('<ol start="5">');
    expect(renderMarkdown("The number is\n14. The doors")).not.toContain("<ol");
  });

  it("shows when a task was finished as a small 'done' date (D38)", () => {
    expect(renderMarkdown("- [x] call ✅ 2026-01-05")).toMatch(/<span class="tn-done-date" title="Done on [^"]+">done \w+ 5 Jan( 2026)?<\/span>/);
  });

  it("shows impossible dates as text marked 'Not a valid date' (D38)", () => {
    const html = renderMarkdown("- [ ] call @2026-13-45\n- [x] done ✅ 2026-02-30");
    expect(html).toContain('<span class="tn-loose-date" title="Not a valid date">@2026-13-45</span>');
    expect(html).toContain('<span class="tn-loose-date" title="Not a valid date">✅ 2026-02-30</span>');
    expect(html).not.toContain("tn-date");
    expect(html).not.toContain("tn-done-date");
  });

  it("links www. addresses as the editor does, not bare domains (one rule everywhere)", () => {
    expect(renderMarkdown("see www.example.com/a?b=1, then")).toContain('<a href="https://www.example.com/a?b=1">www.example.com/a?b=1</a>, then');
    expect(renderMarkdown("see example.com or file.txt")).not.toContain("<a ");
    expect(renderMarkdown("[x](https://www.a.example) and `www.b.example`")).not.toContain("https://www.b.example");
  });

  it("draws a box with nothing after it as an empty task", () => {
    expect(renderMarkdown("- [ ]")).toContain('<li class="task"><span class="task-box tn-box" data-line="0"></span></li>');
    expect(renderMarkdown("- [x]\n- [ ]")).toContain('class="task task-done"');
    expect(renderMarkdown("- [ ]x")).not.toContain("task-box"); // not a box: text right after the bracket
  });

  it("keeps a list's first number", () => {
    expect(renderMarkdown("5. five\n6. six")).toContain('<ol start="5">');
  });

  it("shows due dates and labels as chips, not in links or code (D38)", () => {
    const html = renderMarkdown("- [ ] call @2099-01-11 #contract-renewal\n- [x] done @2000-01-01\n\n`#code` [#x](https://x.example) anna@x.example");
    expect(html).toMatch(/<span class="tn-chip tn-date" data-date="2099-01-11" title="[^"]+">\w+ 11 \w+ 2099<\/span>/);
    expect(html).toContain('<span class="tn-chip tn-label" data-label="contract-renewal">#contract-renewal</span>');
    expect(html).toContain('class="task task-done"');
    expect(html).not.toContain("tn-overdue"); // the past date is in a ticked task
    expect(html).toContain("<code>#code</code>");
    expect(html).toMatch(/<a href="https:\/\/x\.example"><span class="tn-chip tn-label" data-label="x">#x<\/span><\/a>/); // inside a link's text too
  });

  it("treats only dates in open checklist items as due dates: red when past (D38)", () => {
    const red = (md: string) => (renderMarkdown(md).match(/tn-overdue/g) ?? []).length;
    expect(red("- [ ] prepare @2000-01-01 for the meeting @2000-01-02")).toBe(2); // all dates in an open task
    expect(red("- [ ] prepare\n  still @2000-01-01")).toBe(1); // continuation line of the task
    expect(red("met Anna @2000-01-01")).toBe(0); // plain text: a date reference
    expect(red("- [x] done @2000-01-01")).toBe(0);
    expect(red("- note @2000-01-01")).toBe(0);
    expect(red("- [ ] task\n  - sub-item @2000-01-01")).toBe(0);
  });

  it("marks @ dates that aren't ISO yet with a dotted underline (D38)", () => {
    expect(renderMarkdown("call @24.10.27 today")).toMatch(/<span class="tn-loose-date" data-iso="2027-10-24" title="Not a date reference yet: [^"]+">@24\.10\.27<\/span>/);
  });
});
