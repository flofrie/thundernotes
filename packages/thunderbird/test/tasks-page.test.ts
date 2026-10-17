/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationSet } from "@thundernotes/core";

const note: AnnotationSet = {
  version: 1,
  email: { messageId: "a@x", subject: "Contract", from: "Anna <anna@x>", date: "2026-10-10T08:00:00Z" },
  rev: 1,
  created: "2026-10-10T08:00:00Z",
  updated: "2026-10-10T08:00:00Z",
  emailNoteMd: "- [ ] call Anna @2000-01-01 #work\n- [ ] read [the offer](mid:b@x)\n- [x] done",
  annotations: [],
};

vi.mock("../src/store.js", () => ({ getAllSets: async () => [note] }));

describe("task view page (D38)", () => {
  it("shows the tasks, filters by label, ticks one and opens its email", async () => {
    const body = /<body>([\s\S]*)<\/body>/.exec(readFileSync(new URL("../tasks.html", `file://${__filename}`), "utf8"))![1]!;
    document.body.innerHTML = body.replace(/<script[^>]*><\/script>/, "");
    const sent: { type: string }[] = [];
    (globalThis as any).messenger = {
      runtime: { sendMessage: async (m: { type: string }) => (sent.push(m), true), onMessage: { addListener() {} } },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
      tabs: { getCurrent: async () => ({ id: 1, windowId: 1 }) },
      windows: { openDefaultBrowser: async () => {} },
    };
    await import("../src/tasks.js");
    await new Promise((r) => setTimeout(r, 0));
    const titles = () => [...document.querySelectorAll("h2")].map((h) => h.firstChild!.textContent);
    expect(titles()).toEqual(["Overdue", "No date"]);
    expect(document.querySelector(".tn-overdue")).not.toBeNull();
    expect(document.querySelectorAll("li.entry")).toHaveLength(2); // done one hidden
    expect(document.title).toBe("ThunderNotes Tasks (1 overdue)");
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href).toMatch(/^data:image\/svg\+xml,.*%3E1%3C/);
    (document.querySelector(".label-chip") as HTMLElement).click();
    expect(document.querySelectorAll("li.entry")).toHaveLength(1);
    const box = document.querySelector<HTMLButtonElement>("li.entry button.tn-box")!; // the drawn box, as in the email
    expect(box.getAttribute("aria-checked")).toBe("false");
    box.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent[0]).toMatchObject({ type: "setTaskDone", messageId: "a@x", noteId: "email-note", line: 0, done: true });
    // Undo finds the line as it is now, with the finished date (D38).
    (document.querySelector("#notice .undo") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.at(-1)).toMatchObject({ type: "setTaskDone", done: false, raw: expect.stringMatching(/^- \[x\] call Anna .* ✅ \d{4}-\d{2}-\d{2}$/) });
    (document.querySelector(".label-chip") as HTMLElement).click(); // excluded: the task with it is hidden
    expect([...document.querySelectorAll("li.entry .text")].map((t) => t.textContent!.trim())).toEqual(["read the offer"]);
    expect(document.querySelector(".label-chip.not")).not.toBeNull();
    (document.querySelector(".label-chip") as HTMLElement).click(); // off again
    // Links have no address of their own (Thunderbird would open an email link a second time).
    expect(document.querySelector("li.entry a[href]")).toBeNull();
    (document.querySelector("li.entry a[data-href]") as HTMLElement).click();
    expect(sent.at(-1)).toEqual({ type: "openEmail", messageId: "b@x" });
    (document.querySelector(".meta a") as HTMLElement).click();
    expect(sent.at(-1)).toEqual({ type: "openEmail", messageId: "a@x", noteId: "email-note", line: 0 }); // the note opens for editing
  });

  it("narrows the label chips to a typed #word and picks the first with Enter", async () => {
    note.emailNoteMd = "- [ ] a #work\n- [ ] b #workshop\n- [ ] c #home";
    window.dispatchEvent(new Event("focus")); // reloads
    await new Promise((r) => setTimeout(r, 0));
    const chips = () => [...document.querySelectorAll<HTMLElement>(".label-chip")].map((c) => c.dataset.label);
    expect(chips()).toEqual(["home", "work", "workshop"]);
    expect(document.querySelector(".label-chip .n")!.textContent).toBe("1");
    const box = document.getElementById("filter") as HTMLInputElement;
    box.value = "#wor";
    box.dispatchEvent(new Event("input"));
    expect(chips()).toEqual(["work", "workshop"]);
    expect(document.querySelector<HTMLElement>(".label-chip.next")!.dataset.label).toBe("work");
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(box.value).toBe("");
    expect(document.querySelector<HTMLElement>(".label-chip.on")!.dataset.label).toBe("work");
    expect([...document.querySelectorAll("li.entry .text")].map((t) => t.textContent!.trim().split(" ")[0])).toEqual(["a"]);
    const work = document.querySelector<HTMLElement>(".label-chip.on")!;
    work.click(); // excluded
    document.querySelector<HTMLElement>(".label-chip.not")!.click(); // off again
  });

  it("shows two lines of label chips, then +N more (chosen ones stay)", async () => {
    note.emailNoteMd = Array.from({ length: 10 }, (_, i) => `- [ ] t${i} #l${i}`).join("\n");
    // Layout: three chips per line, 20px high, 6px apart.
    const visibleIndex = (el: HTMLElement) => [...el.parentElement!.children].filter((c) => !(c as HTMLElement).hidden).indexOf(el);
    Object.defineProperty(HTMLElement.prototype, "offsetTop", { configurable: true, get(this: HTMLElement) { return Math.floor(visibleIndex(this) / 3) * 26; } });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 20 });
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const shown = () => [...document.querySelectorAll<HTMLElement>(".label-chip:not([hidden])")].map((c) => c.dataset.label ?? c.textContent);
    expect(shown()).toEqual(["l0", "l1", "l2", "l3", "+6 more"]); // the order button takes the first place
    (document.querySelector(".label-chip.more") as HTMLElement).click();
    expect(shown().length).toBe(11); // all ten and "Fewer"
    expect(shown().at(-1)).toBe("Fewer");
    (document.querySelector(".label-chip.more") as HTMLElement).click();
    (document.querySelector('.label-chip[data-label="l0"]') as HTMLElement).click(); // chosen: l0
    expect(shown()).toContain("l0");
  });

  it("offers a label's colour, and no colour, on right-click (D40)", async () => {
    const sent = (globalThis as any).messenger.runtime;
    const messages: unknown[] = [];
    sent.sendMessage = async (m: unknown) => (messages.push(m), true);
    const chip = document.querySelector<HTMLElement>(".label-chip[data-label]")!;
    chip.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    const dots = [...document.querySelectorAll<HTMLElement>(".edit-menu button.swatch")];
    expect(dots).toHaveLength(9); // eight colours and "no colour"
    expect(dots.at(-1)!.classList.contains("none")).toBe(true);
    dots[2]!.click();
    expect(messages.at(-1)).toEqual({ type: "setLabelColour", label: chip.dataset.label, colour: "blue" });
    chip.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    document.querySelector<HTMLElement>(".edit-menu button.swatch.none")!.click();
    expect(messages.at(-1)).toEqual({ type: "setLabelColour", label: chip.dataset.label, colour: null });
  });

  it("has its own right-click menu, none on empty space, an edit menu in the filter box", async () => {
    const messages: { type: string }[] = [];
    (globalThis as any).messenger.runtime.sendMessage = async (m: { type: string }) => (messages.push(m), true);
    const right = (el: Element) => {
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    document.querySelector(".edit-menu")?.remove();
    expect(right(document.querySelector("li.entry .meta")!)).toBe(true);
    const items = [...document.querySelectorAll(".edit-menu li")].map((li) => li.textContent);
    expect(items.slice(0, 3)).toEqual(["Open email with this note", "Mark as done", "Copy this task as Markdown"]); // then the quick actions
    expect(items.some((i) => i!.startsWith("Copy list"))).toBe(false); // that one on the background
    (document.querySelectorAll(".edit-menu li")[1] as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.find((m) => m.type === "setTaskDone")).toMatchObject({ type: "setTaskDone", done: true });
    document.querySelector(".edit-menu")?.remove();
    expect(right(document.querySelector("h2")!)).toBe(true); // Thunderbird's page menu suppressed …
    expect([...document.querySelectorAll(".edit-menu li")].map((li) => li.textContent)).toEqual([expect.stringMatching(/^Copy list as Markdown/)]); // … ours: the list
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    // The filter field: our menu too (with Undo, which knows the date tokens).
    expect(right(document.getElementById("filter")!)).toBe(true);
    expect([...document.querySelectorAll(".edit-menu li")].map((li) => li.firstChild!.textContent)).toEqual(["Undo", "Cut", "Copy", "Paste", "Select All"]);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); // closes it (as a click elsewhere)
  });

  it("includes with all or any, and excludes (D38)", async () => {
    note.emailNoteMd = "- [ ] a #work\n- [ ] b #home\n- [ ] c #work #home\n- [ ] d #urgent #work";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const texts = () => [...document.querySelectorAll("li.entry .text")].map((t) => t.textContent!.trim().split(" ")[0]);
    const chip = (l: string) => document.querySelector<HTMLElement>(`.label-chip[data-label="${l}"]`)!;
    chip("work").click();
    const match = () => document.querySelectorAll("#controls .switch")[1]!;
    expect(match().classList.contains("disabled")).toBe(true); // always there, greyed out until two are included
    chip("home").click();
    expect(match().classList.contains("disabled")).toBe(false);
    expect(texts()).toEqual(["c"]); // all
    match().querySelectorAll<HTMLElement>("button")[1]!.click(); // any
    expect(texts()).toEqual(["a", "b", "c", "d"]);
    chip("urgent").click();
    chip("urgent").click(); // excluded
    expect(texts()).toEqual(["a", "b", "c"]);
    for (const l of ["work", "home"]) {
      chip(l).click();
      chip(l).click();
    }
    chip("urgent").click();
    expect(texts()).toEqual(["a", "b", "c", "d"]);
  });

  it("shows done tasks with the Done switch", async () => {
    note.emailNoteMd = "- [ ] open\n- [x] finished";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const texts = () => [...document.querySelectorAll("li.entry .text")].map((t) => t.textContent!.trim());
    expect(texts()).toEqual(["open"]);
    const done = document.querySelectorAll("#controls .switch")[2]!;
    expect(done.textContent).toBe("Donehideshow inlineshow separately");
    done.querySelectorAll<HTMLElement>("button")[2]!.click(); // show separately
    expect(texts()).toEqual(["open", "finished"]);
    document.querySelectorAll("#controls .switch")[2]!.querySelectorAll<HTMLElement>("button")[0]!.click();
    expect(texts()).toEqual(["open"]);
  });

  it("groups open tasks by due date, label or email (D38)", async () => {
    note.emailNoteMd = "- [ ] a #work @2000-01-01\n- [ ] b #home\n- [ ] c #work #home\n- [ ] d\n- [x] e #work";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const heads = () => [...document.querySelectorAll("#groups h2")].map((h) => h.firstChild!.textContent);
    const group = (i: number) => document.querySelectorAll("#controls .switch")[0]!.querySelectorAll<HTMLElement>("button")[i]!.click();
    expect(heads()).toEqual(["Overdue", "No date"]);
    expect(document.querySelector("#groups h2.none .how")!.textContent).toBe("(oldest email first)");
    group(1); // label
    expect(heads()).toEqual(["#home", "#work", "No label"]); // in the chips' order (equal counts: alphabetical)
    const work = [...document.querySelectorAll("#groups ul.tasks")][1]!;
    expect([...work.querySelectorAll(".text")].map((t) => t.textContent!.trim().split(" ")[0])).toEqual(["a", "c"]); // due date first
    group(2); // email
    expect(heads()).toEqual(["Contract"]);
    expect(document.querySelector("#groups .meta a")!.textContent).toBe("Open note"); // the heading names the email
    group(0);
  });

  it("shows done tasks inline in label and email sections, separately by due date (D38)", async () => {
    note.emailNoteMd = "- [ ] a #work\n- [x] b #work ✅ 2026-10-01\n- [x] c ✅ 2026-10-02";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const switches = () => document.querySelectorAll("#controls .switch");
    const button = (s: number, b: number) => switches()[s]!.querySelectorAll<HTMLButtonElement>("button")[b]!;
    const heads = () => [...document.querySelectorAll("#groups h2")].map((h) => h.firstChild!.textContent);
    const texts = () => [...document.querySelectorAll("#groups ul.tasks")].map((u) => [...u.querySelectorAll(".text")].map((t) => t.textContent!.trim().split(" ")[0]));
    expect(button(2, 1).disabled).toBe(true); // by due date: inline doesn't apply
    button(0, 1).click(); // by label
    button(2, 1).click(); // show inline
    expect(heads()).toEqual(["#work", "No label"]);
    expect(texts()).toEqual([["a", "b"], ["c"]]); // done after open, no Done group
    expect(switches()).toHaveLength(4); // the Done order moved onto this line
    button(0, 0).click(); // by due date: shown separately, the choice kept
    expect(heads()).toEqual(["No date", "Done"]);
    expect(button(2, 2).classList.contains("current")).toBe(true);
    button(0, 1).click();
    expect(heads()).toEqual(["#work", "No label"]); // inline again
    button(2, 0).click(); // hide
    button(0, 0).click();
  });

  it("tints the filter while it filters; × and Esc clear it; Cmd/Ctrl+F gets there", async () => {
    const box = document.getElementById("filter") as HTMLInputElement;
    const search = document.getElementById("search")!;
    box.value = "anna";
    box.dispatchEvent(new Event("input"));
    expect(search.classList.contains("active")).toBe(true);
    expect((document.getElementById("clearFilter") as HTMLButtonElement).hidden).toBe(false);
    (document.getElementById("clearFilter") as HTMLButtonElement).click();
    expect(box.value).toBe("");
    expect(search.classList.contains("active")).toBe(false);
    box.value = "x";
    box.dispatchEvent(new Event("input"));
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(box.value).toBe("");
    box.blur();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
    expect(document.activeElement).toBe(box);
  });

  it("orders the labels: by use, A–Z, Z–A or the own order; moves labels (D40)", async () => {
    // A real layout again (the two-line test simulated one).
    delete (HTMLElement.prototype as any).offsetTop;
    delete (HTMLElement.prototype as any).offsetHeight;
    note.emailNoteMd = "- [ ] a #beta\n- [ ] b #beta\n- [ ] c #alpha\n- [ ] d #gamma";
    const messages: any[] = [];
    (globalThis as any).messenger.runtime.sendMessage = async (m: unknown) => (messages.push(m), true);
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const chips = () => [...document.querySelectorAll<HTMLElement>("#labels .label-chip[data-label]")].map((c) => c.dataset.label);
    expect(chips()).toEqual(["beta", "alpha", "gamma"]); // most used, then A–Z
    const pick = (name: string) => {
      document.querySelector<HTMLElement>("#labels .order-btn")!.click();
      [...document.querySelectorAll<HTMLElement>(".edit-menu li")].find((li) => li.textContent!.includes(name))!.click();
    };
    pick("Z–A");
    expect(chips()).toEqual(["gamma", "beta", "alpha"]);
    expect(messages.at(-1)).toMatchObject({ type: "setLabelOrder", mode: "za" });
    pick("A–Z");
    expect(chips()).toEqual(["alpha", "beta", "gamma"]);
    // Right-click "Move to front" on gamma: the own order, from what is shown.
    document.querySelector('#labels .label-chip[data-label="gamma"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    [...document.querySelectorAll<HTMLElement>(".edit-menu li")].find((li) => li.textContent === "Move to front")!.click();
    expect(chips()).toEqual(["gamma", "alpha", "beta"]);
    expect(messages.at(-1)).toMatchObject({ type: "setLabelOrder", mode: "custom", custom: ["gamma", "alpha", "beta"] });
    // Grouped by label, the sections follow it.
    document.querySelectorAll("#controls .switch")[0]!.querySelectorAll<HTMLElement>("button")[1]!.click();
    expect([...document.querySelectorAll("#groups h2")].map((h) => h.firstChild!.textContent)).toEqual(["#gamma", "#alpha", "#beta"]);
    document.querySelectorAll("#controls .switch")[0]!.querySelectorAll<HTMLElement>("button")[0]!.click();
    pick("Most used");
    expect(chips()).toEqual(["beta", "alpha", "gamma"]);
    // Dragging gamma over beta's left half: it moves before beta at once; dropped in the row, kept.
    const store = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => store.set(k, v), getData: (k: string) => store.get(k) ?? "", effectAllowed: "" };
    const drag = (type: string, label: string, clientX = 0) => {
      const ev = Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }), { dataTransfer });
      document.querySelector(`#labels .label-chip[data-label="${label}"]`)!.dispatchEvent(ev);
    };
    drag("dragstart", "gamma");
    drag("dragover", "beta", -1); // left of its middle (no layout here: 0)
    expect(chips()).toEqual(["gamma", "beta", "alpha"]); // while dragging
    expect(messages.at(-1)).not.toMatchObject({ custom: ["gamma", "beta", "alpha"] }); // nothing stored yet
    drag("drop", "beta");
    drag("dragend", "gamma");
    expect(chips()).toEqual(["gamma", "beta", "alpha"]);
    expect(messages.at(-1)).toMatchObject({ mode: "custom", custom: ["gamma", "beta", "alpha"] });
    // Let go outside the row: back as it was.
    drag("dragstart", "alpha");
    drag("dragover", "gamma", -1);
    expect(chips()).toEqual(["alpha", "gamma", "beta"]);
    drag("dragend", "alpha");
    expect(chips()).toEqual(["gamma", "beta", "alpha"]);
  });

  it("a label in a task is included or taken out again, never excluded (D38)", async () => {
    note.emailNoteMd = "- [ ] a #work\n- [ ] b #home";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const inTask = () => document.querySelector<HTMLElement>('#groups .tn-label[data-label="work"]')!;
    const chip = () => document.querySelector<HTMLElement>('#labels .label-chip[data-label="work"]')!;
    inTask().click();
    expect(chip().classList.contains("on")).toBe(true);
    inTask().click();
    expect(chip().classList.contains("on") || chip().classList.contains("not")).toBe(false);
    chip().click();
    chip().click(); // excluded at the top
    document.querySelector<HTMLElement>('#groups .tn-label[data-label="home"]'); // work's task is hidden now
    expect(chip().classList.contains("not")).toBe(true);
    chip().click(); // off again
  });

  it("quick actions: on a task add a date or label, on a date change or remove it, on a label colour or remove; undo (D38)", async () => {
    note.emailNoteMd = "- [ ] call Anna @2099-01-05 #work";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const messages: any[] = [];
    (globalThis as any).messenger.runtime.sendMessage = async (m: any) => {
      messages.push(m);
      return m.type === "editTask" ? { before: ["- [ ] call Anna @2099-01-05 #work"], after: ["- [ ] changed"] } : true;
    };
    const menu = (selector: string) => {
      document.querySelector(selector)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      return [...document.querySelectorAll<HTMLElement>(".edit-menu li")];
    };
    const texts = (items: HTMLElement[]) => items.map((li) => li.textContent).filter(Boolean);
    expect(texts(menu("li.entry .meta"))).toEqual([
      "Open email with this note",
      "Mark as done",
      "Copy this task as Markdown",
      "Add date today",
      "Add date tomorrow",
      "Add date in a week",
      "Add date…",
      "Add label…",
    ]);
    menu("li.entry .meta").find((li) => li.textContent === "Add date tomorrow")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ type: "editTask", edit: { kind: "due" } });
    expect(messages.at(-1).edit.from).toBeUndefined(); // added, not replacing
    // Undo puts the lines back, found by how they are now.
    (document.querySelector("#notice .undo") as HTMLElement).click();
    expect(messages.at(-1)).toMatchObject({ type: "editTask", raw: "- [ ] changed", edit: { kind: "restore", block: ["- [ ] call Anna @2099-01-05 #work"] } });
    await new Promise((r) => setTimeout(r, 0));
    // On a date: change or remove that one.
    expect(texts(menu('li.entry .tn-date[data-date="2099-01-05"]'))).toEqual(["Change to today", "Change to tomorrow", "Change to next week", "Change to…", "Remove this date"]);
    menu('li.entry .tn-date[data-date="2099-01-05"]').find((li) => li.textContent === "Remove this date")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ edit: { kind: "due", iso: null, from: "2099-01-05", nth: 0 } });
    // On a label in the task: its colour (no title) and "Remove label", no moving.
    const onLabel = menu('li.entry .tn-label[data-label="work"]');
    expect(document.querySelectorAll(".edit-menu button.swatch")).toHaveLength(9);
    expect(texts(onLabel)).toEqual(["Remove label"]);
    onLabel.find((li) => li.textContent === "Remove label")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ edit: { kind: "removeLabel", label: "work" } });
    // "Add label…": a field at the task; Enter adds it.
    menu("li.entry .meta").find((li) => li.textContent === "Add label…")!.click();
    const field = document.querySelector<HTMLInputElement>("li.entry .ask input")!;
    field.value = "urgent";
    field.dispatchEvent(new Event("input"));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.find((m) => m.edit?.kind === "addLabel")).toMatchObject({ edit: { kind: "addLabel", label: "urgent" } });
    // "Change to…": the date the word means shows as you type.
    menu('li.entry .tn-date[data-date="2099-01-05"]').find((li) => li.textContent === "Change to…")!.click();
    const date = document.querySelector<HTMLInputElement>("li.entry .ask input")!;
    date.value = "3d";
    date.dispatchEvent(new Event("input"));
    expect(document.querySelector("li.entry .ask .hint")!.textContent).toMatch(/^→ \w+ \d+ \w+/);
    date.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ edit: { kind: "due", from: "2099-01-05" } });
  });

  it("suggests labels used before in its own list; arrow keys and Enter pick (D38)", async () => {
    note.emailNoteMd = "- [ ] a #work #workshop #home\n- [ ] b";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const messages: any[] = [];
    (globalThis as any).messenger.runtime.sendMessage = async (m: any) => (messages.push(m), m.type === "editTask" ? { before: [""], after: [""] } : true);
    const rowB = [...document.querySelectorAll<HTMLElement>("li.entry")].find((li) => li.querySelector(".text")!.textContent!.trim() === "b")!;
    rowB.querySelector(".meta")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    [...document.querySelectorAll<HTMLElement>(".edit-menu li")].find((li) => li.textContent === "Add label…")!.click();
    const field = rowB.querySelector<HTMLInputElement>(".ask input")!;
    const shown = () => [...rowB.querySelectorAll<HTMLElement>(".suggest li")].map((li) => li.dataset.label);
    expect(shown()).toEqual(["home", "work", "workshop"]); // all, before typing
    field.value = "shop";
    field.dispatchEvent(new Event("input"));
    expect(shown()).toEqual(["workshop"]); // containing it
    field.value = "wo";
    field.dispatchEvent(new Event("input"));
    expect(shown()).toEqual(["work", "workshop"]);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ edit: { kind: "addLabel", label: "workshop" } });
  });

  it("a picked label isn't selected; the field survives a reload meanwhile (D38)", async () => {
    note.emailNoteMd = "- [ ] a #work\n- [ ] b";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    (globalThis as any).messenger.runtime.sendMessage = async (m: any) => (m.type === "editTask" ? { before: [""], after: [""] } : true);
    const rowB = () => [...document.querySelectorAll<HTMLElement>("li.entry")].find((li) => li.querySelector(".text")!.textContent!.trim() === "b")!;
    rowB().querySelector(".meta")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    [...document.querySelectorAll<HTMLElement>(".edit-menu li")].find((li) => li.textContent === "Add label…")!.click();
    // A reload while the field is open (e.g. sync storing the note): it waits.
    note.emailNoteMd = "- [ ] a #work\n- [ ] b\n- [ ] c";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    expect(rowB().querySelector(".ask input")).not.toBeNull();
    expect(document.querySelectorAll("li.entry")).toHaveLength(2);
    (rowB().querySelector(".suggest li") as HTMLElement).click(); // picks "work"
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector("#labels .label-chip.on")).toBeNull(); // not selected as a filter
    expect(document.querySelectorAll("li.entry")).toHaveLength(3); // the reload caught up
  });

  it("filters by dates as words: clicked or typed (year, month, day), shown as tokens (D38)", async () => {
    note.emailNoteMd = "- [ ] a @2099-01-05\n- [ ] b @2099-01-05 #x\n- [ ] c @2099-02-01\n- [ ] d @2098-03-03";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const texts = () => [...document.querySelectorAll("li.entry .text")].map((t) => t.textContent!.trim().split(" ")[0]).sort();
    const tokens = () => [...document.querySelectorAll("#dateTokens .token")].map((t) => t.firstChild!.textContent);
    const box = document.getElementById("filter") as HTMLInputElement;
    const type = (text: string) => {
      box.value = text;
      box.dispatchEvent(new Event("input"));
    };
    // Clicked in a task: a token; clicked again: gone.
    document.querySelector<HTMLElement>('li.entry .tn-date[data-date="2099-01-05"]')!.click();
    expect(texts()).toEqual(["a", "b"]);
    expect(tokens()).toEqual([expect.stringMatching(/^@\w+ 5 Jan 2099$/)]);
    expect(document.getElementById("search")!.classList.contains("active")).toBe(true);
    document.querySelector<HTMLElement>('li.entry .tn-date[data-date="2099-01-05"]')!.click();
    expect(texts()).toEqual(["a", "b", "c", "d"]);
    expect(tokens()).toEqual([]);
    // Typed: a month, then a year; a space makes a token, words combine with it.
    type("@2099-02 ");
    expect(tokens()).toEqual(["@Feb 2099"]);
    expect(box.value).toBe("");
    expect(texts()).toEqual(["c"]);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(tokens()).toEqual([]);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })); // undo
    expect(tokens()).toEqual([expect.stringMatching(/^@Feb 2099/)]);
    (document.querySelector("#dateTokens .token .x") as HTMLElement).click(); // removed with its ×
    expect(tokens()).toEqual([]);
    // The field's menu: "Undo" active, and it brings the token back.
    box.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const undo = [...document.querySelectorAll<HTMLElement>(".edit-menu li")].find((li) => li.firstChild!.textContent === "Undo")!;
    expect(undo.classList.contains("disabled")).toBe(false);
    undo.click();
    expect(tokens()).toHaveLength(1);
    // A click on the token: its text, selected, in the field; Esc: the token again; a second Esc clears.
    (document.querySelector("#dateTokens .token") as HTMLElement).click();
    expect(tokens()).toEqual([]);
    expect(box.value).toBe("@2099-02");
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 8]);
    expect(texts()).toEqual(["c"]); // still filtering the same
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(tokens()).toEqual([expect.stringMatching(/^@Feb 2099/)]);
    expect(box.value).toBe("");
    // Clicked and typed over: a new date; leaving the field makes it a token.
    (document.querySelector("#dateTokens .token") as HTMLElement).click();
    type("@2099-01");
    box.blur();
    await new Promise((r) => setTimeout(r, 200));
    expect(tokens()).toEqual([expect.stringMatching(/^@Jan 2099/)]);
    (document.querySelector("#dateTokens .token .x") as HTMLElement).click();
    box.blur();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true })); // the cursor elsewhere
    expect(tokens()).toHaveLength(1);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    type("@2099");
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); // Tab as a space
    expect(tokens()).toEqual(["@2099"]);
    type("#x");
    expect(texts()).toEqual(["b"]); // a date word and a text word, both
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(tokens()).toEqual([]);
    expect(texts()).toEqual(["a", "b", "c", "d"]);
    // A month name: that month this year.
    type("@ja");
    expect([...document.querySelectorAll(".date-suggest li")].map((li) => li.firstChild!.textContent)).toEqual([expect.stringMatching(/^Jan/)]);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(tokens()).toEqual([expect.stringMatching(/^@Jan/)]);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    type("@feb ");
    expect(tokens()).toEqual([expect.stringMatching(/^@Feb/)]);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // A date word as in notes, from the suggestions.
    type("@tomo");
    expect(document.querySelectorAll(".date-suggest li")).toHaveLength(1);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(tokens()).toHaveLength(1);
    expect(box.value).toBe("");
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  it("a new field while another is open (and a reload waits) shows its list; hover highlights; Tab finishes (D38)", async () => {
    note.emailNoteMd = "- [ ] a #work #home\n- [ ] b\n- [ ] c";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const messages: any[] = [];
    (globalThis as any).messenger.runtime.sendMessage = async (m: any) => (messages.push(m), m.type === "editTask" ? { before: [""], after: [""] } : true);
    const row = (t: string) => [...document.querySelectorAll<HTMLElement>("li.entry")].find((li) => li.querySelector(".text")!.textContent!.trim() === t)!;
    const addLabel = (t: string) => {
      row(t).querySelector(".meta")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      [...document.querySelectorAll<HTMLElement>(".edit-menu li")].find((li) => li.textContent === "Add label…")!.click();
    };
    addLabel("b");
    window.dispatchEvent(new Event("focus")); // a reload now waits
    await new Promise((r) => setTimeout(r, 0));
    addLabel("c");
    expect(row("c").querySelectorAll(".suggest li").length).toBe(2); // its list is there
    expect(document.querySelectorAll(".ask")).toHaveLength(1); // b's field closed
    const items = [...row("c").querySelectorAll<HTMLElement>(".suggest li")];
    items[1]!.dispatchEvent(new MouseEvent("mouseenter"));
    expect(items[1]!.classList.contains("selected")).toBe(true);
    row("c").querySelector(".ask input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ edit: { kind: "addLabel", label: items[1]!.dataset.label } });
  });

  it("offers all labels used before, also more than eight and a new one (D38)", async () => {
    note.emailNoteMd = "- [ ] a " + Array.from({ length: 12 }, (_, k) => `#l${k}`).join(" ") + " #fresh\n- [ ] b";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const rowB = [...document.querySelectorAll<HTMLElement>("li.entry")].find((li) => li.querySelector(".text")!.textContent!.trim() === "b")!;
    rowB.querySelector(".meta")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    [...document.querySelectorAll<HTMLElement>(".edit-menu li")].find((li) => li.textContent === "Add label…")!.click();
    const shown = [...rowB.querySelectorAll<HTMLElement>(".suggest li")].map((li) => li.dataset.label);
    expect(shown).toHaveLength(13);
    expect(shown).toContain("fresh");
    rowB.querySelector(".ask input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  it("acts on the occurrence of a date that was clicked, should it be there twice (D38)", async () => {
    note.emailNoteMd = "- [ ] a @2099-01-05 then @2099-01-05";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const messages: any[] = [];
    (globalThis as any).messenger.runtime.sendMessage = async (m: any) => (messages.push(m), m.type === "editTask" ? { before: [""], after: [""] } : true);
    const second = document.querySelectorAll('li.entry .tn-date[data-date="2099-01-05"]')[1]!;
    second.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    [...document.querySelectorAll<HTMLElement>(".edit-menu li")].find((li) => li.textContent === "Remove this date")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ edit: { kind: "due", iso: null, from: "2099-01-05", nth: 1 } });
  });

  it("Enter writes the filter out as understood; Cmd/Ctrl+Z brings back what was typed (D38)", async () => {
    const box = document.getElementById("filter") as HTMLInputElement;
    box.value = "offer anna OR ben";
    box.dispatchEvent(new Event("input"));
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(box.value).toBe("offer (anna OR ben)");
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(box.value).toBe("offer anna OR ben");
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(box.value).toBe("");
  });

  it("shows the sender's address after the name (D38)", async () => {
    note.emailNoteMd = "- [ ] a";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const meta = document.querySelector("li.entry .meta a")!;
    expect(meta.querySelector(".address")!.textContent).toBe("anna@x");
    expect(meta.textContent).toMatch(/^Contract – Anna anna@x, /);
  });

  it("shows a task's whole note below it, read-only (D38)", async () => {
    note.emailNoteMd = "Intro line\n\n- [ ] a\n- [ ] b";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const first = () => document.querySelector<HTMLElement>("li.entry")!;
    first().querySelector<HTMLElement>(".expand")!.click();
    expect(first().querySelector(".note-preview")!.textContent).toContain("Intro line");
    window.dispatchEvent(new Event("focus")); // kept across a redraw
    await new Promise((r) => setTimeout(r, 0));
    expect(first().querySelector(".note-preview")).not.toBeNull();
    first().querySelector<HTMLElement>(".expand")!.click();
    expect(first().querySelector(".note-preview")).toBeNull();
  });

  it("selects tasks with the arrow keys or a click; Space ticks, Enter opens, d/l/t act, →/← the note (D38)", async () => {
    note.emailNoteMd = "- [ ] a\n- [ ] b\n- [ ] c";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    (document.activeElement as HTMLElement | null)?.blur?.();
    const messages: any[] = [];
    (globalThis as any).messenger.runtime.sendMessage = async (m: any) => (messages.push(m), m.type === "editTask" ? { before: [""], after: [""] } : true);
    const key = (k: string) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    const selected = () => document.querySelector("li.entry.selected .text")?.textContent?.trim();
    key("ArrowDown");
    expect(selected()).toBe("a");
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowDown"); // stays on the last
    expect(selected()).toBe("c");
    key("Home");
    expect(selected()).toBe("a");
    key("End");
    expect(selected()).toBe("c");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", metaKey: true, bubbles: true, cancelable: true }));
    expect(selected()).toBe("a");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(selected()).toBe("c");
    key("ArrowUp");
    expect(selected()).toBe("b");
    key("Enter");
    expect(messages.at(-1)).toMatchObject({ type: "openEmail", noteId: "email-note", line: 1 });
    key("t");
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ type: "editTask", line: 1, edit: { kind: "due" } });
    key("ArrowRight");
    expect(document.querySelector("li.entry.selected .note-preview")).not.toBeNull();
    key("ArrowLeft");
    expect(document.querySelector("li.entry.selected .note-preview")).toBeNull();
    key("l");
    expect(document.querySelector("li.entry.selected .ask input")).not.toBeNull();
    document.querySelector<HTMLInputElement>("li.entry.selected .ask input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    key(" ");
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.find((m) => m.type === "setTaskDone")).toMatchObject({ line: 1, done: true });
    // A click on a row selects it.
    (document.querySelectorAll("li.entry .text")[2] as HTMLElement).click();
    expect(selected()).toBe("c");
    key("Escape");
    expect(selected()).toBeUndefined();
  });

  it("marks what the filter matched, in the task and its email line (D38)", async () => {
    note.emailNoteMd = "- [ ] call Anna about the offer @2099-01-05";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const box = document.getElementById("filter") as HTMLInputElement;
    box.value = "offer contract -ben @2099-01";
    box.dispatchEvent(new Event("input"));
    const marks = [...document.querySelectorAll("li.entry mark.hit")].map((m) => m.textContent);
    expect(marks).toEqual(["offer", "Contract"]); // in the task, and the subject in the email line
    expect(document.querySelector("li.entry .tn-date.hit")).not.toBeNull();
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector("li.entry mark.hit")).toBeNull();
  });

  it("adds a label dragged from the label row onto a task, unless it has it (D38)", async () => {
    note.emailNoteMd = "- [ ] a #work\n- [ ] b";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const messages: any[] = [];
    (globalThis as any).messenger.runtime.sendMessage = async (m: any) => (messages.push(m), m.type === "editTask" ? { before: [""], after: [""] } : true);
    const store = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => store.set(k, v), getData: (k: string) => store.get(k) ?? "", effectAllowed: "", dropEffect: "" };
    const fire = (type: string, el: Element) => el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true }), { dataTransfer }));
    const row = (t: string) => [...document.querySelectorAll<HTMLElement>("li.entry")].find((li) => li.querySelector(".text")!.textContent!.trim().startsWith(t))!;
    const chip = () => document.querySelector('#labels .label-chip[data-label="work"]')!;
    fire("dragstart", chip());
    // A browser drops only what the drag allows: "copy" (onto a task) must be among it.
    expect(dataTransfer.effectAllowed).toMatch(/copy/i);
    fire("dragover", row("b").querySelector(".text")!);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(row("b").classList.contains("drop-target")).toBe(true);
    fire("drop", row("b").querySelector(".text")!);
    fire("dragend", chip());
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ type: "editTask", line: 1, edit: { kind: "addLabel", label: "work" } });
    // Onto the task that has it already: nothing changes.
    const sent = messages.length;
    fire("dragstart", chip());
    fire("dragover", row("a").querySelector(".text")!);
    fire("drop", row("a").querySelector(".text")!);
    fire("dragend", chip());
    expect(messages.length).toBe(sent);
    expect(document.getElementById("notice")!.textContent).toContain("#work already");
  });

  it("Space moves on to the next task, also when done tasks are shown (D38)", async () => {
    note.emailNoteMd = "- [ ] a\n- [ ] b\n- [ ] c";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    // Done tasks shown separately: the ticked one stays listed (in Done).
    const done = document.querySelectorAll("#controls .switch")[2]!;
    done.querySelectorAll<HTMLElement>("button")[2]!.click();
    (document.activeElement as HTMLElement | null)?.blur?.();
    (globalThis as any).messenger.runtime.sendMessage = async () => true;
    const key = (k: string) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    const selected = () => document.querySelector("li.entry.selected .text")?.textContent?.trim();
    (document.querySelectorAll("li.entry .text")[0] as HTMLElement).click();
    expect(selected()).toBe("a");
    key(" ");
    expect(selected()).toBe("b"); // on to the next
    key("Escape");
    done.querySelectorAll<HTMLElement>("button")[0]!.click(); // hide again
  });

  it("a label dragged out of a task: onto empty space removes it, onto another task adds it (D38)", async () => {
    note.emailNoteMd = "- [ ] a #work\n- [ ] b";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const messages: any[] = [];
    (globalThis as any).messenger.runtime.sendMessage = async (m: any) => (messages.push(m), m.type === "editTask" ? { before: [""], after: [""] } : true);
    const store = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => store.set(k, v), getData: (k: string) => store.get(k) ?? "", effectAllowed: "", dropEffect: "" };
    const fire = (type: string, el: Element) => el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true }), { dataTransfer }));
    const row = (t: string) => [...document.querySelectorAll<HTMLElement>("li.entry")].find((li) => li.querySelector(".text")!.textContent!.trim().startsWith(t))!;
    const label = () => row("a").querySelector('.text .tn-label[data-label="work"]')!;
    // Off the list (a heading): removed from task a.
    fire("dragstart", label());
    expect(row("a").classList.contains("drag-source")).toBe(true);
    fire("dragover", document.querySelector("#groups h2")!);
    expect(dataTransfer.dropEffect).toBe("move");
    fire("drop", document.querySelector("#groups h2")!);
    fire("dragend", label());
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ type: "editTask", line: 0, edit: { kind: "removeLabel", label: "work" } });
    // Onto task b: added there.
    fire("dragstart", label());
    fire("dragover", row("b").querySelector(".text")!);
    expect(dataTransfer.dropEffect).toBe("copy");
    fire("drop", row("b").querySelector(".text")!);
    fire("dragend", label());
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ type: "editTask", line: 1, edit: { kind: "addLabel", label: "work" } });
    // Back on its own task: nothing.
    const sent = messages.length;
    fire("dragstart", label());
    fire("drop", row("a").querySelector(".meta")!);
    fire("dragend", label());
    expect(messages.length).toBe(sent);
  });

  it("one label regardless of case, shown and written as most often written (D38)", async () => {
    note.emailNoteMd = "- [ ] a #URGENT\n- [ ] b #URGENT\n- [ ] c #urgent\n- [ ] d";
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    const chips = [...document.querySelectorAll<HTMLElement>("#labels .label-chip[data-label]")];
    expect(chips.map((c) => c.firstChild!.textContent)).toEqual(["#URGENT"]); // one chip, the spelling used most
    const messages: any[] = [];
    (globalThis as any).messenger.runtime.sendMessage = async (m: any) => (messages.push(m), m.type === "editTask" ? { before: [""], after: [""] } : true);
    const rowD = [...document.querySelectorAll<HTMLElement>("li.entry")].find((li) => li.querySelector(".text")!.textContent!.trim() === "d")!;
    rowD.querySelector(".meta")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    [...document.querySelectorAll<HTMLElement>(".edit-menu li")].find((li) => li.textContent === "Add label…")!.click();
    expect(rowD.querySelector(".suggest li")!.textContent).toBe("#URGENT");
    (rowD.querySelector(".suggest li") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(messages.at(-1)).toMatchObject({ edit: { kind: "addLabel", label: "URGENT" } });
  });
});
