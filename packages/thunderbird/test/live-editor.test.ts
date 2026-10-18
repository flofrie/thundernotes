/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// Live-preview editor (D28): markup hidden off the cursor line, list continuation, tasks.

import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { isoDate } from "@thundernotes/core";
import { createLiveEditor, pastLinkText, type LiveEditor } from "../src/live/editor.js";
import { colourItem, labelColourItems } from "../src/edit-menu.js";

// jsdom has no execCommand; CodeMirror uses it for selections in a shadow root (browsers have it).
document.execCommand ??= () => false;
// jsdom has no Range geometry. CodeMirror's scheduled measurement can run between assertions;
// these model/editor tests do not exercise layout, so supply its normal empty-layout result.
if (!Range.prototype.getClientRects) Object.defineProperty(Range.prototype, "getClientRects", { value: () => [] });
if (!Range.prototype.getBoundingClientRect) Object.defineProperty(Range.prototype, "getBoundingClientRect", { value: () => new DOMRect() });

let editor: LiveEditor | null = null;

/** Sets the editor selection through the editor's own API (test helper). */
function selectRange(_root: ShadowRoot, from: number, to: number): void {
  (editor as LiveEditor & { select(from: number, to: number): void }).select(from, to);
}
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

function open(doc: string, events: string[] = []) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  const parent = document.createElement("div");
  root.append(parent);
  editor = createLiveEditor({
    parent,
    root,
    doc,
    onDone: () => events.push("done"),
    onCancel: () => events.push("cancel"),
    onBlur: () => events.push("blur"),
    onChange: () => events.push("change"),
    openLink: (url) => events.push(`open:${url}`),
    clipboard: { read: async () => "", write: async () => {} },
    menuContainer: parent,
  });
  const lines = () => [...root.querySelectorAll(".cm-line")].map((l) => l.textContent);
  return { root, lines };
}

describe("live preview", () => {
  it("hides markup on lines without the cursor and shows it on the cursor's line", () => {
    const { root, lines } = open("first **bold** line\n# Heading\n- item\n- [ ] task\n> quote\n[site](https://example.com) and `code`");
    // Cursor starts on line 1: its markup stays, the others are formatted.
    expect(lines()).toEqual(["first **bold** line", "Heading", "•item", "task", "quote", "site and code"]);
    expect(root.querySelector(".tn-box")).not.toBeNull();
    expect(root.querySelector(".cm-tn-strong")?.textContent).toBe("**bold**");
    expect(root.querySelector(".cm-tn-h1")).not.toBeNull();
    expect(root.querySelector(".cm-tn-link")?.textContent).toBe("site");
    // Moving the cursor to the last line reveals its markup and hides line 1's.
    editor!.placeCursor();
    expect(lines()[0]).toBe("first bold line");
    expect(lines()[5]).toBe("[site](https://example.com) and `code`");
  });

  it("ticks a task by clicking its checkbox", () => {
    const { root } = open("intro\n- [ ] task");
    const box = root.querySelector(".cm-tn-task")!;
    box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(editor!.getValue()).toBe(`intro\n- [x] task ✅ ${isoDate(new Date())}`); // with the day it was finished (D38)
  });

  it("reports changes; Esc cancels, Ctrl/Cmd+Enter is done", () => {
    const events: string[] = [];
    const { root } = open("text", events);
    const content = root.querySelector(".cm-content")!;
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // "Mod" is Ctrl outside macOS (jsdom), Cmd on macOS.
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(events).toContain("cancel");
    expect(events).toContain("done");
  });

  // Reported: with a selection, Backspace deleted it but typing didn't replace it.
  it("replaces a selection with typed text", () => {
    const { root } = open("hello world");
    const content = root.querySelector(".cm-content")!;
    // Select "world" through the editor, then type.
    const input = new InputEvent("beforeinput", { inputType: "insertText", data: "there", bubbles: true, cancelable: true });
    selectRange(root, 6, 11);
    content.dispatchEvent(input);
    expect(input.defaultPrevented).toBe(true);
    expect(editor!.getValue()).toBe("hello there");
  });

  it("leaves plain typing (no selection) to the browser", () => {
    const { root } = open("hello");
    const input = new InputEvent("beforeinput", { inputType: "insertText", data: "x", bubbles: true, cancelable: true });
    root.querySelector(".cm-content")!.dispatchEvent(input);
    expect(input.defaultPrevented).toBe(false);
  });

  // Reported: an accent typed with a dead key (Option+U, u) over a selection was inserted next to it.
  it("clears a selection when a composition starts (dead keys, input methods)", () => {
    const { root } = open("hello world");
    selectRange(root, 6, 11);
    root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Dead", bubbles: true }));
    expect(editor!.getValue()).toBe("hello ");
    selectRange(root, 0, 5);
    root.querySelector(".cm-content")!.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(editor!.getValue()).toBe(" ");
  });

  it("shows ~~strikethrough~~ crossed out, markers hidden off the cursor line", () => {
    const { root, lines } = open("first line\n~~gone~~ text");
    expect(lines()[1]).toBe("gone text");
    expect(root.querySelector(".cm-tn-strike")?.textContent).toBe("gone");
  });

  it("checkbox shortcuts: Cmd/Ctrl+L cycles, Cmd/Ctrl+Shift+L toggles, [] + space expands", () => {
    const { root } = open("buy milk");
    const content = root.querySelector(".cm-content")!;
    const key = (init: KeyboardEventInit) => content.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    key({ key: "l", ctrlKey: true });
    expect(editor!.getValue()).toBe("- [ ] buy milk");
    key({ key: "l", ctrlKey: true });
    expect(editor!.getValue()).toBe(`- [x] buy milk ✅ ${isoDate(new Date())}`);
    // Real browsers send keyCode too; CodeMirror uses it to match Shift+letter bindings.
    key({ key: "L", keyCode: 76, ctrlKey: true, shiftKey: true });
    expect(editor!.getValue()).toBe("buy milk");
  });

  it("Cmd/Ctrl+K turns a bare URL into a Markdown link, and leaves real links alone", () => {
    const { root } = open("see https://www.example.com/a now and [x](https://b.example)");
    const content = root.querySelector(".cm-content")!;
    const key = () => content.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    selectRange(root, 10, 10); // inside the bare URL
    key();
    expect(editor!.getValue()).toBe("see [example.com/a](https://www.example.com/a) now and [x](https://b.example)");
    selectRange(root, editor!.getValue().length - 5, editor!.getValue().length - 5); // inside the link's URL
    const before = editor!.getValue();
    key();
    // Not a bare URL: a new empty link is started instead (asynchronously, after the clipboard).
    expect(editor!.getValue()).toBe(before);
  });

  it("Cmd/Ctrl+K opens the link picker; Enter links the selected text to the chosen email (D39)", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const parent = document.createElement("div");
    root.append(parent);
    const searched: string[] = [];
    editor = createLiveEditor({
      parent,
      root,
      doc: "read the offer",
      onDone() {},
      onCancel() {},
      onBlur() {},
      onChange() {},
      openLink() {},
      clipboard: { read: async () => "", write: async () => {} },
      menuContainer: parent,
      searchEmails: async (q) => {
        searched.push(q);
        return [{ messageId: "offer@x", subject: "[tn] Offer", author: "Anna <a@x>", date: "2026-10-12T09:00:00Z", folder: "Inbox", hasNotes: false, sameThread: true }];
      },
      linkPicker: () => true,
    });
    selectRange(root, 9, 14);
    root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    const input = root.querySelector<HTMLInputElement>(".tn-picker input")!;
    expect(input).not.toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector(".tn-picker .subject")?.textContent).toBe("[tn] Offer");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(editor!.getValue()).toBe("read the [offer](mid:offer@x)");
    expect(root.querySelector(".tn-picker")).toBeNull();
  });

  it("Cmd/Ctrl+K again closes the link picker, the note as it was (D39)", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const parent = document.createElement("div");
    root.append(parent);
    editor = createLiveEditor({
      parent, root, doc: "read the offer", onDone() {}, onCancel() {}, onBlur() {}, onChange() {}, openLink() {},
      clipboard: { read: async () => "", write: async () => {} }, menuContainer: parent,
      searchEmails: async () => [], linkPicker: () => true,
    });
    const content = root.querySelector(".cm-content")!;
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    const input = root.querySelector<HTMLInputElement>(".tn-picker input")!;
    const again = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(true); // not left to Thunderbird (its search box)
    expect(root.querySelector(".tn-picker")).toBeNull();
    expect(editor!.getValue()).toBe("read the offer");
  });

  it("Cmd/Ctrl+K around selected text waits for the URL", async () => {
    const { root } = open("read the offer");
    const content = root.querySelector(".cm-content")!;
    selectRange(root, 9, 14);
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(editor!.getValue()).toBe("read the [offer]()");
  });

  it("draws fenced code as a box; the ``` show only while the cursor is in the block", () => {
    const { root } = open("text\n```js\ncode\n```\nafter");
    expect(root.querySelectorAll(".cm-line.cm-tn-cb")).toHaveLength(3);
    expect(root.querySelectorAll(".cm-tn-fence-hidden")).toHaveLength(2);
    selectRange(root, 10, 10); // on "code"
    expect(root.querySelectorAll(".cm-tn-fence-hidden")).toHaveLength(0);
    expect(root.querySelectorAll(".cm-tn-fence")).toHaveLength(2);
  });

  it("draws email links as lozenges, also with escapes or formatting in their text", () => {
    const { root, lines } = open("first\n[\\[tn\\] C – Anna](mid:a@x) and [**D**](mid:b@x) and [web](https://x.example)\n[[tn-spike] C](mid:c@x)");
    const emails = [...root.querySelectorAll(".cm-tn-email-link")].map((e) => e.textContent);
    expect(emails).toEqual(["[tn] C – Anna", "D", "[tn-spike] C"]);
    expect(lines()[2]).toBe("[tn-spike] C"); // balanced brackets (pasted before they were escaped)
    // On the cursor line: Markdown showing, text underlined like a web link, no lozenge.
    editor!.placeCursor();
    expect(lines()[2]).toBe("[[tn-spike] C](mid:c@x)");
    expect([...root.querySelectorAll(".cm-tn-email-link")].map((e) => e.textContent)).toEqual(["[tn] C – Anna", "D"]);
    expect([...root.querySelectorAll(".cm-tn-link:not(.cm-tn-email-link)")].map((e) => e.textContent)).toContain("[tn-spike] C");
    expect(root.querySelectorAll(".cm-tn-link:not(.cm-tn-email-link)")).toHaveLength(2); // the web link + the email link being edited
  });

  it("finds web links with brackets in their text too", () => {
    expect(open("first\n[the [offer] here](https://x.example)").lines()[1]).toBe("the [offer] here");
  });

  it("shows due dates and labels as lozenges off the cursor line, plain on it (D38)", () => {
    const { root, lines } = open("first\n- [ ] call @2099-01-11 #contract-renewal\n- [x] done @2000-01-01");
    expect(lines()[1]).toMatch(/^call \w+ 11 \w+ 2099 #contract-renewal$/);
    expect(root.querySelector(".cm-tn-label")?.textContent).toBe("#contract-renewal");
    expect(root.querySelector<HTMLElement>(".cm-tn-label")!.dataset.label).toBe("contract-renewal"); // for its colour (D40)
    expect(root.querySelectorAll(".cm-tn-overdue")).toHaveLength(0); // the past date is in a ticked task
    selectRange(root, 10, 10);
    expect(lines()[1]).toBe("- [ ] call @2099-01-11 #contract-renewal");
  });

  it("shows only dates in open checklist items as due dates: red when past (D38)", () => {
    const { root } = open("first\n- [ ] prepare @2000-01-01 for @2000-01-02\n  more @2000-01-03\n  - sub @2000-01-04\nmet @2000-01-05\n- [x] done @2000-01-06");
    expect([...root.querySelectorAll(".cm-tn-date")]).toHaveLength(6);
    expect(root.querySelectorAll(".cm-tn-overdue")).toHaveLength(3); // the task's line and its continuation line
  });

  it("offers labels used in the note being edited, before it is saved (D38)", async () => {
    const { root } = open("first #newlabel\n");
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "#ne" }, selection: { anchor: view.state.doc.length + 3 }, userEvent: "input.type" });
    await new Promise((r) => setTimeout(r, 0));
    expect([...root.querySelectorAll(".tn-suggest li")].map((li) => li.textContent)).toEqual(["#newlabel"]);
  });

  it("draws labels inside a link's text as lozenges too (D38)", () => {
    const { root } = open("first\n[call #work](mid:a@x) and [[tn] #home](mid:b@x)");
    expect([...root.querySelectorAll(".cm-tn-label")].map((e) => e.textContent)).toEqual(["#work", "#home"]);
  });

  it("gives a date in a web link's text the link's underline (D38)", () => {
    const { root } = open("first\n[due @2099-01-11](https://x.example) and [mail @2099-01-12](mid:a@x)");
    const chips = [...root.querySelectorAll(".cm-tn-date")];
    expect(chips.map((c) => c.classList.contains("cm-tn-chip-in-link"))).toEqual([true, false]);
  });

  it("offers labels right after a link's opening bracket (D38)", async () => {
    const { root } = open("#work\n");
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    view.dispatch({ changes: { from: 6, insert: "[#wo" }, selection: { anchor: 10 }, userEvent: "input.type" });
    await new Promise((r) => setTimeout(r, 0));
    expect([...root.querySelectorAll(".tn-suggest li")].map((li) => li.textContent)).toEqual(["#work"]);
  });

  it("replaces the whole label when the cursor is inside it (D38)", async () => {
    const { root } = open("#alpha #beta-long here");
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    view.dispatch({ changes: { from: 8, to: 9, insert: "" }, selection: { anchor: 8 }, userEvent: "delete.backward" }); // cursor in "#|eta-long": all labels offered
    await new Promise((r) => setTimeout(r, 0));
    const items = [...root.querySelectorAll(".tn-suggest li")].map((li) => li.textContent);
    expect(items).toContain("#alpha");
    const i = items.indexOf("#alpha");
    for (let k = 0; k < i; k++) root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", keyCode: 40, bubbles: true }));
    root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
    expect(editor!.getValue()).toBe("#alpha #alpha here");
  });

  it("keeps the cursor on the line when a date is taken at the end of a line, with lines after it (D38)", () => {
    const { root } = open("first\n- [ ] call \n- [ ] next");
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    view.dispatch({ changes: { from: 17, insert: "@fri" }, selection: { anchor: 21 }, userEvent: "input.type" });
    for (const key of [{ key: "Tab", keyCode: 9 }, { key: "Enter", keyCode: 13 }]) {
      view.dispatch({ changes: { from: 17, to: view.state.doc.line(2).to, insert: "@fri" }, selection: { anchor: 21 }, userEvent: "input.type" });
      root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { ...key, bubbles: true }));
      expect(view.state.doc.line(2).text).toMatch(/^- \[ \] call @\d{4}-\d{2}-\d{2} $/);
      expect(view.state.selection.main.head).toBe(view.state.doc.line(2).to); // still on the task's line
    }
  });

  it("opens the list only when typing or with Ctrl+Space, not when the cursor moves onto a word (D38)", () => {
    const { root } = open("first\n- [ ] call @fri #wo\nlast");
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    const content = root.querySelector(".cm-content")!;
    view.dispatch({ selection: { anchor: 19 } }); // in "@fr|i", as the arrow keys would move it
    expect(root.querySelector(".tn-suggest")).toBeNull();
    view.dispatch({ selection: { anchor: 22 } }); // in "#wo"
    expect(root.querySelector(".tn-suggest")).toBeNull();
    view.dispatch({ selection: { anchor: 19 } });
    content.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", ctrlKey: true, bubbles: true }));
    expect(root.querySelectorAll(".tn-suggest li")).toHaveLength(1);
    view.dispatch({ selection: { anchor: 3 } }); // leaving the word closes it, and moving back doesn't reopen it
    expect(root.querySelector(".tn-suggest")).toBeNull();
    view.dispatch({ selection: { anchor: 19 } });
    expect(root.querySelector(".tn-suggest")).toBeNull();
  });

  it("puts a click behind a link at the link's end, not before its hidden address", () => {
    const { root } = open("see [Offer – Anna](mid:a@x) and [web](https://x.example) end");
    const { state } = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    const text = state.doc.toString();
    const emailEnd = text.indexOf(")") + 1;
    expect(pastLinkText(state, text.indexOf("](mid"))).toBe(emailEnd); // end of the visible text
    expect(pastLinkText(state, text.indexOf("mid:"))).toBe(emailEnd); // inside the hidden address
    expect(pastLinkText(state, text.indexOf("Anna"))).toBe(text.indexOf("Anna")); // in the text: stays
    expect(pastLinkText(state, text.indexOf("](https"))).toBe(text.lastIndexOf(")") + 1);
    expect(pastLinkText(state, 2)).toBe(2);
  });

  it("maps a click with every line as in the shown note, also a link on the first line", () => {
    const { root } = open("[Offer – Anna](mid:a@x)\nsecond\nthird");
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    let lozengeWhileMapping: boolean | null = null;
    const original = view.posAtCoords.bind(view);
    view.posAtCoords = ((coords: { x: number; y: number }) => {
      lozengeWhileMapping = !!root.querySelector(".cm-line .cm-tn-email-link") && !root.querySelector(".cm-line")!.textContent!.includes("mid:");
      return view.state.doc.length;
    }) as typeof view.posAtCoords;
    editor!.placeCursor({ x: 10, y: 50 });
    view.posAtCoords = original;
    expect(lozengeWhileMapping).toBe(true); // not expanded by the cursor starting on that line
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("treats a box with nothing after it as a task: drawn off the cursor line, Enter ends the list", () => {
    const { root } = open("first\n- [ ]\n- [x]\nlast");
    expect(root.querySelectorAll(".cm-tn-task")).toHaveLength(2);
    expect(root.querySelectorAll(".cm-tn-task.tn-box-done")).toHaveLength(1);
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.line(2).to } }); // after "- [ ]"
    root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
    expect(editor!.getValue()).toBe("first\n\n- [x]\nlast"); // the empty item ends the list
  });

  it("puts the cursor at the end of a given line (opened from the task view, D38)", () => {
    const { root } = open("intro\n- [ ] call Anna\n- [ ] send offer");
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    editor!.placeAtLine(1);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(2).to);
    editor!.placeAtLine(99); // gone meanwhile: the last line
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("right-click on a label: only the label's colour row, not the note's too (D40)", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const parent = document.createElement("div");
    root.append(parent);
    editor = createLiveEditor({
      parent,
      root,
      doc: "call #work today",
      onDone() {},
      onCancel() {},
      onBlur() {},
      onChange() {},
      openLink() {},
      clipboard: { read: async () => "", write: async () => {} },
      menuContainer: parent,
      topMenuItems: () => [colourItem("yellow", () => {})],
      labelColourItems: (label) => labelColourItems(label, null, () => {}),
    });
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    const menu = (at: number) => {
      view.posAtCoords = (() => at) as typeof view.posAtCoords;
      view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
      return parent.querySelector(".edit-menu")!;
    };
    const onLabel = menu(7); // in "#work"
    expect(onLabel.querySelectorAll("li.swatches")).toHaveLength(1);
    expect(onLabel.querySelector("button.swatch.none")).not.toBeNull();
    expect(onLabel.querySelector("li.info")).toBeNull(); // the dots, no title
    const elsewhere = menu(1); // in "call": the note's colour row
    expect(elsewhere.querySelectorAll("li.swatches")).toHaveLength(1);
    expect(elsewhere.querySelector("button.swatch.none")).toBeNull();
  });

  it("shows impossible dates as text marked 'Not a valid date' (D38)", () => {
    const { root } = open("first\n- [ ] call @2026-13-45\n- [x] done ✅ 2026-02-30\n- [x] fine ✅ 2026-02-28");
    expect([...root.querySelectorAll<HTMLElement>(".cm-tn-loose-date")].map((e) => [e.textContent, e.title])).toEqual([
      ["@2026-13-45", "Not a valid date"],
      ["✅ 2026-02-30", "Not a valid date"],
    ]);
    expect(root.querySelectorAll(".cm-tn-done-date")).toHaveLength(1);
  });

  it("shows the current year in dates when the setting says so", () => {
    const year = new Date().getFullYear();
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const parent = document.createElement("div");
    root.append(parent);
    const make = (alwaysYear: boolean) =>
      createLiveEditor({
        parent, root, doc: `first\n- [ ] call @${year}-12-24`, onDone() {}, onCancel() {}, onBlur() {}, onChange() {}, openLink() {},
        clipboard: { read: async () => "", write: async () => {} }, menuContainer: parent, alwaysYear: () => alwaysYear,
      });
    editor = make(true);
    expect(root.querySelector(".cm-tn-date")!.textContent).toContain(String(year));
    editor.destroy();
    editor = make(false);
    expect(root.querySelector(".cm-tn-date")!.textContent).not.toContain(String(year));
  });

  it("Cmd/Ctrl+K turns a www. address into a Markdown link too", () => {
    const { root } = open("see www.example.com now");
    selectRange(root, 6, 6);
    root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    expect(editor!.getValue()).toBe("see [example.com](https://www.example.com) now");
  });

  it("suggests each label once, in the spelling used before (D38)", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const parent = document.createElement("div");
    root.append(parent);
    editor = createLiveEditor({
      parent, root, doc: "x #urgent and ", onDone() {}, onCancel() {}, onBlur() {}, onChange() {}, openLink() {},
      clipboard: { read: async () => "", write: async () => {} }, menuContainer: parent,
      knownLabels: async () => ["URGENT", "work"],
    });
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "#u" }, selection: { anchor: view.state.doc.length + 2 }, userEvent: "input.type" });
    await new Promise((r) => setTimeout(r, 0));
    expect([...root.querySelectorAll(".tn-suggest li")].map((li) => li.textContent)).toEqual(["#URGENT"]);
  });

  it("adds no space after a taken date before a closing bracket (D38)", () => {
    const { root } = open("[call ](mid:a@x)");
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    view.dispatch({ changes: { from: 6, insert: "@morgen" }, selection: { anchor: 13 }, userEvent: "input.type" });
    root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
    expect(editor!.getValue()).toMatch(/^\[call @\d{4}-\d{2}-\d{2}\]\(mid:a@x\)$/);
  });

  it("turns a typed date into the ISO date on space; Cmd+Z brings back what was typed (D38)", () => {
    const { root } = open("call @24.10.27");
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    const type = (text: string) => {
      const pos = view.state.selection.main.head;
      const handled = view.state.facet(EditorView.inputHandler).some((h) => h(view, pos, pos, text, () => view.state.update({ changes: { from: pos, insert: text } })));
      if (!handled) view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
    };
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    type(" ");
    expect(editor!.getValue()).toBe("call @2027-10-24 ");
    root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(editor!.getValue()).toBe("call @24.10.27 ");
    // Two-letter abbreviations stay as typed.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "@mo" }, selection: { anchor: 3 } });
    type(" ");
    expect(editor!.getValue()).toBe("@mo ");
    // Counts, also backwards; only exactly a number and a unit.
    for (const typed of ["@-3d", "@2w", "@inaweek", "@lastmonday"]) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: typed }, selection: { anchor: typed.length } });
      type(" ");
      expect(editor!.getValue()).toMatch(/^@\d{4}-\d{2}-\d{2} $/);
    }
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "@3dprinting" }, selection: { anchor: 11 } });
    type(" ");
    expect(editor!.getValue()).toBe("@3dprinting ");
  });

  it("marks @ dates that aren't ISO yet with a dotted underline off the cursor line (D38)", () => {
    const { root } = open("first\n- [ ] call @24.10.27 and @2027-01-05");
    expect([...root.querySelectorAll(".cm-tn-loose-date")].map((e) => e.textContent)).toEqual(["@24.10.27"]);
  });

  it("turns @ number dates in pasted text into ISO dates, undoable (D38)", () => {
    const { root } = open("");
    const content = root.querySelector(".cm-content")!;
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    paste.clipboardData = { getData: () => "- [ ] call @24.10.27\n- [ ] ask @freitag" };
    content.dispatchEvent(paste);
    expect(editor!.getValue()).toBe("- [ ] call @2027-10-24\n- [ ] ask @freitag");
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(editor!.getValue()).toBe("- [ ] call @24.10.27\n- [ ] ask @freitag");
  });


  for (const [name, input, expected] of [
    ["fenced code", "```markdown\n@24.10.27\n```\n\nCall @24.10.27", "```markdown\n@24.10.27\n```\n\nCall @2027-10-24"],
    ["tilde fence", "~~~\n@24.10.27\n~~~\nCall @24.10.27", "~~~\n@24.10.27\n~~~\nCall @2027-10-24"],
    ["quoted code", "> ```\n> @24.10.27\n> ```\n\nCall @24.10.27", "> ```\n> @24.10.27\n> ```\n\nCall @2027-10-24"],
    ["indented code", "    @24.10.27\n\nCall @24.10.27", "    @24.10.27\n\nCall @2027-10-24"],
    ["inline code", "`@24.10.27` and @24.10.27", "`@24.10.27` and @2027-10-24"],
    ["unclosed fence", "```\n@24.10.27", "```\n@24.10.27"],
    ["CRLF", "```\r\n@24.10.27\r\n```\r\nCall @24.10.27", "```\n@24.10.27\n```\nCall @2027-10-24"],
  ]) it(`keeps pasted dates literal in ${name}`, () => {
    const { root } = open("");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => input } });
    const content = root.querySelector(".cm-content")!;
    content.dispatchEvent(event);
    expect(editor!.getValue()).toBe(expected);
    // Date correction is its own undo step, while code examples stay untouched.
    if (expected !== input!.replace(/\r\n?/g, "\n")) {
      content.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
      expect(editor!.getValue()).toBe(input!.replace(/\r\n?/g, "\n"));
    }
  });

  it("classifies dates after a pasted closing fence in the resulting document", () => {
    const { root } = open("```\nold code\n");
    selectRange(root, editor!.getValue().length, editor!.getValue().length);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => "@24.10.27\n```\nCall @24.10.27" } });
    root.querySelector(".cm-content")!.dispatchEvent(event);
    expect(editor!.getValue()).toBe("```\nold code\n@24.10.27\n```\nCall @2027-10-24");
  });

  it("offers dates after @ and takes one with Enter (D38)", () => {
    const { root } = open("call ");
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    view.dispatch({ changes: { from: 5, insert: "@morgen" }, selection: { anchor: 12 }, userEvent: "input.type" });
    const items = [...root.querySelectorAll(".tn-suggest li")];
    expect(view.hasFocus).toBe(true);
    expect(items.length).toBe(1);
    root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
    expect(editor!.getValue()).toMatch(/^call @\d{4}-\d{2}-\d{2} $/);
  });

  it("shows a link's destination as its tooltip", () => {
    const { root } = open("first\n[site](https://example.com) and https://b.example");
    const titles = [...root.querySelectorAll(".cm-tn-link")].map((l) => l.getAttribute("title"));
    expect(titles).toEqual(["https://example.com", "https://b.example"]);
  });

  describe("Tab", () => {
    const tab = (root: ShadowRoot, shift = false) =>
      root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", keyCode: 9, shiftKey: shift, bubbles: true }));

    it("nests a list item under the one above, with its sub-items, and Shift+Tab takes it back", () => {
      const { root } = open("- one\n- two\n  - two a\n1. first\n2. second");
      selectRange(root, 8, 8); // on "two"
      tab(root);
      expect(editor!.getValue()).toBe("- one\n  - two\n    - two a\n1. first\n2. second");
      tab(root, true);
      expect(editor!.getValue()).toBe("- one\n- two\n  - two a\n1. first\n2. second");
      const second = editor!.getValue().indexOf("2.");
      selectRange(root, second, second);
      tab(root);
      expect(editor!.getValue().endsWith("1. first\n   1. second")).toBe(true); // under "1. ": 3 spaces, a new sub-list from 1
    });

    it("numbers a nested item 1 (a sub-list right under an item must start at 1), then onwards", async () => {
      const { root } = open("1. one\n2. two\n3. three\n4. four");
      selectRange(root, 13, 13); // on "two"
      tab(root);
      expect(editor!.getValue()).toBe("1. one\n   1. two\n3. three\n4. four");
      await new Promise((r) => setTimeout(r, 0)); // renumbering
      expect(editor!.getValue()).toBe("1. one\n   1. two\n2. three\n3. four");
      const three = editor!.getValue().indexOf("2. three");
      selectRange(root, three, three);
      tab(root);
      expect(editor!.getValue()).toBe("1. one\n   1. two\n   2. three\n3. four");
    });

    it("doesn't nest the first item of a level", () => {
      const { root } = open("- one\n- two");
      selectRange(root, 2, 2);
      tab(root);
      expect(editor!.getValue()).toBe("- one\n- two");
    });

    it("adds and removes a quote level on plain lines, every selected line", () => {
      const { root } = open("alpha\nbeta\n- item");
      selectRange(root, 0, 0);
      tab(root);
      expect(editor!.getValue()).toBe("> alpha\nbeta\n- item");
      tab(root);
      expect(editor!.getValue()).toBe("> > alpha\nbeta\n- item");
      tab(root, true);
      tab(root, true);
      expect(editor!.getValue()).toBe("alpha\nbeta\n- item");
      selectRange(root, 0, 10);
      tab(root);
      expect(editor!.getValue()).toBe("> alpha\n> beta\n- item");
    });

    it("on an empty line starts a quote with the cursor after \"> \"", () => {
      const { root } = open("text\n");
      selectRange(root, 5, 5);
      tab(root);
      expect(editor!.getValue()).toBe("text\n> ");
      const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
      expect(view.state.selection.main.head).toBe(7);
    });

    it("inserts spaces in code: at the cursor, or before every selected line", () => {
      const { root } = open("```\nab\ncd\n```");
      selectRange(root, 5, 5); // between a and b
      tab(root);
      expect(editor!.getValue()).toBe("```\na   b\ncd\n```");
      selectRange(root, 4, 12);
      tab(root);
      expect(editor!.getValue()).toBe("```\n    a   b\n    cd\n```");
      tab(root, true);
      expect(editor!.getValue()).toBe("```\na   b\ncd\n```");
    });
  });

  it("joins list items by their text only (Delete and Backspace), so Enter splits them again", () => {
    const { root } = open("- one\n- [ ] two\n- three");
    const content = root.querySelector(".cm-content")!;
    const key = (k: string, keyCode: number) => content.dispatchEvent(new KeyboardEvent("keydown", { key: k, keyCode, bubbles: true }));
    selectRange(root, 5, 5); // end of "one"
    key("Delete", 46);
    expect(editor!.getValue()).toBe("- onetwo\n- three");
    key("Enter", 13);
    expect(editor!.getValue()).toBe("- one\n- two\n- three");
    const three = editor!.getValue().indexOf("three");
    selectRange(root, three, three);
    key("Backspace", 8);
    expect(editor!.getValue()).toBe("- one\n- twothree");
  });

  it("lays list lines out as the shown note: spaces that don't nest and continuation lines hidden", () => {
    const { lines } = open("first\n-  [ ] two spaces\n  - [ ] not nested\n- item\n  continued");
    expect(lines().slice(2)).toEqual(["not nested", "•item", "continued"]);
  });

  it("starts an item's continuation line where its text starts, after a blank line at the edge", () => {
    const { root } = open("first\n- item\n  more\n\n  after blank");
    const l = [...root.querySelectorAll<HTMLElement>(".cm-line")];
    expect(l[2]!.style.paddingLeft).toBe("1.4em");
    expect(l[4]!.style.paddingLeft).toBe("");
  });

  it("shows runs of spaces as one off the cursor line, as the shown note does", () => {
    const { lines } = open("first\n- [ ]   wide   gap\n```\nkeep   code\n```");
    expect(lines()[1]).toBe("wide gap");
    expect(lines()[3]).toBe("keep   code");
  });

  it("marks empty lines inside a selection", () => {
    const { root } = open("one\n\ntwo\n\n");
    selectRange(root, 0, 7);
    expect(root.querySelectorAll(".cm-tn-selected-empty")).toHaveLength(1);
  });

  it("draws nested quotes with one bar that moves in one step per level", () => {
    const { root } = open("first\n> one\n> > two");
    const quoted = [...root.querySelectorAll<HTMLElement>(".cm-line.cm-tn-quote")];
    expect(quoted).toHaveLength(2);
    expect(quoted[0]!.style.marginLeft).toBe("");
    expect(quoted[1]!.style.marginLeft).toBe("1.2em");
  });

  it("hides meaningless leading spaces off the cursor line and draws nested items one step in", () => {
    const { root, lines } = open("first\n  spaced\n- a\n  - b");
    expect(lines()[1]).toBe("spaced");
    const nested = [...root.querySelectorAll<HTMLElement>(".cm-line")][3]!;
    expect(nested.style.paddingLeft).toBe("1.4em");
  });

  it("Cmd/Ctrl+L on an empty line leaves the cursor after the new checkbox", () => {
    const { root } = open("text\n");
    selectRange(root, 5, 5);
    root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "l", ctrlKey: true, bubbles: true }));
    expect(editor!.getValue()).toBe("text\n- [ ] ");
    const view = EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(view.state.selection.main.head).toBe(11);
  });

  describe("numbered lists", () => {
    it("lets a sub-list start at any number, under numbered and bulleted items", () => {
      const { root } = open("first\n1. one\n   1. sub\n2. two\n   3. sub three\n- bullet\n  5. five");
      const l = [...root.querySelectorAll<HTMLElement>(".cm-line")];
      expect(l[4]!.style.paddingLeft).toBe("1.4em"); // "3. sub three" nested
      expect(l[6]!.style.paddingLeft).toBe("1.4em"); // "5. five" nested under the bullet
      // and really list items (numbers drawn as markers), not text lines of the item above
      expect(l[4]!.querySelector(".cm-tn-list-number")?.textContent).toBe("3.");
      expect(l[6]!.querySelector(".cm-tn-list-number")?.textContent).toBe("5.");
    });

    const key = (root: ShadowRoot, init: KeyboardEventInit) =>
      root.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    const settle = () => new Promise((r) => setTimeout(r, 0));

    it("renumbers after an item is inserted; undo brings the old numbers back and stays", async () => {
      const { root } = open("1. one\n2. two\n3. three");
      selectRange(root, 6, 6); // end of "one"
      key(root, { key: "Enter", keyCode: 13 });
      await settle();
      expect(editor!.getValue()).toBe("1. one\n2. \n3. two\n4. three");
      key(root, { key: "z", ctrlKey: true });
      await settle();
      expect(editor!.getValue()).toBe("1. one\n2. \n2. two\n3. three");
      key(root, { key: "z", ctrlKey: true });
      await settle();
      expect(editor!.getValue()).toBe("1. one\n2. two\n3. three");
    });

    it("keeps the first number", async () => {
      const { root } = open("5. five\n6. six");
      selectRange(root, 7, 7);
      key(root, { key: "Enter", keyCode: 13 });
      await settle();
      expect(editor!.getValue()).toBe("5. five\n6. \n7. six");
    });

    it("Ctrl+Shift+7 and 8 switch lines between numbered, bulleted and plain", async () => {
      const { root } = open("alpha\n[ ] beta");
      selectRange(root, 0, 14);
      key(root, { key: "&", code: "Digit7", ctrlKey: true, shiftKey: true });
      expect(editor!.getValue()).toBe("1. alpha\n2. [ ] beta");
      key(root, { key: "*", code: "Digit8", ctrlKey: true, shiftKey: true });
      expect(editor!.getValue()).toBe("- alpha\n- [ ] beta");
      selectRange(root, 0, editor!.getValue().length);
      key(root, { key: "*", code: "Digit8", ctrlKey: true, shiftKey: true });
      expect(editor!.getValue()).toBe("alpha\nbeta");
    });
  });

  // Reported: a --- line typed under text vanished in the editor: it was read as a setext
  // heading underline and hidden. It must be a rule, as in the rendered note.
  it("treats --- under a line of text as a rule, not a heading underline", () => {
    const { root, lines } = open("above\n---\nbelow");
    expect(lines()[1]).toBe("---");
    expect(root.querySelector(".cm-tn-hr-line .cm-tn-hr-text")?.textContent).toBe("---");
  });
});

