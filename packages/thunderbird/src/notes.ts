/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The notes overview (D48): a tab with every note of every email, the newest change first, with
// search and filters by colour and account. A click opens the note on its email, ready to edit;
// links in notes open as everywhere (emails in Thunderbird, web pages in the browser).

import { COLOURS, COLOUR_NAMES, colourOf, darker, messageIdOf, renderMarkdown, rgba, setAlwaysShowYear } from "@thundernotes/core";
import { highlightTerms } from "./filter-expr.js";
import { IGNORED_KEY, ignoredKey, isIgnored, isMissing, type Ignored } from "./deleted.js";
import { changedLabel, collectNotes, filterNotes, type NoteEntry, type NoteFilter } from "./note-list.js";
import { getAllSets } from "./store.js";
import { installCopyMenu } from "./copy-menu.js";

const $ = (id: string) => document.getElementById(id)!;
const search = $("search") as HTMLInputElement;
const accountBox = $("account") as HTMLSelectElement;
const highlightsBox = $("highlights") as HTMLInputElement;

// Right-click (as on the settings page, D47): no browser menu (Back, Reload …); "Copy" with text selected.
installCopyMenu(document, (text) => navigator.clipboard.writeText(text));

// Per-viewer conveniences only (the notes themselves are in the add-on's database).
const PREFS_KEY = "thundernotes-notes";
function loadPrefs(): Partial<Omit<NoteFilter, "text">> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
const prefs = loadPrefs();
const filter: NoteFilter = { text: "", account: prefs.account ?? null, colours: prefs.colours ?? [], highlights: prefs.highlights === true };
function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ account: filter.account, colours: filter.colours, highlights: filter.highlights }));
  } catch {
    // not stored: fine
  }
}

let notes: NoteEntry[] = [];
let missing = new Set<string>();
let accounts: { id: string; name: string }[] = [];

async function load(): Promise<void> {
  // Deleted emails are left alone (D43); emails that can't be found are marked (D44).
  const ignored = ((await messenger.storage.local.get(IGNORED_KEY))[IGNORED_KEY] as Ignored | undefined) ?? {};
  const sets = (await getAllSets()).filter((s) => !isIgnored(ignored, s));
  missing = new Set(sets.filter((s) => isMissing(ignored, s)).map((s) => ignoredKey(s.email.accountId, s.email.messageId)));
  notes = collectNotes(sets);
  render();
}

async function loadAccounts(): Promise<void> {
  accounts = (await messenger.accounts.list(false).catch(() => [])).map((a) => ({ id: a.id, name: a.name }));
  render();
}

const accountName = (id: string | undefined) => accounts.find((a) => a.id === id)?.name ?? "";

function renderControls(): void {
  // Colour dots: none chosen shows all; each click adds or removes one.
  const dots = $("colours");
  dots.classList.toggle("none", !filter.colours.length);
  dots.replaceChildren(
    ...COLOUR_NAMES.map((name) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = `colour${filter.colours.includes(name) ? " on" : ""}`;
      dot.style.background = rgba(colourOf(name), 1);
      dot.title = `Only ${COLOURS[name].label.toLowerCase()} notes (click again to show all)`;
      dot.addEventListener("click", () => {
        filter.colours = filter.colours.includes(name) ? filter.colours.filter((c) => c !== name) : [...filter.colours, name];
        savePrefs();
        render();
      });
      return dot;
    })
  );
  // Accounts: only when notes are in more than one.
  const withNotes = [...new Set(notes.map((n) => n.accountId ?? ""))];
  accountBox.hidden = withNotes.length < 2;
  if (!accountBox.hidden) {
    const options = [["", "All accounts"], ...withNotes.map((id) => [id, accountName(id) || "(unknown account)"])];
    accountBox.replaceChildren(...options.map(([value, label]) => new Option(label, value, false, (filter.account ?? "") === value)));
  }
  if (filter.account !== null && !withNotes.includes(filter.account)) filter.account = null; // its notes are gone
  highlightsBox.checked = filter.highlights;
  search.classList.toggle("active", !!filter.text.trim());
}

function render(): void {
  renderControls();
  const shown = filterNotes(notes, filter);
  const withText = notes.filter((n) => n.md.trim()).length;
  $("count").textContent = shown.length === (filter.highlights ? notes.length : withText) ? `${shown.length}` : `${shown.length} of ${filter.highlights ? notes.length : withText}`;
  const empty = $("empty");
  empty.hidden = shown.length > 0;
  empty.textContent = notes.length ? "No notes match." : "No notes yet. Highlight text in an email, or write a note on it, and it shows here.";
  const several = new Set(notes.map((n) => n.accountId ?? "")).size > 1;
  $("list").replaceChildren(...shown.map((n) => entry(n, several)));
  markHits();
}

function entry(n: NoteEntry, withAccount: boolean): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "note";
  li.tabIndex = 0;
  const colour = colourOf(n.colour);
  const bar = document.createElement("span");
  bar.className = "bar";
  bar.style.background = darker(colour);
  const body = document.createElement("div");
  body.className = "body";
  const text = document.createElement("div");
  text.className = "text";
  if (n.md.trim()) {
    text.innerHTML = renderMarkdown(n.md); // sanitised (DOMPurify)
    for (const a of text.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      a.dataset.href = a.getAttribute("href")!;
      a.title ||= a.dataset.href.replace(/^mid:.*/i, "Open the email");
      a.removeAttribute("href");
    }
  } else {
    text.className = "text only-highlight";
    text.textContent = "Highlight, no note";
  }
  const on = document.createElement("div");
  on.className = "on";
  if (n.quote === undefined) on.textContent = "On the whole email";
  else if (n.quote.startsWith("🖼")) on.textContent = `On the picture ${n.quote.slice(2).trim() === "Picture" ? "" : `“${n.quote.slice(2).trim()}”`}`.trimEnd();
  else {
    const q = document.createElement("q");
    q.textContent = n.quote.replace(/\s+/g, " ").slice(0, 200);
    on.append("On ", q);
  }
  const email = document.createElement("div");
  email.className = "email";
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = changedLabel(n.changed);
  when.title = `Changed ${new Date(n.changed).toLocaleString()}`;
  const subject = document.createElement("span");
  subject.className = "subject";
  subject.textContent = n.subject;
  email.append(when, subject);
  if (n.sender) email.append(` · ${n.sender}`);
  if (n.emailDate) email.append(` · ${new Date(n.emailDate).toLocaleDateString()}`);
  if (withAccount && accountName(n.accountId)) email.append(` · ${accountName(n.accountId)}`);
  if (missing.has(ignoredKey(n.accountId, n.messageId))) {
    const gone = document.createElement("span");
    gone.className = "missing";
    gone.textContent = " – email not found";
    gone.title = "This note's email is not on the server anymore; its notes can be deleted in the settings.";
    email.append(gone);
  }
  body.append(text, on, email);
  li.append(bar, body);
  const open = () => openNote(n);
  li.addEventListener("click", (e) => {
    const link = (e.target as Element).closest<HTMLElement>("a[data-href]");
    if (link) return openUrl(link.dataset.href!);
    open();
  });
  li.addEventListener("keydown", (e) => {
    if (e.key === "Enter") open();
  });
  return li;
}

/** The note on its email, ready to edit (as from the task view, D38). */
function openNote(n: NoteEntry): void {
  void messenger.runtime.sendMessage({ type: "openEmail", accountId: n.accountId, messageId: n.messageId, noteId: n.noteId, line: 0 });
}

/** A link in a note: emails open in Thunderbird, web addresses in the browser. */
function openUrl(url: string): void {
  const messageId = messageIdOf(url);
  if (messageId) void messenger.runtime.sendMessage({ type: "openEmail", messageId });
  else if (/^(?:https?:|mailto:)/i.test(url)) void messenger.windows.openDefaultBrowser(url);
}

/** The searched words marked in the shown notes and their emails' lines. */
function markHits(): void {
  const { words, patterns } = highlightTerms(filter.text);
  if (!words.length && !patterns.length) return;
  const lower = words.map((w) => w.toLowerCase()).filter(Boolean);
  for (const root of document.querySelectorAll<HTMLElement>("#list .text, #list .on q, #list .email .subject")) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) nodes.push(t as Text);
    for (const node of nodes) {
      const data = node.data;
      const hay = data.toLowerCase();
      const ranges: [number, number][] = [];
      for (const w of lower) for (let i = hay.indexOf(w); i !== -1; i = hay.indexOf(w, i + w.length)) ranges.push([i, i + w.length]);
      for (const p of patterns) for (const m of data.matchAll(new RegExp(p.source, p.flags.includes("g") ? p.flags : `${p.flags}g`))) if (m[0]) ranges.push([m.index!, m.index! + m[0].length]);
      if (!ranges.length) continue;
      ranges.sort((a, b) => a[0] - b[0]);
      const parts: (string | HTMLElement)[] = [];
      let at = 0;
      for (const [start, end] of ranges) {
        if (start < at) continue;
        parts.push(data.slice(at, start));
        const mark = document.createElement("mark");
        mark.className = "hit";
        mark.textContent = data.slice(start, end);
        parts.push(mark);
        at = end;
      }
      parts.push(data.slice(at));
      node.replaceWith(...parts);
    }
  }
}

let typing = 0;
search.addEventListener("input", () => {
  clearTimeout(typing);
  typing = window.setTimeout(() => {
    filter.text = search.value;
    render();
  }, 120);
});
accountBox.addEventListener("change", () => {
  filter.account = accountBox.value === "" ? null : accountBox.value;
  savePrefs();
  render();
});
highlightsBox.addEventListener("change", () => {
  filter.highlights = highlightsBox.checked;
  savePrefs();
  render();
});
$("toTasks").addEventListener("click", () => void messenger.runtime.sendMessage({ type: "openTasks" }));
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    search.focus();
    search.select();
  } else if (e.key === "Escape" && document.activeElement === search && search.value) {
    search.value = "";
    filter.text = "";
    render();
  }
});

// Settings that change how dates show.
messenger.storage.local.get("hideCurrentYear").then((s) => setAlwaysShowYear(s.hideCurrentYear === false));
messenger.storage.onChanged.addListener((changes, area) => {
  // An email moved to the Trash or back (D43): its notes go or come back.
  if (area === "local" && IGNORED_KEY in changes) void load();
});

// Notes changed (in an email, by sync, an import): reload, a little later when many change at once.
let reloadTimer = 0;
messenger.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type === "setsChanged") {
    clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => void load(), 200);
    return undefined;
  }
  // Asked whether this tab is open, to bring it to the front instead of opening another.
  if (message?.type === "notesTab") {
    setTimeout(() => search.focus(), 50);
    return messenger.tabs.getCurrent().then((tab) => (tab?.id !== undefined ? { tabId: tab.id, windowId: tab.windowId } : undefined));
  }
  return undefined;
});
// "Yesterday" moves on: redrawn when the tab comes back.
window.addEventListener("focus", () => render());

void load();
void loadAccounts();
search.focus();
