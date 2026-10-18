/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Autocomplete for due dates and labels (D38) while typing: after `@` it offers dates (today,
// tomorrow, weekdays, or what the typed word means: `@fri`, `@morgen`, `@24.10.`), after `#`
// the labels used before (saved notes and this one). The focus stays in the editor: arrow keys choose, Enter or Tab take
// the choice (`@2026-10-24 `, `#label `), Esc closes the list. The list opens only when typing
// (or deleting) in such a word, or with Ctrl+Space (also on macOS) on one; moving the cursor
// onto a date or label doesn't open it, so the arrow keys keep moving through the text.

import { Prec, type EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view";
import { dateSuggestions, formatDue, labelsInText } from "@thundernotes/core";

export interface SuggestOptions {
  container: HTMLElement;
  /** Labels used in notes before (fetched when first needed). */
  knownLabels?(): Promise<string[]>;
  /** Whether a position is in code (no suggestions there). */
  inCode(state: EditorState, pos: number): boolean;
}

interface Item {
  label: string;
  hint: string;
  insert: string;
}

const DATE_WORD = /(^|[^\p{L}\p{N}_@.])@([\p{L}\p{N}.-]*)$/u;
const LABEL_WORD = /(^|[\s([])#([\p{L}\p{N}_/-]*)$/u;

export function suggestions(o: SuggestOptions) {
  let labels: string[] | null = null;
  let loading = false;

  const plugin = ViewPlugin.fromClass(
    class {
      box: HTMLElement | null = null;
      items: Item[] = [];
      selected = 0;
      from = 0;
      to = 0;
      /** Typed in a word (or Ctrl+Space): the list may open; cleared when it closes. */
      armed = false;
      constructor(readonly view: EditorView) {}

      update(u: ViewUpdate) {
        if (u.transactions.some((tr) => tr.isUserEvent("input.type") || tr.isUserEvent("delete"))) this.armed = true;
        if (u.docChanged || u.selectionSet || u.focusChanged) this.refresh();
      }

      refresh() {
        if (!this.armed) return;
        const { state } = this.view;
        const r = state.selection.main;
        if (!r.empty || !this.view.hasFocus || o.inCode(state, r.head)) return this.close();
        const line = state.doc.lineAt(r.head);
        const before = line.text.slice(0, r.head - line.from);
        let m = DATE_WORD.exec(before);
        if (m) {
          const word = m[2]!;
          this.from = r.head - word.length - 1;
          this.to = r.head + /^[\p{L}\p{N}.-]*/u.exec(line.text.slice(r.head - line.from))![0].length; // the whole word, also after the cursor
          this.items = dateSuggestions(word).map((s) => ({ label: formatDue(s.iso), hint: s.hint === word ? s.iso : s.hint, insert: `@${s.iso} ` }));
          return this.items.length ? this.show() : this.close();
        }
        m = LABEL_WORD.exec(before);
        // "#" alone at the start of a line is more likely a heading being typed.
        if (m && !(m[2] === "" && before.trim() === "#")) {
          const word = m[2]!.toLowerCase();
          this.from = r.head - m[2]!.length - 1;
          this.to = r.head + /^[\p{L}\p{N}_/-]*/u.exec(line.text.slice(r.head - line.from))![0].length;
          // Saved notes' labels load once; meanwhile this note's own labels already show.
          if (!labels && !loading && o.knownLabels) {
            loading = true;
            o.knownLabels()
              .then((l) => {
                labels = l;
                this.refresh();
              })
              .catch(() => (labels = []));
          }
          // Also labels used in this note so far (not saved yet), except the one being typed.
          const typed = state.doc.sliceString(this.from, this.to);
          const here = labelsInText(state.doc.sliceString(0, this.from) + " " + state.doc.sliceString(this.to)).filter((l) => `#${l}` !== typed);
          // One per label regardless of case: the spelling of those used before, else as in this note.
          const seen = new Set<string>();
          this.items = [...(labels ?? []), ...here]
            .filter((l) => !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
            .filter((l) => l.toLowerCase() !== word && (l.toLowerCase().startsWith(word) || (word.length >= 2 && l.toLowerCase().includes(word))))
            .slice(0, 8)
            .map((l) => ({ label: `#${l}`, hint: "", insert: `#${l} ` }));
          return this.items.length ? this.show() : this.close();
        }
        this.close();
      }

      show() {
        this.selected = Math.min(this.selected, this.items.length - 1);
        if (!this.box) {
          this.box = document.createElement("ul");
          this.box.className = "tn-suggest";
          this.box.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor's focus
          o.container.append(this.box);
        }
        this.box.replaceChildren(
          ...this.items.map((item, i) => {
            const li = document.createElement("li");
            li.className = i === this.selected ? "selected" : "";
            li.textContent = item.label;
            if (item.hint) {
              const hint = document.createElement("span");
              hint.className = "hint";
              hint.textContent = item.hint;
              li.append(hint);
            }
            li.addEventListener("click", () => {
              this.selected = i;
              this.accept();
            });
            return li;
          })
        );
        // Placed in the editor's measure phase: during an update the layout isn't current yet,
        // and the list showed up elsewhere until the next key.
        const from = this.from;
        this.view.requestMeasure({
          read: (view) => {
            let at: { left: number; bottom: number } | null = null;
            try {
              at = view.coordsAtPos(from);
            } catch {
              // no layout (tests)
            }
            return { at, host: o.container.getBoundingClientRect() };
          },
          write: ({ at, host }) => {
            if (!this.box) return;
            this.box.style.left = `${Math.max(0, (at?.left ?? host.left) - host.left)}px`;
            this.box.style.top = `${(at?.bottom ?? host.top) - host.top + 2}px`;
            // The chosen entry stays in view: the message scrolls along when the list reaches
            // below the bottom of the window.
            (this.box.children[this.selected] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
          },
        });
      }

      close() {
        this.box?.remove();
        this.box = null;
        this.items = [];
        this.selected = 0;
        this.armed = false;
      }

      /** Ctrl+Space: the list for the word at the cursor. */
      open() {
        this.armed = true;
        this.refresh();
      }

      move(by: number) {
        this.selected = (this.selected + by + this.items.length) % this.items.length;
        this.show();
      }

      accept() {
        const item = this.items[this.selected];
        if (!item) return;
        const { from, to } = this;
        this.close();
        // The space after it only when a word could follow: none before a space, a closing
        // bracket (e.g. the "]" of a link's text) or punctuation. At the end of a line it gets
        // one (the cursor stays on the line; skipping the line break moved it to the next line).
        const next = this.view.state.sliceDoc(to, to + 1);
        const insert = /^[ \t\])}>,.;:!?"'’”»]/.test(next) ? item.insert.trimEnd() : item.insert;
        const anchor = from + insert.length + (insert !== item.insert && /^[ \t]/.test(next) ? 1 : 0);
        this.view.dispatch({ changes: { from, to, insert }, selection: { anchor }, userEvent: "input.complete" });
        this.view.focus();
      }

      destroy() {
        this.close();
      }
    }
  );

  const active = (view: EditorView) => {
    const p = view.plugin(plugin);
    return p && p.items.length ? p : null;
  };

  return [
    plugin,
    // Before the editor's own keys (Enter continues lists, Esc discards, Tab indents).
    Prec.highest(
      keymap.of([
        { key: "ArrowDown", run: (v) => (active(v) ? (active(v)!.move(1), true) : false) },
        { key: "ArrowUp", run: (v) => (active(v) ? (active(v)!.move(-1), true) : false) },
        { key: "Enter", run: (v) => (active(v) ? (active(v)!.accept(), true) : false) },
        { key: "Tab", run: (v) => (active(v) ? (active(v)!.accept(), true) : false) },
        { key: "Escape", run: (v) => (active(v) ? (active(v)!.close(), true) : false) },
        { key: "Ctrl-Space", run: (v) => (v.plugin(plugin)?.open(), true) },
      ])
    ),
  ];
}
