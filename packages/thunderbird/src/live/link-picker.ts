/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The link picker (D39): a search box at the cursor that finds emails to link to (subject,
// sender; the current conversation and emails with notes first) and also takes a web address.
// Opened by typing [[ or <<, or by Cmd/Ctrl+K (setting). Arrow keys + Enter or a click pick,
// Esc or Cmd/Ctrl+K again cancel.

import { emailLink, linkText } from "@thundernotes/core";
import { linkForPaste, markdownLink } from "../links.js";
import type { EmailCandidate } from "../protocol.js";

export interface PickerOptions {
  /** Element the picker is placed in (positioned), and the cursor's screen box to place it at. */
  container: HTMLElement;
  at: { left: number; bottom: number };
  search(query: string): Promise<EmailCandidate[]>;
  /** Text selected when the picker opened: becomes the link text. */
  label?: string;
  /** Markdown to insert (a link), or null when cancelled. */
  done(markdown: string | null): void;
}

const WEB = /^(?:https?:\/\/|mailto:)\S+$/i;

export function openLinkPicker(o: PickerOptions): void {
  const box = document.createElement("div");
  box.className = "tn-picker";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search emails by subject or sender, or paste a web address";
  const list = document.createElement("ul");
  box.append(input, list);
  o.container.append(box);
  const host = o.container.getBoundingClientRect();
  box.style.left = `${Math.max(0, Math.min(o.at.left - host.left, host.width - 280))}px`;
  box.style.top = `${o.at.bottom - host.top + 4}px`;

  let items: EmailCandidate[] = [];
  let selected = 0;
  let timer = 0;
  let asked = 0;
  let finished = false;

  const finish = (markdown: string | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    box.remove();
    o.done(markdown);
  };

  const pick = (c: EmailCandidate) => {
    const link = o.label
      ? `[${linkText(o.label)}](${emailLink({ messageId: c.messageId }).replace(/^.*\]\(/, "").replace(/\)$/, "")})`
      : emailLink({ messageId: c.messageId, subject: c.subject, author: c.author, date: c.date });
    finish(link);
  };

  const render = () => {
    list.replaceChildren();
    const text = input.value.trim();
    if (WEB.test(text)) {
      const li = document.createElement("li");
      li.className = "selected";
      li.textContent = `Link to ${text}`;
      li.addEventListener("click", () => finish(o.label ? markdownLink(o.label, text) : (linkForPaste(text, "") ?? text)));
      list.append(li);
      return;
    }
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = text.length >= 2 ? "No emails found" : "Type to search emails…";
      list.append(li);
      return;
    }
    items.forEach((c, i) => {
      const li = document.createElement("li");
      li.className = i === selected ? "selected" : "";
      const subject = document.createElement("div");
      subject.className = "subject";
      subject.textContent = c.subject || "(no subject)";
      const meta = document.createElement("div");
      meta.className = "meta";
      const date = c.date ? new Date(c.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
      meta.textContent = [c.author.replace(/\s*<[^>]*>\s*$/, "").replace(/^"|"$/g, "") || c.author, date, c.folder].filter(Boolean).join(" · ");
      const tags = [c.sameThread && "this conversation", c.hasNotes && "has notes"].filter(Boolean).join(" · ");
      if (tags) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = tags;
        meta.append(" ", tag);
      }
      li.append(subject, meta);
      li.addEventListener("mousedown", (e) => e.preventDefault()); // keep the input's focus
      li.addEventListener("click", () => pick(c));
      list.append(li);
    });
    (list.children[selected] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  };

  const run = () => {
    const text = input.value.trim();
    if (WEB.test(text)) {
      items = [];
      render();
      return;
    }
    const mine = ++asked;
    o.search(text)
      .then((found) => {
        if (mine !== asked || finished) return;
        items = found;
        selected = 0;
        render();
      })
      .catch(() => {});
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(run, 250);
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    // Esc, or Cmd/Ctrl+K again (what opened it): closed, back in the note. Cmd+K left to
    // Thunderbird would jump to its search box and end the editing.
    if (e.key === "Escape" || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey)) {
      e.preventDefault();
      finish(null);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) selected = (selected + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      render();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const text = input.value.trim();
      if (WEB.test(text)) finish(o.label ? markdownLink(o.label, text) : (linkForPaste(text, "") ?? text));
      else if (items[selected]) pick(items[selected]!);
    }
  });
  // Leaving the picker (a click elsewhere) cancels it.
  input.addEventListener("blur", () => setTimeout(() => finish(null), 150));
  box.addEventListener("mousedown", (e) => {
    if (e.target !== input) e.preventDefault();
  });

  render();
  run(); // likely candidates before anything is typed
  input.focus();
}
