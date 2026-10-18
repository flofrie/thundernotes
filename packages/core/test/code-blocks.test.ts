/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// Issues #4, #5: what counts as code must be what the renderer draws as code. The lines the
// renderer draws a checkbox for (data-line) must be exactly the tasks tasksIn finds.

import { describe, expect, it } from "vitest";
import { codeLines, labelsIn, looseDates, removeLabelFromNote, renderMarkdown, tasksIn } from "../src/index.js";

const NOTES: Record<string, string> = {
  "quote container ends": "> ```\n> quoted code\n\n- [ ] actual task",
  "list container ends": "- item\n  ```\n  code\n\n- [ ] actual task",
  "indented code following list item": "- item\n\n      - [ ] code example\n\n- [ ] actual task",
  "quote marker inside ordinary code": "```\n> ```\n- [ ] code example\n```\n\n- [ ] actual task",
  "nested fence (4 backticks around 3)": "````markdown\n```\n- [ ] example\n````\n\n- [ ] actual task",
  "tilde fence inside a backtick one": "```\n~~~\n- [ ] example\n~~~\n```\n\n- [ ] actual task",
  "closing line with text after it is code": "```markdown\n``` still code\n- [ ] in code\n```\n\n- [ ] actual task",
  "indented code after a blank line": "Example:\n\n    - [ ] example\n\n- [ ] actual task",
  "nested items, 2 and 4 spaces": "- [ ] parent\n    - [ ] child four\n  - [ ] child two\n- [x] next",
  "quoted task": "> - [ ] quoted\n\n- [ ] after",
  "fence inside a list item": "- item\n    ```\n    - [ ] code in item\n    ```\n- [ ] after",
  "backtick info string with a backtick is no fence": "``` a`b\n\n- [ ] real",
  "unclosed fence runs to the end": "- [ ] before\n```\n- [ ] in code",
  "loose list, numbers and stars": "- [ ] a\n\n1. [ ] b\n\n* [x] c",
  "tilde fence, longer close": "~~~\n- [ ] x\n~~~~~\n- [ ] y",
};

const drawn = (md: string) => [...renderMarkdown(md).matchAll(/data-line="(\d+)"/g)].map((m) => Number(m[1]));

describe("code blocks as the renderer sees them", () => {
  for (const [name, md] of Object.entries(NOTES)) {
    it(`agrees with the renderer: ${name}`, () => {
      expect(tasksIn(md).map((t) => t.line)).toEqual(drawn(md));
    });
  }

  it("marks fence lines and their content as code, not the text around", () => {
    expect([...codeLines("a\n```js\ncode\n```\nb")]).toEqual([1, 2, 3]);
    expect([...codeLines("a\n```\n``` not a close\n```\nb")]).toEqual([1, 2, 3]);
    expect([...codeLines("para\n    lazy, not code\n\n    code")]).toEqual([3]);
  });
  it("does not edit or extract labels and dates in code with quote-looking contents", () => {
    const md = "```\n> ```\n#secret @tomorrow\n```\n\n#work @tomorrow";
    expect(labelsIn(md)).toEqual(["work"]);
    expect(looseDates(md)).toHaveLength(1);
    expect(removeLabelFromNote(md, "secret")).toBe(md);
  });

  it("agrees across combinations of containers, code examples and blank lines", () => {
    const examples = ["```\n> ```\n- [ ] example\n```", "> ```\n> code", "- item\n  ```\n  code", "    - [ ] example", "~~~\n```\n- [ ] example\n~~~"];
    for (const before of examples) for (const gap of ["\n", "\n\n", "\n\n\n"]) {
      const md = `${before}${gap}- [ ] actual task`;
      expect(tasksIn(md).map((t) => t.line)).toEqual(drawn(md));
    }
  });

});
