/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// The note card itself (card.ts): ticking a checkbox in the shown note (issue #5), and keeping
// what was typed when saving fails (issue #6). The live editor can't load here: the textarea
// editor is used, as in Thunderbird when loading it fails.

import { describe, expect, it, vi } from "vitest";
import { convertLooseDates, isoDate, looseDates, renderMarkdown, type Annotation } from "@thundernotes/core";

(globalThis as any).browser = { runtime: { getURL: () => "/not-there.js" } };
(globalThis as any).matchMedia ??= () => ({ matches: false, addEventListener() {} }); // jsdom has neither
(globalThis as any).ResizeObserver ??= class { observe() {} disconnect() {} };
const { CARD_CSS, NoteCard } = await import("../src/card.js");

const tick = () => new Promise((r) => setTimeout(r, 0));
/** Until the card edits (the textarea editor opens once loading the live editor has failed). */
async function editing(c: { el: HTMLElement }): Promise<void> {
  for (let i = 0; i < 200 && !c.el.classList.contains("fallback"); i++) await new Promise((r) => setTimeout(r, 10));
  if (!c.el.classList.contains("fallback")) throw new Error("the editor didn't open");
}

function card(bodyMd: string, save: (id: string, md: string) => Promise<void> = async () => {}, selectors: Annotation["selectors"] = [{ type: "TextQuoteSelector", exact: "q" }]) {
  const annotation: Annotation = { id: "a1", selectors, bodyMd, created: "", updated: "" };
  const drafts: (string | null)[] = [];
  const saved: string[] = [];
  const copied: number[] = [];
  const actions = {
    render: async (md: string) => renderMarkdown(md),
    clipboard: { read: async () => "", write: async () => {} },
    save: async (id: string, md: string) => {
      saved.push(md);
      await save(id, md);
      return md;
    },
    remove: async () => {},
    openLink: () => {},
    cycleToText: () => false,
    renumberLists: () => true,
    alwaysYear: () => false,
    searchEmails: async () => [],
    linkPicker: () => true,
    knownLabels: async () => [],
    setColour: () => {},
    labelColour: () => null,
    setLabelColour: () => {},
    draft: (_id: string, text: string | null) => void drafts.push(text),
    copyTask: (_id: string, _md: string, line: number) => void copied.push(line),
    copyNote: () => {},
    // As the background does it (it has the Markdown parser, D22).
    convertLooseDate: async (md: string, text: string, k: number) => {
      const match = looseDates(md).filter((d) => md.slice(d.from, d.to) === text)[k];
      return match ? convertLooseDates(md, [match]) : null;
    },
  };
  const events = { changed: () => {}, closedEmpty: () => {}, activate: () => {}, hover: () => {}, fold: () => {} };
  const c = new NoteCard(annotation, actions as any, events);
  document.body.append(c.el);
  return { c, drafts, saved, copied };
}

it("keeps loose-list markers and task boxes aligned with paragraph-wrapped text", () => {
  expect(CARD_CSS).toContain(".note li > p:first-child { display: inline; }");
  expect(CARD_CSS).toContain(".note ul > li.task > p:first-child > .task-box:first-child");
});

describe("note card", () => {
  it("ticks the checklist item clicked, not one in a code block or a quote before it (issue #5)", async () => {
    const md = "```markdown\n- [ ] example\n```\n> - [ ] quoted\n\n- [ ] actual task";
    const { c, saved } = card(md);
    await tick();
    const boxes = [...c.el.querySelectorAll<HTMLElement>(".view-note .task-box")];
    expect(boxes).toHaveLength(2); // the quoted one and the actual task; none in the code block
    boxes[1]!.click();
    await tick();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/^```markdown\n- \[ \] example\n```\n> - \[ \] quoted\n\n- \[x\] actual task ✅ \d{4}-\d{2}-\d{2}$/);
  });

  // Review of the first fix: nested fences, a tilde fence in a backtick one, indented code.
  for (const [name, md, expected] of [
    ["nested fence", "````markdown\n```\n- [ ] example\n````\n\n- [ ] actual task", /^````markdown\n```\n- \[ \] example\n````\n\n- \[x\] actual task ✅/],
    ["tilde in backtick", "```\n~~~\n- [ ] example\n~~~\n```\n\n- [ ] actual task", /^```\n~~~\n- \[ \] example\n~~~\n```\n\n- \[x\] actual task ✅/],
    ["indented code", "Example:\n\n    - [ ] example\n\n- [ ] actual task", /^Example:\n\n    - \[ \] example\n\n- \[x\] actual task ✅/],
  ] as const) {
    it(`ticks the actual task, not the example: ${name}`, async () => {
      const { c, saved } = card(md);
      await tick();
      const boxes = [...c.el.querySelectorAll<HTMLElement>(".view-note .task-box")];
      expect(boxes).toHaveLength(1);
      boxes[0]!.click();
      await tick();
      expect(saved[0]).toMatch(expected);
    });
  }

  for (const md of [
    "> ```\n> quoted code\n\n\n- [ ] actual task",
    "```\n> ```\n- [ ] code example\n```\n\n\n- [ ] actual task",
    "- item\n\n      - [ ] code example\n\n- [ ] actual task",
  ]) it("uses the original line after code and multiple blank lines", async () => {
    const { c, saved } = card(md);
    await tick();
    const boxes = [...c.el.querySelectorAll<HTMLElement>(".view-note .task-box")];
    expect(boxes).toHaveLength(1);
    boxes[0]!.click();
    await tick();
    expect(saved[0]).toBe(md.replace("- [ ] actual task", `- [x] actual task ✅ ${isoDate(new Date())}`));
  });

  it("does not guess a source line when the mapping is missing or invalid", async () => {
    const { c, saved } = card("- [ ] actual task");
    await tick();
    const box = c.el.querySelector<HTMLElement>(".view-note .task-box")!;
    for (const value of [undefined, "-1", "NaN", "0.5", "99"]) {
      if (value === undefined) delete box.dataset.line;
      else box.dataset.line = value;
      box.click();
    }
    await tick();
    expect(saved).toEqual([]);
  });

  it("keeps what was typed when saving fails, and offers it back (issue #6)", async () => {
    const { c, drafts } = card("old", async () => {
      throw new Error("write failed");
    });
    await tick();
    c.edit();
    await editing(c);
    const area = c.el.querySelector("textarea")!;
    area.value = "new important text";
    area.dispatchEvent(new Event("input"));
    c.commit();
    await tick();
    await tick();
    // The simple editor says so (and why, on hover): a silent downgrade would never be reported.
    expect(c.el.querySelector<HTMLElement>(".fallback-note")!.textContent).toContain("Simple editor: the full editor couldn't be loaded");
    expect(c.el.querySelector<HTMLElement>(".fallback-note")!.title).toMatch(/^Reason: /);
    expect(drafts.at(-1)).toBe("new important text"); // not cleared: the only copy
    expect(c.el.classList.contains("has-draft")).toBe(true);
    expect(c.el.querySelector(".draft-text")!.textContent).toContain("Not saved (write failed)");
  });

  it("clears the draft once saving succeeded, and when editing is discarded", async () => {
    const { c, drafts } = card("old");
    await tick();
    c.edit();
    await editing(c);
    const area = c.el.querySelector("textarea")!;
    area.value = "new text";
    area.dispatchEvent(new Event("input"));
    c.commit();
    await tick();
    await tick();
    expect(drafts).toEqual(["new text", null]); // kept while saving, gone after
    expect(c.el.classList.contains("has-draft")).toBe(false);
  });

  // D22: the menus read what the renderer marked; the conversion itself happens in the background.
  const menu = (target: Element) => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return [...document.querySelectorAll<HTMLElement>(".edit-menu li")];
  };
  it("converts the right-clicked @ date, not the same text in a code block", async () => {
    const { c, saved } = card("```\n@24.10.27\n```\ncall @24.10.27");
    await tick();
    const loose = c.el.querySelectorAll(".view-note .tn-loose-date[data-iso]");
    expect(loose).toHaveLength(1);
    const item = menu(loose[0]!).find((li) => li.textContent?.startsWith("Convert to date"))!;
    expect(item.textContent).toMatch(/2027/);
    item.click();
    await tick();
    expect(saved).toEqual(["```\n@24.10.27\n```\ncall @2027-10-24"]);
  });

  it("offers to copy a task with text on its checkbox's line", async () => {
    const { c, copied } = card("- [ ]\n- [ ] send offer");
    await tick();
    const [empty, task] = [...c.el.querySelectorAll<HTMLElement>(".view-note li")];
    expect(menu(empty!).some((li) => li.textContent === "Copy task as Markdown")).toBe(false);
    menu(task!).find((li) => li.textContent === "Copy task as Markdown")!.click();
    expect(copied).toEqual([1]);
  });
});

describe("a note on a picture (D46)", () => {
  it("shows the picture's label, and is not the note on the whole email", () => {
    const { c } = card("", undefined, [{ type: "ImageSelector", src: "part:1.2", index: 0, alt: "Team photo" }]);
    expect(c.el.querySelector(".quote")!.textContent).toContain("🖼 Team photo");
    expect(c.el.querySelector(".quote")!.textContent).not.toContain("“");
    expect(c.el.classList.contains("email")).toBe(false);
  });
});
