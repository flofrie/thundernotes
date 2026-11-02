/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// Public issue #8: tbkeys catches single keys on the Thunderbird window and swallows them unless they
// come from a text field. Seen from outside our closed Shadow DOM, they come from a <div>.

import { afterEach, describe, expect, it } from "vitest";
import { keepTypingInside, takesTyping } from "../src/keep-typing.js";

/** Like tbkeys with "a": "unset": on the document, anything not from a text field is swallowed. */
function shortcutCatcher(): { swallowed: string[]; stop: () => void } {
  const swallowed: string[] = [];
  const onKey = (e: Event) => {
    const el = e.target as HTMLElement;
    if (/^(input|textarea|select)$/i.test(el.tagName) || el.getAttribute("contenteditable") === "true") return;
    swallowed.push(e.type);
    e.preventDefault();
  };
  for (const t of ["keydown", "keypress", "keyup"]) document.addEventListener(t, onKey);
  return { swallowed, stop: () => ["keydown", "keypress", "keyup"].forEach((t) => document.removeEventListener(t, onKey)) };
}

function ui(): { host: HTMLElement; shadow: ShadowRoot } {
  const host = document.createElement("div");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <div class="card"><div class="cm-content" contenteditable="true"><div class="cm-line"><span>text</span></div></div></div>
    <textarea></textarea><input type="text" class="label"><input type="checkbox"><button>Save</button>`;
  return { host, shadow };
}

function type(el: Element): void {
  for (const t of ["keydown", "keypress", "keyup"]) el.dispatchEvent(new KeyboardEvent(t, { key: "a", bubbles: true, composed: true, cancelable: true }));
}

afterEach(() => document.body.replaceChildren());

describe("keys typed in ThunderNotes' fields (public issue #8)", () => {
  it("don't reach a shortcut catcher on the window, in the editor and in text fields", () => {
    const { shadow } = ui();
    keepTypingInside(shadow);
    const catcher = shortcutCatcher();
    for (const sel of [".cm-line span", "textarea", "input.label"]) type(shadow.querySelector(sel)!);
    catcher.stop();
    expect(catcher.swallowed).toEqual([]);
  });

  it("still go on from buttons and checkboxes, where they aren't typing", () => {
    const { shadow } = ui();
    keepTypingInside(shadow);
    const catcher = shortcutCatcher();
    type(shadow.querySelector("button")!);
    type(shadow.querySelector("input[type=checkbox]")!);
    catcher.stop();
    expect(catcher.swallowed).toEqual(["keydown", "keypress", "keyup", "keydown", "keypress", "keyup"]);
  });

  it("are typed: nothing in our fields cancels them", () => {
    const { shadow } = ui();
    keepTypingInside(shadow);
    const catcher = shortcutCatcher();
    const events = ["keydown", "keypress"].map((t) => new KeyboardEvent(t, { key: "a", bubbles: true, composed: true, cancelable: true }));
    for (const e of events) shadow.querySelector(".cm-line span")!.dispatchEvent(e);
    catcher.stop();
    expect(events.map((e) => e.defaultPrevented)).toEqual([false, false]);
  });

  it("tells typing targets from others", () => {
    const { shadow } = ui();
    expect(takesTyping(shadow.querySelector(".cm-line span"))).toBe(true);
    expect(takesTyping(shadow.querySelector("textarea"))).toBe(true);
    expect(takesTyping(shadow.querySelector("input.label"))).toBe(true);
    expect(takesTyping(shadow.querySelector("button"))).toBe(false);
    expect(takesTyping(shadow.querySelector("input[type=checkbox]"))).toBe(false);
    const off = document.createElement("div");
    off.setAttribute("contenteditable", "false");
    off.append(document.createElement("span"));
    expect(takesTyping(off.firstChild)).toBe(false);
    expect(takesTyping(null)).toBe(false);
  });
});
