/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// ThunderNotes background (event page). Owns the annotation store; the message
// display script asks it for the displayed email's annotations and sends changes.

import {
  COLOURS,
  COLOUR_NAMES,
  deleteAnnotation,
  deleteEmailNote,
  gcTombstones,
  hasContent,
  restorable,
  restoreDeleted,
  purgeDeleted,
  setAlwaysShowYear,
  setTaskDone,
  editTask,
  taskAt,
  senderName,
  type TaskEdit,
  emailLink,
  labelsIn,
  preferredSpellings,
  linkedMessageIds,
  messageIdOf,
  renderMarkdown,
  type Annotation,
  type ColourName,
  type LabelOrderMode,
  type TextQuoteSelector,
  type AnnotationSet,
  type EmailRef,
} from "@thundernotes/core";
import { EMAIL_NOTE_ID, type Backlink, type EmailCandidate, type ContextInfo, type Responses, type ToBackground, type ToContent } from "./protocol.js";
import { deleteSet, getAllSets, getSet, onSetsChanged, putSet } from "./store.js";
import { addressOf, collectTasks, emailInfoOf, groupOf, noteAsMarkdown, notesAsMarkdown, taskAsMarkdown, type EmailInfo } from "./task-list.js";
import { setCounters } from "./badges.js";
import { CARRIER_FOLDER, type LostFolder, deleteUnreadable, setLabelColour, setLabelOrder, isCarrierFolder, syncProblems, syncStatus, isImapAccount, pull, pullAll, schedulePush, setSyncHooks } from "./sync.js";
import { TAG_KEY, retagFolders, tagCopies } from "./tags.js";

const SCRIPT_ID = "thundernotes-display";
const MENU_HIGHLIGHT = "thundernotes-highlight";
const MENU_DEBUG = "thundernotes-debug";
const MENU_REMOVE = "thundernotes-remove";
const MENU_RETAG = "thundernotes-retag";
const MENU_COLOUR = "thundernotes-colour";
const MENU_COPY_LINK = "thundernotes-copy-link";
const MENU_NOTE = "thundernotes-note";
const MENU_COPY_ALL = "thundernotes-copy-all";
const colourMenuId = (name: string) => `${MENU_COLOUR}-${name}`;

/** Debug mode: colour highlights by match type. Kept in storage.local. */
async function getDebug(): Promise<boolean> {
  const { debugMatchTypes } = await messenger.storage.local.get("debugMatchTypes");
  return debugMatchTypes === true;
}

/** The setting "Show developer functions" (off by default). */
async function developerFunctions(): Promise<boolean> {
  const { developerFunctions } = await messenger.storage.local.get("developerFunctions");
  return developerFunctions === true;
}

// Developer functions switched on or off: the debug item shows or goes; switched off, the match
// types are switched off too (else they would stay on with no way to switch them off).
messenger.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("developerFunctions" in changes)) return;
  const on = changes.developerFunctions!.newValue === true;
  void (async () => {
    if (!on && (await getDebug())) {
      await messenger.storage.local.set({ debugMatchTypes: false });
      await messenger.menus.update(MENU_DEBUG, { checked: false });
      const message: ToContent = { type: "setDebug", on: false };
      for (const tab of await messenger.tabs.query({})) if (tab.id !== undefined) messenger.tabs.sendMessage(tab.id, message).catch(() => {});
    }
    await messenger.menus.update(MENU_DEBUG, { visible: on });
  })().catch(console.error);
});

async function ensureDisplayScript(): Promise<void> {
  const registered = await messenger.scripting.messageDisplay.getRegisteredScripts({ ids: [SCRIPT_ID] });
  if (!registered.length) {
    await messenger.scripting.messageDisplay.registerScripts([
      { id: SCRIPT_ID, js: ["dist/content.js"], css: ["content.css"] },
    ]);
  }
}
ensureDisplayScript().catch((e) => console.error("ThunderNotes: registering display script failed", e));

// Menus are (re)created whenever the background starts: runtime.onInstalled may not
// fire when a temporary add-on is reloaded.
async function createMenus(): Promise<void> {
  await messenger.menus.removeAll();
  messenger.menus.create({ id: MENU_HIGHLIGHT, title: "Highlight", contexts: ["selection"], visible: false });
  messenger.menus.create({ id: MENU_NOTE, title: "Add note", contexts: ["page", "link", "selection"], visible: false });
  messenger.menus.create({
    id: MENU_REMOVE,
    title: "Remove highlight",
    contexts: ["page", "link", "selection"],
    visible: false,
  });
  // Colour submenu on a highlight (D29), one radio item per palette colour.
  messenger.menus.create({ id: MENU_COLOUR, title: "Colour", contexts: ["page", "link", "selection"], visible: false });
  for (const name of COLOUR_NAMES) {
    messenger.menus.create({
      id: colourMenuId(name),
      parentId: MENU_COLOUR,
      // Only shown when text is selected over a highlight: a plain right-click on a highlight opens
      // the add-on's own menu with colour dots (content.ts); Thunderbird shows no icons here.
      // The current colour is marked "✓" in its title (onShown).
      title: COLOURS[name].label,
      contexts: ["page", "link", "selection"],
    });
  }
  messenger.menus.create({
    id: MENU_RETAG,
    title: "Update ThunderNotes tags",
    contexts: ["folder_pane"],
  });
  // A link to the email for a note (D37): [Subject – Sender, date](mid:…), one per selected email.
  messenger.menus.create({ id: MENU_COPY_LINK, title: "Copy ThunderNotes link", contexts: ["message_list"] });
  // In the email (not on a highlight or a note: those have their own menus) and on the header button.
  messenger.menus.create({ id: MENU_COPY_ALL, title: "Copy all notes as Markdown", contexts: ["page", "link", "selection"], visible: false });
  messenger.menus.create({ id: `${MENU_COPY_ALL}-action`, title: "Copy all notes as Markdown", contexts: ["message_display_action"], visible: false });
  // Developer functions (a setting, off by default): only then on the header button's menu.
  // (Export / import is in the button's popup.)
  messenger.menus.create({
    id: MENU_DEBUG,
    type: "checkbox",
    checked: await getDebug(),
    title: "Show match types (debug)",
    contexts: ["message_display_action"],
    visible: await developerFunctions(),
  });
}
createMenus().catch((e) => console.error("ThunderNotes: creating menus failed", e));

/** Context-menu contexts inside a displayed message where our items may apply. */
const MESSAGE_CONTEXTS = new Set(["page", "link", "selection", "editable"]);

// Right-click: the display script says what was clicked. Highlight only for a selection
// in the email body; Remove highlight / Remove note only on a highlight or card; none of
// our items inside a note's text box. (info.menuIds lists only items already visible, so
// it can't be used to detect ours.)
messenger.menus.onShown.addListener(async (info, tab) => {
  // The header button's menu: "Copy all notes as Markdown" only for an email with notes.
  if (info.contexts.includes("message_display_action")) {
    const message: ToContent = { type: "contextTarget" };
    const context = tab?.id !== undefined ? await messenger.tabs.sendMessage<ContextInfo>(tab.id, message).catch(() => null) : null;
    await messenger.menus.update(`${MENU_COPY_ALL}-action`, { visible: !!context?.hasNotes });
    await messenger.menus.refresh();
    return;
  }
  if (!info.contexts.some((c) => MESSAGE_CONTEXTS.has(c))) return;
  let context: ContextInfo | null = null;
  if (tab?.id !== undefined) {
    const message: ToContent = { type: "contextTarget" };
    context = await messenger.tabs.sendMessage<ContextInfo>(tab.id, message).catch(() => null);
  }
  await messenger.menus.update(MENU_HIGHLIGHT, { visible: !!context?.selectionInBody && !context.inEditor });
  const onHighlight = !!context?.target && !context.inEditor;
  await messenger.menus.update(MENU_COLOUR, { visible: onHighlight });
  if (onHighlight) {
    for (const name of COLOUR_NAMES) {
      await messenger.menus.update(colourMenuId(name), {
        title: `${COLOURS[name].label}${context!.target!.colour === name ? "  ✓" : ""}`,
      });
    }
  }
  await messenger.menus.update(MENU_COPY_ALL, { visible: !!context?.hasNotes && !context.inEditor });
  await messenger.menus.update(MENU_NOTE, { visible: onHighlight, title: context?.target?.hasNote ? "Edit note" : "Add note" });
  await messenger.menus.update(MENU_REMOVE, {
    visible: !!context?.target && !context.inEditor,
    title: context?.target?.hasNote ? "Delete note and highlight" : "Remove highlight",
  });
  await messenger.menus.refresh();
});

messenger.menus.onClicked.addListener((info, tab) => {
  const colour = String(info.menuItemId).startsWith(`${MENU_COLOUR}-`) ? String(info.menuItemId).slice(MENU_COLOUR.length + 1) : null;
  if (colour && tab?.id !== undefined) {
    const message: ToContent = { type: "colourTarget", colour };
    messenger.tabs.sendMessage(tab.id, message).catch((e) => console.warn("ThunderNotes: colour failed", e));
    return;
  }
  if (info.menuItemId === MENU_COPY_LINK) {
    const links = (info.selectedMessages?.messages ?? []).map((m) =>
      emailLink({ messageId: m.headerMessageId, subject: m.subject, author: m.author, date: m.date })
    );
    if (!links.length) return;
    void (async () => {
      await navigator.clipboard.writeText(links.join("\n")).catch((e) => console.error("ThunderNotes: copying the link failed", e));
      // A note being edited in this tab gets the focus straight back, ready to paste.
      const message: ToContent = { type: "isEditing" };
      const editing = tab?.id !== undefined && (await messenger.tabs.sendMessage<boolean>(tab.id, message).catch(() => false));
      if (editing) await messenger.thundernotes.focusMessagePane().catch(() => false);
    })();
    return;
  }
  if ((info.menuItemId === MENU_COPY_ALL || info.menuItemId === `${MENU_COPY_ALL}-action`) && tab?.id !== undefined) {
    const message: ToContent = { type: "copyAllNotes" };
    messenger.tabs.sendMessage(tab.id, message).catch((e) => console.warn("ThunderNotes: copying notes failed", e));
    return;
  }
  if (info.menuItemId === MENU_RETAG) {
    retag(info.selectedFolders ?? [], tab?.windowId).catch((e) => console.error("ThunderNotes: updating tags failed", e));
    return;
  }
  if (info.menuItemId === MENU_REMOVE && tab?.id !== undefined) {
    const message: ToContent = { type: "removeTarget" };
    messenger.tabs.sendMessage(tab.id, message).catch((e) => console.warn("ThunderNotes: remove failed", e));
    return;
  }
  if (info.menuItemId === MENU_NOTE && tab?.id !== undefined) {
    const message: ToContent = { type: "noteTarget" };
    messenger.tabs.sendMessage(tab.id, message).catch((e) => console.warn("ThunderNotes: note failed", e));
    return;
  }
  if (info.menuItemId === MENU_DEBUG) {
    const on = info.checked === true;
    messenger.storage.local.set({ debugMatchTypes: on });
    if (tab?.id !== undefined) {
      const message: ToContent = { type: "setDebug", on };
      messenger.tabs.sendMessage(tab.id, message).catch(() => {});
    }
    return;
  }
  if (info.menuItemId !== MENU_HIGHLIGHT || tab?.id === undefined) return;
  const message: ToContent = { type: "highlightSelection" };
  messenger.tabs.sendMessage(tab.id, message).catch((e) => console.warn("ThunderNotes: menu highlight failed", e));
});

/** The email shown in a tab: its reference (D2) and Thunderbird's message id. */
interface Displayed {
  email: EmailRef;
  tabId: number;
  /** Thunderbird's id of the displayed copy, for tagging. */
  tbId: number;
  /** Tags of the displayed copy. */
  tags: string[];
  /** The message is a ThunderNotes carrier (D27): no highlighting, a cover instead. */
  carrier: boolean;
}

/** A request from an email the tab no longer shows: that email, found by its Message-ID. */
async function displayedAs(shown: Displayed, messageId: string): Promise<Displayed> {
  const { messages } = await messenger.messages.query({ headerMessageId: messageId });
  const header = messages[0];
  if (!header) throw new Error(`ThunderNotes: email ${messageId} not found`);
  return { ...fromHeader(header), tabId: shown.tabId };
}

async function displayed(tabId: number): Promise<Displayed> {
  const { messages } = await messenger.messageDisplay.getDisplayedMessages(tabId);
  const header = messages[0];
  if (!header) throw new Error("No message displayed in this tab");
  return { ...fromHeader(header), tabId };
}

function fromHeader(header: tb.MessageHeader): Omit<Displayed, "tabId"> {
  const email: EmailRef = {
    messageId: header.headerMessageId,
    subject: header.subject,
    from: header.author,
    date: new Date(header.date).toISOString(),
    folderHint: header.folder?.path,
    accountId: header.folder?.accountId,
  };
  return { email, tbId: header.id, tags: header.tags ?? [], carrier: isCarrierFolder(header.folder) };
}

/** Folder pane → "Update ThunderNotes tags": tag exactly the emails ThunderNotes has notes for. */
async function retag(folders: tb.MailFolder[], windowId?: number): Promise<void> {
  if (!folders.length) return;
  const ids = new Set(
    (await getAllSets()).filter(hasContent).map((s) => s.email.messageId)
  );
  let params: URLSearchParams;
  try {
    const r = await retagFolders(folders, ids);
    params = new URLSearchParams({
      folders: folders.map((f) => f.name ?? f.path).join(", "),
      checked: String(r.checked),
      tagged: String(r.tagged),
      untagged: String(r.untagged),
    });
  } catch (e) {
    params = new URLSearchParams({ error: (e as Error).message });
  }
  const size = { width: 420, height: 190 };
  // Centred over the Thunderbird window the user clicked in, so it opens on that screen
  // (without a position the system uses the main screen).
  const parent = windowId !== undefined ? await messenger.windows.get(windowId).catch(() => null) : null;
  const position =
    parent?.left !== undefined && parent.top !== undefined && parent.width && parent.height
      ? {
          left: Math.round(parent.left + (parent.width - size.width) / 2),
          top: Math.round(parent.top + (parent.height - size.height) / 2),
        }
      : {};
  await messenger.windows.create({ url: `result.html?${params}`, type: "popup", ...size, ...position });
}

/** Keeps the `$Annotated` tag in step with the email's annotations; never blocks saving. */
/** The tag on the displayed email and all its other copies (D2: they share the notes). */
function tagAnnotated(d: Displayed, on: boolean): void {
  tagCopies(d.email.messageId, on, CARRIER_FOLDER).catch((e) => console.warn("ThunderNotes: tagging failed", e));
}

function newSet(email: EmailRef, now: string): AnnotationSet {
  return { version: 1, email, rev: 0, created: now, updated: now, annotations: [] };
}

/** This device's name in conflict boxes (D32): the setting, else the Experiment's default. */
async function deviceName(): Promise<string> {
  const { deviceName: stored } = await messenger.storage.local.get("deviceName");
  if (typeof stored === "string" && stored.trim()) return stored.trim();
  return (await messenger.thundernotes.deviceName().catch(() => "")) || "This computer";
}

function touch(set: AnnotationSet, now: string): AnnotationSet {
  return { ...set, rev: set.rev + 1, updated: now };
}

type Handler<K extends ToBackground["type"]> = (
  request: Extract<ToBackground, { type: K }>,
  displayed: Displayed
) => Promise<Responses[K]>;

/** Stores a changed set and schedules its sync (D27). */
async function save(set: AnnotationSet): Promise<void> {
  await putSet(set);
  schedulePush(set.email.messageId);
}

/**
 * A set that lost its last annotation and note. It is kept for its tombstones: on IMAP
 * accounts so the deletion reaches other devices, everywhere so it can be restored for
 * 30 days (D33). A local set with nothing to restore is simply removed.
 */
async function saveEmptied(set: AnnotationSet, d: Displayed): Promise<AnnotationSet | null> {
  tagAnnotated(d, false);
  const deleted = restorable(set);
  if ((await isImapAccount(set.email.accountId)) || deleted.annotations.length || deleted.emailNote !== null) {
    await save(set);
    return set;
  }
  await deleteSet(set.email.messageId);
  return null;
}

/** The stored set, with the account filled in for sets made before sync existed. */
async function storedSet(d: Displayed): Promise<AnnotationSet | null> {
  let set = await getSet(d.email.messageId);
  if (set && !set.email.accountId && d.email.accountId) {
    set.email = { ...set.email, accountId: d.email.accountId };
    await save(set);
  }
  // Local accounts: deleted copies expire here (IMAP sets expire in sync, D27).
  if (set && !(await isImapAccount(set.email.accountId))) {
    const gced = gcTombstones(set);
    if (gced !== set) {
      const deleted = restorable(gced);
      if (!hasContent(gced) && !deleted.annotations.length && deleted.emailNote === null) {
        await deleteSet(gced.email.messageId);
        return null;
      }
      await putSet(gced);
      set = gced;
    }
  }
  return set;
}

// Folded cards (D30): always remembered on this device (storage key FOLDED_KEY, entries
// "<Message-ID> <card id>"); with the setting SYNC_FOLDED_KEY also in the set, so they sync.
const FOLDED_KEY = "foldedCards";
const SYNC_FOLDED_KEY = "syncFolded";

async function foldPrefs(): Promise<{ local: Record<string, boolean>; sync: boolean }> {
  const s = await messenger.storage.local.get([FOLDED_KEY, SYNC_FOLDED_KEY]);
  return { local: (s[FOLDED_KEY] as Record<string, boolean> | undefined) ?? {}, sync: s[SYNC_FOLDED_KEY] === true };
}

/** The folded cards of one email: the synced choice when syncing and known, else this device's. */
async function foldedIds(set: AnnotationSet | null, messageId: string): Promise<string[]> {
  const { local, sync } = await foldPrefs();
  const prefix = `${messageId} `;
  const ids = new Set(Object.keys(local).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
  if (sync) for (const id of Object.keys(set?.folded ?? {})) ids.add(id);
  return [...ids].filter((id) => {
    const synced = sync ? set?.folded?.[id] : undefined;
    return synced ? synced.folded : local[prefix + id] === true;
  });
}

/** An email referenced in a copied note (D38): looked up in Thunderbird by Message-ID. */
async function lookupEmail(messageId: string): Promise<EmailInfo | null> {
  const id = messageId.replace(/^<|>$/g, "");
  const header = (await messenger.messages.query({ headerMessageId: id }).catch(() => null))?.messages[0];
  if (!header) return null;
  return { subject: header.subject ?? "", name: senderName(header.author) || header.author || "", address: addressOf(header.author), date: header.date ? new Date(header.date).toISOString() : undefined };
}

const handlers: { [K in ToBackground["type"]]: Handler<K> } = {
  async load(_request, d) {
    const prefs = await messenger.storage.local.get(["marginCollapsed", "marginWidth"]);
    const marginCollapsed = prefs.marginCollapsed === true;
    const marginWidth = typeof prefs.marginWidth === "number" ? prefs.marginWidth : null;
    if (d.carrier) return { set: null, debug: false, marginCollapsed: true, marginWidth, carrier: true, folded: [], ref: d.email.messageId };
    const set = await storedSet(d);
    // A tag without notes is stale (e.g. the add-on was removed and its database deleted).
    // The reverse is never "fixed" on display: a tag the user removed stays removed.
    if (!hasContent(set) && d.tags.includes(TAG_KEY)) tagAnnotated(d, false);
    const folded = await foldedIds(set, d.email.messageId);
    const focus = pendingFocus.get(d.email.messageId);
    pendingFocus.delete(d.email.messageId);
    return { set, debug: await getDebug(), marginCollapsed, marginWidth, carrier: false, folded, ref: d.email.messageId, focus };
  },

  async add({ annotation }, d) {
    const now = new Date().toISOString();
    const set = (await storedSet(d)) ?? newSet(d.email, now);
    // Per-part times and the writing device (D32).
    const stamped: Annotation = { ...annotation, textUpdated: annotation.created, textBy: await deviceName() };
    if (annotation.colour) stamped.colourUpdated = annotation.created;
    const updated = touch({ ...set, annotations: [...set.annotations, stamped] }, now);
    await save(updated);
    tagAnnotated(d, true);
    return updated;
  },

  async remove({ id }, d) {
    const set = await storedSet(d);
    if (!set) return null;
    const next = deleteAnnotation(set, id);
    if (!hasContent(next)) return saveEmptied(next, d);
    await save(next);
    return next;
  },

  async update({ id, bodyMd }, d) {
    const set = await storedSet(d);
    const now = new Date().toISOString();
    if (!set?.annotations.some((a) => a.id === id)) throw new Error("Highlight not found");
    const by = await deviceName();
    const annotations = set.annotations.map((a) => (a.id === id ? { ...a, bodyMd, updated: now, textUpdated: now, textBy: by } : a));
    const updated = touch({ ...set, annotations }, now);
    await save(updated);
    return updated;
  },

  async setColour({ id, colour }, d) {
    const set = await storedSet(d);
    const now = new Date().toISOString();
    if (id === EMAIL_NOTE_ID) {
      // Also before the note is first saved (colour chosen while writing it).
      const base = set ?? newSet(d.email, now);
      const next: AnnotationSet = { ...touch({ ...base }, now), emailNoteColour: colour, emailNoteColourUpdated: now };
      await save(next);
      return next;
    }
    if (!set?.annotations.some((a) => a.id === id)) throw new Error("Highlight not found");
    const annotations = set.annotations.map((a) => (a.id === id ? { ...a, colour, updated: now, colourUpdated: now } : a));
    const updated = touch({ ...set, annotations }, now);
    await save(updated);
    return updated;
  },

  async setFolded({ id, folded }, d) {
    const { local, sync } = await foldPrefs();
    const key = `${d.email.messageId} ${id}`;
    if (folded) local[key] = true;
    else delete local[key];
    await messenger.storage.local.set({ [FOLDED_KEY]: local });
    const set = await storedSet(d);
    if (!sync || !set) return null;
    // Not the annotation's `updated`: folding must never win over a note edited elsewhere.
    const now = new Date().toISOString();
    const next = touch({ ...set, folded: { ...set.folded, [id]: { folded, at: now } } }, now);
    await save(next);
    return next;
  },

  async purgeDeleted(_request, d) {
    const set = await storedSet(d);
    if (!set) return null;
    const next = purgeDeleted(set);
    // Nothing left at all (no notes, nothing to restore): the set goes, as after deleting the last note.
    if (!hasContent(next)) return saveEmptied(next, d);
    await save(next);
    return next;
  },

  async restoreDeleted(_request, d) {
    const set = await storedSet(d);
    if (!set) return null;
    const next = restoreDeleted(set);
    if (next === set) return set;
    await save(next);
    tagAnnotated(d, hasContent(next));
    return next;
  },

  async setEmailNote({ md }, d) {
    const now = new Date().toISOString();
    const set = (await storedSet(d)) ?? newSet(d.email, now);
    // Emptied: deleted, with a copy kept for restoring (D33).
    const next: AnnotationSet = md.trim()
      ? { ...touch({ ...set }, now), emailNoteUpdated: now, emailNoteBy: await deviceName(), emailNoteMd: md.trim() }
      : deleteEmailNote(set, now);
    if (!hasContent(next)) return saveEmptied(next, d);
    await save(next);
    tagAnnotated(d, true);
    return next;
  },

  async render({ md }) {
    return renderMarkdown(md);
  },

  // The display script can't use navigator.clipboard (message documents aren't a secure context).
  async readClipboard() {
    return navigator.clipboard.readText();
  },

  async writeClipboard({ text }) {
    await navigator.clipboard.writeText(text);
  },

  async copyMarkdown(request, d) {
    const set = await storedSet(d);
    const email = emailInfoOf(set?.email ?? d.email);
    const quoteOf = (id: string) => set?.annotations.find((a) => a.id === id)?.selectors.find((s): s is TextQuoteSelector => s.type === "TextQuoteSelector")?.exact;
    let text = "";
    if (request.what === "task") {
      const task = taskAt(request.md, request.line);
      if (!task?.text) return false;
      text = await taskAsMarkdown(
        { ...task, children: [], childrenDone: 0, messageId: d.email.messageId, noteId: request.id, noteMd: request.md, subject: email.subject, sender: email.name, senderAddress: email.address, emailDate: email.date },
        lookupEmail,
      ) + "\n";
    } else if (request.what === "note") {
      const quote = request.id === EMAIL_NOTE_ID ? undefined : quoteOf(request.id);
      if (!request.md.trim()) return false; // a plain highlight: nothing to copy
      text = await noteAsMarkdown({ quote, md: request.md }, email, lookupEmail);
    } else {
      if (!set) return false;
      const byId = new Map(set.annotations.map((a) => [a.id, a]));
      const notes = request.order.flatMap((id) => (byId.has(id) ? [{ quote: quoteOf(id), md: byId.get(id)!.bodyMd }] : []));
      text = await notesAsMarkdown(email, set.emailNoteMd ?? "", notes, lookupEmail);
    }
    await navigator.clipboard.writeText(text);
    return true;
  },

  async openLink({ url }) {
    const messageId = messageIdOf(url);
    if (messageId) await openEmail(messageId);
    else if (/^(?:https?:|mailto:)/i.test(url)) await messenger.windows.openDefaultBrowser(url);
  },

  async backlinks(_request, d) {
    return backlinksOf(d.email.messageId);
  },

  async searchEmails({ query }, d) {
    return searchEmails(query, d.email);
  },

  async labels() {
    // All notes on this device, most used label first (D38).
    // One entry per label regardless of case, in its preferred spelling (the most written).
    const occurrences: string[] = [];
    for (const set of await getAllSets()) {
      for (const md of [set.emailNoteMd ?? "", ...set.annotations.map((a) => a.bodyMd)]) occurrences.push(...labelsIn(md));
    }
    const count = new Map<string, number>();
    for (const l of occurrences) count.set(l.toLowerCase(), (count.get(l.toLowerCase()) ?? 0) + 1);
    const spelling = preferredSpellings(occurrences);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => spelling.get(key)!);
  },

  async setLabelColour({ label, colour }) {
    await setLabelColour(label, (colour as ColourName | null) ?? null);
  },

  async focusPane() {
    await messenger.thundernotes.focusMessagePane().catch(() => false);
  },

  async setPref({ key, value }) {
    await messenger.storage.local.set({ [key]: value });
  },

  async status(request, d) {
    const status = { ...request, linkedFrom: (await backlinksOf(d.email.messageId)).length };
    lastStatus.set(d.tabId, status);
    await showStatus(d.tabId, status);
  },
};

/** The header button of each tab, as last reported, so a sync warning can be added later (D35). */
type ShownStatus = Extract<ToBackground, { type: "status" }> & { linkedFrom?: number };
const lastStatus = new Map<number, ShownStatus>();

// ---- task view (D38) ----------------------------------------------------------------------------

/** Messages from the add-on's own pages (popup, options, task view). */
type FromPages =
  | { type: "syncNow" }
  | { type: "syncProblems" }
  | { type: "syncStatus" }
  | { type: "deleteUnreadable"; accountId: string; id: string }
  | { type: "openEmail"; messageId: string; noteId?: string; line?: number }
  | { type: "openTasks" }
  | { type: "setsChanged" }
  | { type: "setLabelColour"; label: string; colour: string | null }
  | { type: "setLabelOrder"; mode: LabelOrderMode; custom?: string[] }
  | TaskEditRequest
  | TaskDone;

type TaskDone = { type: "setTaskDone"; messageId: string; noteId: string; line: number; raw: string; done: boolean };

/** Opens the task view, or brings it to the front if it is open already (it answers "tasksTab"). */
async function openTasks(): Promise<void> {
  const open = await messenger.runtime.sendMessage<{ tabId: number; windowId: number } | undefined>({ type: "tasksTab" }).catch(() => undefined);
  if (open) {
    await messenger.tabs.update(open.tabId, { active: true });
    await messenger.windows.update(open.windowId, { focused: true });
  } else {
    // As the space's tab, so the toolbar button and the space button lead to the same tab.
    const space = await tasksSpace;
    if (space !== null) await messenger.spaces.open(space);
    else await messenger.tabs.create({ url: "tasks.html" });
  }
  // The keyboard focus into the page (else it stays in the toolbar: the arrow keys did nothing).
  await messenger.thundernotes.focusCurrentTab().catch(() => false);
}

/** Ticks or unticks a task in the task view: the note changes as if edited (synced, redrawn). False if it's gone. */
async function tickTask({ messageId, noteId, line, raw, done }: TaskDone): Promise<boolean> {
  return !!(await changeNote(messageId, noteId, (md) => setTaskDone(md, { line, raw }, done)));
}

type TaskEditRequest = { type: "editTask"; messageId: string; noteId: string; line: number; raw: string; edit: TaskEdit };

/** A quick change from the task view (D38): the task's lines before and after, for undo; null if it's gone. */
async function editTaskLine({ messageId, noteId, line, raw, edit }: TaskEditRequest): Promise<{ before: string[]; after: string[] } | null> {
  let result: ReturnType<typeof editTask> = null;
  const ok = await changeNote(messageId, noteId, (md) => (result = editTask(md, { line, raw }, edit))?.md ?? null);
  return ok && result ? { before: (result as { before: string[] }).before, after: (result as { after: string[] }).after } : null;
}

/** A note's text changed from the task view, as if edited in the email (D32: time and device; synced, redrawn). */
async function changeNote(messageId: string, noteId: string, change: (md: string) => string | null): Promise<boolean> {
  const set = await getSet(messageId);
  if (!set) return false;
  const now = new Date().toISOString();
  const by = await deviceName();
  let next: AnnotationSet;
  if (noteId === EMAIL_NOTE_ID) {
    const md = change(set.emailNoteMd ?? "");
    if (md === null) return false;
    next = { ...touch({ ...set }, now), emailNoteMd: md, emailNoteUpdated: now, emailNoteBy: by };
  } else {
    const note = set.annotations.find((a) => a.id === noteId);
    const md = note ? change(note.bodyMd) : null;
    if (!note || md === null) return false;
    const annotations = set.annotations.map((a) => (a.id === noteId ? { ...a, bodyMd: md, updated: now, textUpdated: now, textBy: by } : a));
    next = touch({ ...set, annotations }, now);
  }
  await save(next);
  void refreshOpenMessages();
  return true;
}

messenger.action.onClicked.addListener(() => void openTasks());

// The setting "Hide the current year in dates" (on by default) for the notes rendered here;
// open emails draw again when it changes.
messenger.storage.local.get("hideCurrentYear").then((s) => setAlwaysShowYear(s.hideCurrentYear === false));
messenger.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("hideCurrentYear" in changes)) return;
  setAlwaysShowYear(changes.hideCurrentYear!.newValue === false);
  void refreshOpenMessages();
});

/**
 * The task view as a space too: its icon in the spaces toolbar on the left of the main window, like
 * Mail, Calendar and Tasks. Spaces go when the add-on does; after a background restart the one
 * made before is used. Null if Thunderbird refuses (the toolbar button still works).
 */
const TASKS_SPACE = "thundernotes_tasks";
const TASKS_URL = messenger.runtime.getURL("tasks.html");
const tasksSpace: Promise<number | null> = (async () => {
  const button: tb.SpaceButtonProperties = { title: "ThunderNotes Tasks", defaultIcons: "icons/tasks.svg" };
  try {
    return (await messenger.spaces.create(TASKS_SPACE, TASKS_URL, button)).id;
  } catch {
    return (await messenger.spaces.query({ name: TASKS_SPACE }).catch(() => []))[0]?.id ?? null;
  }
})();

/** The Tasks button (and the space's) shows how many open tasks are overdue (red), nothing when none are. */
async function countOverdue(): Promise<void> {
  const overdue = collectTasks(await getAllSets()).filter((t) => groupOf(t) === "overdue").length;
  await messenger.action.setBadgeText({ text: overdue ? String(overdue) : null });
  await messenger.action.setBadgeBackgroundColor({ color: "#c92a2a" });
  await messenger.action.setTitle({ title: overdue ? `ThunderNotes Tasks: ${overdue} overdue` : null });
  const space = await tasksSpace;
  if (space !== null) {
    await messenger.spaces
      .update(space, TASKS_URL, { badgeText: overdue ? String(overdue) : null, badgeBackgroundColor: "#c92a2a", title: overdue ? `ThunderNotes Tasks: ${overdue} overdue` : "ThunderNotes Tasks" })
      .catch(() => {});
  }
}

let countTimer: ReturnType<typeof setTimeout> | undefined;
/** After notes changed (many at once when syncing): counted once, a moment later. */
function countOverdueSoon(): void {
  clearTimeout(countTimer);
  countTimer = setTimeout(() => void countOverdue().catch(console.error), 500);
}
onSetsChanged(countOverdueSoon);
countOverdueSoon(); // at startup

// ---- links between emails (D37) ----------------------------------------------------------------

/** A note to open for editing once its email has loaded (from the task view, D38), by Message-ID. */
const pendingFocus = new Map<string, { id: string; line: number }>();

/**
 * Opens an email by its Message-ID, in whatever account and folder it is; a notice if it isn't
 * here. With `focus` (the task view, D38): that note opens for editing, the cursor on the task's
 * line, either when the email loads or, if it is shown already, right away.
 */
async function openEmail(messageId: string, focus?: { id: string; line: number }): Promise<void> {
  let tab: tb.Tab;
  try {
    tab = await messenger.messageDisplay.open({ headerMessageId: messageId.replace(/^<|>$/g, ""), active: true });
  } catch {
    await showNotice({ notice: "emailNotFound", id: messageId });
    return;
  }
  if (!focus) return;
  pendingFocus.set(messageId, focus);
  if (tab.id === undefined) return;
  const shown = await messenger.tabs.sendMessage<boolean>(tab.id, { type: "focus", id: focus.id, line: focus.line, ref: messageId }).catch(() => false);
  if (shown) pendingFocus.delete(messageId);
}

/** A subject without "Re:", "Fwd:", "AW:", "WG:" … prefixes, for telling a conversation's emails. */
function conversationSubject(subject: string | undefined): string {
  let s = (subject ?? "").trim();
  for (let before = ""; before !== s; ) {
    before = s;
    s = s.replace(/^(?:re|aw|fwd?|wg|sv|vs|antw)(?:\[\d+\])?\s*:\s*/i, "");
  }
  return s.toLowerCase();
}

/**
 * The link picker's candidates (D39): with words, emails whose subject or sender contains them
 * (Thunderbird's search, all accounts, the first ~25 hits each, stopped early) plus emails with
 * notes that match; without words, the current conversation and emails with notes. Same
 * conversation first, then emails with notes, then the newest; at most 20.
 */
async function searchEmails(query: string, current: EmailRef): Promise<EmailCandidate[]> {
  const words = query.trim().toLowerCase();
  const self = current.messageId.replace(/^<|>$/g, "");
  const conversation = conversationSubject(current.subject);
  const found = new Map<string, EmailCandidate>();
  const add = (c: Omit<EmailCandidate, "sameThread">) => {
    const id = c.messageId.replace(/^<|>$/g, "");
    if (!id || id === self || c.subject.startsWith(`[${CARRIER_FOLDER}]`)) return;
    const known = found.get(id);
    found.set(id, { ...c, messageId: id, hasNotes: c.hasNotes || !!known?.hasNotes, sameThread: !!conversation && conversationSubject(c.subject) === conversation });
  };
  const withNotes = new Set<string>();
  for (const set of await getAllSets()) {
    if (!hasContent(set)) continue;
    const id = set.email.messageId.replace(/^<|>$/g, "");
    withNotes.add(id);
    const text = `${set.email.subject ?? ""} ${set.email.from ?? ""}`.toLowerCase();
    if (!words || words.split(/\s+/).every((w) => text.includes(w))) {
      add({ messageId: id, subject: set.email.subject ?? "", author: set.email.from ?? "", date: set.email.date ?? "", folder: set.email.folderHint ?? "", hasNotes: true });
    }
  }
  const search = async (info: { subject?: string; author?: string }) => {
    const list = await messenger.messages.query({ ...info, messagesPerPage: 25, autoPaginationTimeout: 300 }).catch(() => null);
    if (list?.id) messenger.messages.abortList?.(list.id).catch(() => {});
    for (const m of list?.messages ?? []) {
      add({
        messageId: m.headerMessageId,
        subject: m.subject ?? "",
        author: m.author ?? "",
        date: m.date ? new Date(m.date).toISOString() : "",
        folder: m.folder?.name ?? "",
        hasNotes: withNotes.has(m.headerMessageId),
      });
    }
  };
  if (words.length >= 2) await Promise.all([search({ subject: query.trim() }), search({ author: query.trim() })]);
  else if (conversation) await search({ subject: conversation });
  return [...found.values()]
    .sort((a, b) => Number(b.sameThread) - Number(a.sameThread) || Number(b.hasNotes) - Number(a.hasNotes) || (a.date < b.date ? 1 : -1))
    .slice(0, 20);
}

/**
 * Backlinks: the emails whose notes link to this one, across all accounts on this device (a
 * Message-ID is the same everywhere). Computed from the stored notes when asked.
 */
async function backlinksOf(messageId: string): Promise<Backlink[]> {
  const target = messageId.replace(/^<|>$/g, "");
  const out: Backlink[] = [];
  for (const set of await getAllSets()) {
    if (set.email.messageId.replace(/^<|>$/g, "") === target) continue;
    const where: string[] = [];
    if (set.emailNoteMd && linkedMessageIds(set.emailNoteMd).includes(target)) where.push("");
    for (const a of set.annotations) {
      if (!linkedMessageIds(a.bodyMd).includes(target)) continue;
      const quote = a.selectors.find((s): s is TextQuoteSelector => s.type === "TextQuoteSelector");
      where.push(quote?.exact ?? "");
    }
    if (where.length) out.push({ messageId: set.email.messageId, subject: set.email.subject ?? "", from: set.email.from ?? "", date: set.email.date ?? "", quotes: where });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

async function showStatus(tabId: number, { notes, highlights, partial, orphan, conflicts, linkedFrom }: ShownStatus): Promise<void> {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts = [notes && plural(notes, "note"), highlights && plural(highlights, "highlight")].filter(Boolean);
  const extra = [
    conflicts && `${plural(conflicts, "note")} changed on two devices`,
    partial && `${partial} partly shown`,
    orphan && `${orphan} not found in this view`,
  ].filter(Boolean);
  const linked = linkedFrom ? `\nLinked from ${plural(linkedFrom, "email")}` : "";
  const problems = await syncProblems();
  const warning = problems.length ? `\n⚠ ThunderNotes can't sync its notes with ${problems.map((p) => p.accountName).join(", ")} (click for details)` : "";
  await messenger.messageDisplayAction.setTitle({
    tabId,
    title:
      (parts.length ? `ThunderNotes: ${parts.join(", ")}${extra.length ? ` (${extra.join(", ")})` : ""}` : "ThunderNotes") + linked + warning,
  });
  await setCounters(tabId, notes, highlights, problems.length > 0);
}

messenger.runtime.onMessage.addListener((
  request: ToBackground | FromPages,
  sender
) => {
  // From the task view (D38), and the popup's link to it.
  if (request?.type === "openTasks") return openTasks();
  // A label's colour (D40), from an email or the task view (which is a tab too, without an email:
  // it must not go the way of the email requests below).
  if (request?.type === "setLabelColour") return setLabelColour(request.label, (request.colour as ColourName | null) ?? null);
  // The labels' order, from the task view (D40).
  if (request?.type === "setLabelOrder") return setLabelOrder(request.mode, request.custom);
  if (request?.type === "setTaskDone") return tickTask(request);
  if (request?.type === "editTask") return editTaskLine(request);
  if (request?.type === "setsChanged") return void countOverdueSoon(); // written by another page (an import)
  // From the options page after an import: push and pull now.
  if (request?.type === "syncNow") return pullAll();
  // From the popup: what to warn about (D35).
  if (request?.type === "syncProblems") return syncProblems();
  // From the options page: each account's sync state.
  if (request?.type === "syncStatus") return syncStatus();
  if (request?.type === "deleteUnreadable") return deleteUnreadable(request.accountId, request.id);
  // From the popup: open an email that links here (D37).
  if (request?.type === "openEmail") {
    const { messageId, noteId, line } = request;
    return openEmail(messageId, noteId !== undefined ? { id: noteId, line: line ?? 0 } : undefined);
  }
  const tabId = sender.tab?.id;
  const handler = handlers[request?.type] as Handler<ToBackground["type"]> | undefined;
  if (!handler || tabId === undefined) return undefined;
  const claimed = (request as { ref?: string }).ref;
  return displayed(tabId).then(async (shown) => {
    // Sent for another email than the tab shows now (saved while switching to the next one):
    // it belongs to that email, never to the one shown (D24). Its header button isn't ours.
    let d = shown;
    if (claimed && claimed !== shown.email.messageId) {
      if (request.type === "status") return undefined;
      d = await displayedAs(shown, claimed);
    }
    // Carriers are never annotated (D27).
    if (d.carrier && ["add", "remove", "update", "setEmailNote", "setColour", "setFolded", "restoreDeleted", "purgeDeleted"].includes(request.type)) {
      throw new Error("ThunderNotes carriers can't be annotated");
    }
    return handler(request, d);
  });
});

// ---- sync triggers (D27) ------------------------------------------------------------------------

/** Open messages redraw with the current notes (after sync brought changes). */
async function refreshOpenMessages(): Promise<void> {
  const message: ToContent = { type: "refresh" };
  for (const tab of await messenger.tabs.query({})) {
    if (tab.id !== undefined) messenger.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

/** The D20 notice: the carrier folder went missing (deleted, renamed or moved) and has been restored. */
async function showFolderRestored(accountName: string, where: LostFolder): Promise<void> {
  const params: Record<string, string> = { notice: "folderRestored", account: accountName, folder: CARRIER_FOLDER, lost: where.kind };
  if (where.kind === "moved") params.path = where.path.replace(/^\//, "");
  await showNotice(params);
}

/** A small notice window (result.html) in the middle of the last focused window. */
async function showNotice(query: Record<string, string>): Promise<void> {
  const parent = await messenger.windows.getLastFocused().catch(() => null);
  const size = { width: 480, height: 300 };
  const position =
    parent?.left !== undefined && parent.top !== undefined && parent.width && parent.height
      ? { left: Math.round(parent.left + (parent.width - size.width) / 2), top: Math.round(parent.top + (parent.height - size.height) / 2) }
      : {};
  const params = new URLSearchParams(query);
  await messenger.windows.create({ url: `result.html?${params}`, type: "popup", ...size, ...position });
}

setSyncHooks({
  changed: () => void refreshOpenMessages(),
  folderRestored: (name, where) => void showFolderRestored(name, where),
  folderResubscribed: (name) => void showNotice({ notice: "folderResubscribed", account: name, folder: CARRIER_FOLDER }),
  // Sync started or stopped failing: redraw every header button with or without the warning.
  problemsChanged: () => {
    for (const [tabId, status] of lastStatus) void showStatus(tabId, status).catch(() => lastStatus.delete(tabId));
  },
});

// Startup, every 10 minutes, and when Thunderbird sees changes in a carrier folder.
setTimeout(() => void pullAll(), 5_000);
messenger.alarms.create("thundernotes-sync", { periodInMinutes: 10 });
messenger.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "thundernotes-sync") {
    void pullAll();
    countOverdueSoon(); // a new day turns tasks overdue
  }
});

const pullTimers = new Map<string, ReturnType<typeof setTimeout>>();
function pullSoon(folder: tb.MailFolder): void {
  if (!isCarrierFolder(folder) || !folder.accountId) return;
  const accountId = folder.accountId;
  clearTimeout(pullTimers.get(accountId));
  pullTimers.set(accountId, setTimeout(() => void pull(accountId).catch(() => {}), 1_500)); // recorded for the warning
}
messenger.messages.onNewMailReceived.addListener((folder) => pullSoon(folder));
messenger.folders.onFolderInfoChanged.addListener((folder) => pullSoon(folder));
// Deleted by the user: recreate and restore right away (D20).
messenger.folders.onDeleted.addListener((folder) => {
  if (isCarrierFolder(folder) && folder.accountId) void pull(folder.accountId).catch(() => {});
});
// Renamed or moved here: the same (sync finds the carriers in their new place for the notice).
// Done elsewhere, Thunderbird only sees the folder vanish; the next check handles it alike.
messenger.folders.onRenamed.addListener((folder) => {
  if (isCarrierFolder(folder) && folder.accountId) void pull(folder.accountId).catch(() => {});
});
messenger.folders.onMoved.addListener((folder) => {
  if (isCarrierFolder(folder) && folder.accountId) void pull(folder.accountId).catch(() => {});
});
