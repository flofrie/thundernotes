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
  removeLabelFromNote,
  senderName,
  type TaskEdit,
  emailLink,
  labelsIn,
  looseDates,
  convertLooseDates,
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
import { moveNotes } from "./move.js";
import { IGNORED_KEY, deletedState, ignoredKey, isIgnored, type Ignored } from "./deleted.js";
import { accountByAddress } from "./accounts.js";
import { CARRIER_FOLDER, type LostFolder, getAllSettings, deleteUnreadable, setLabelColour, setLabelOrder, isCarrierFolder, syncProblems, syncStatus, isImapAccount, pull, pullAll, schedulePush, setSyncHooks } from "./sync.js";
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
// Label settings per account (D42): made from the shared ones of before at the first start.
getAllSettings().catch((e) => console.error("ThunderNotes: label settings", e));

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

/** A request from an email the tab no longer shows: that email in its account (D42), found by its Message-ID. */
async function displayedAs(shown: Displayed, messageId: string, accountId: string | undefined): Promise<Displayed> {
  const { messages } = await messenger.messages.query({ headerMessageId: messageId, ...(accountId ? { accountId } : {}) });
  const header = messages.find((m) => !isCarrierFolder(m.folder));
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
    // Sets that don't know their account yet ("*"): for whichever account has the email; not
    // those waiting for an account that isn't in Thunderbird (dev issue #4).
    (await getAllSets()).filter((s) => hasContent(s) && (s.email.accountId || !s.email.account)).map((s) => `${s.email.accountId || "*"}|${s.email.messageId.replace(/^<|>$/g, "")}`)
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
  tagCopies(d.email.messageId, on, CARRIER_FOLDER, d.email.accountId).catch((e) => console.warn("ThunderNotes: tagging failed", e)); // this account's copies (D42)
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
  schedulePush(set.email.accountId, set.email.messageId);
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
  await deleteSet(set.email.accountId, set.email.messageId);
  return null;
}

/** The stored set of the shown email in its account (D42); sets made before sync get this account. */
async function storedSet(d: Displayed): Promise<AnnotationSet | null> {
  let set = await getSet(d.email.accountId, d.email.messageId);
  if (!set && d.email.accountId) {
    const unassigned = await getSet(undefined, d.email.messageId);
    // Not when imported for another account (dev issue #4): it waits for that one.
    if (unassigned && (!unassigned.email.account || (await accountByAddress(unassigned.email.account)) === d.email.accountId)) {
      const { account: _, ...email } = unassigned.email;
      set = { ...unassigned, email: { ...email, accountId: d.email.accountId } };
      await putSet(set, "");
      schedulePush(set.email.accountId, set.email.messageId);
    }
  }
  // Local accounts: deleted copies expire here (IMAP sets expire in sync, D27).
  if (set && !(await isImapAccount(set.email.accountId))) {
    const gced = gcTombstones(set);
    if (gced !== set) {
      const deleted = restorable(gced);
      if (!hasContent(gced) && !deleted.annotations.length && deleted.emailNote === null) {
        await deleteSet(gced.email.accountId, gced.email.messageId);
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
    if (d.carrier) return { set: null, debug: false, marginCollapsed: true, marginWidth, carrier: true, folded: [], ref: d.email.messageId, accountId: d.email.accountId };
    const set = await storedSet(d);
    // A tag without notes is stale (e.g. the add-on was removed and its database deleted).
    // The reverse is never "fixed" on display: a tag the user removed stays removed.
    if (!hasContent(set) && d.tags.includes(TAG_KEY)) tagAnnotated(d, false);
    const folded = await foldedIds(set, d.email.messageId);
    const focus = pendingFocus.get(d.email.messageId);
    pendingFocus.delete(d.email.messageId);
    return { set, debug: await getDebug(), marginCollapsed, marginWidth, carrier: false, folded, ref: d.email.messageId, accountId: d.email.accountId, focus };
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

  async convertLooseDate({ md, text, k }) {
    const match = looseDates(md).filter((d) => md.slice(d.from, d.to) === text)[k];
    return match ? convertLooseDates(md, [match]) : null;
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

  async openLink({ url }, d) {
    const messageId = messageIdOf(url);
    // A link in a note opens the copy in the note's account if there is one (D42).
    if (messageId) await openEmail(messageId, undefined, d.email.accountId);
    else if (/^(?:https?:|mailto:)/i.test(url)) await messenger.windows.openDefaultBrowser(url);
  },

  async backlinks(_request, d) {
    return backlinksOf(d.email.messageId, d.email.accountId);
  },

  async searchEmails({ query }, d) {
    return searchEmails(query, d.email);
  },

  async labels(_request, d) {
    // The notes of this email's account on this device (D42), most used label first (D38).
    // One entry per label regardless of case, in its preferred spelling (the most written).
    const occurrences: string[] = [];
    for (const set of await getAllSets()) {
      if (set.email.accountId !== d.email.accountId) continue;
      for (const md of [set.emailNoteMd ?? "", ...set.annotations.map((a) => a.bodyMd)]) occurrences.push(...labelsIn(md));
    }
    const count = new Map<string, number>();
    for (const l of occurrences) count.set(l.toLowerCase(), (count.get(l.toLowerCase()) ?? 0) + 1);
    const spelling = preferredSpellings(occurrences);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => spelling.get(key)!);
  },

  async setLabelColour({ label, colour }, d) {
    // In an email: that email's account (D42); one not in an account (local folders) has no
    // synced label settings, so there's nothing to colour.
    if (!d.email.accountId) return;
    await setLabelColour(label, (colour as ColourName | null) ?? null, [d.email.accountId]);
  },

  async focusPane() {
    await messenger.thundernotes.focusMessagePane().catch(() => false);
  },

  async setPref({ key, value }) {
    await messenger.storage.local.set({ [key]: value });
  },

  async status(request, d) {
    const status = { ...request, linkedFrom: (await backlinksOf(d.email.messageId, d.email.accountId)).length };
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
  | { type: "openEmail"; accountId?: string; messageId: string; noteId?: string; line?: number }
  | { type: "openTasks" }
  | { type: "setsChanged" }
  | { type: "setLabelColour"; label: string; colour: string | null; accountIds?: string[] }
  | { type: "setLabelOrder"; mode: LabelOrderMode; custom?: string[]; accountIds?: string[] }
  | { type: "deleteLabel"; label: string; accountIds?: string[] }
  | { type: "checkEmails" }
  | { type: "openOptionsAt"; section: string; key?: string }
  | { type: "deleteNotesOf"; accountId?: string; messageId: string }
  | { type: "restoreNotes"; changes: NoteChange[] }
  | TaskEditRequest
  | TaskDone;

type TaskDone = { type: "setTaskDone"; accountId?: string; messageId: string; noteId: string; line: number; raw: string; done: boolean };

/**
 * The settings in a tab of their own, at a section (D44: from "email not found" to the orphaned
 * notes): there the page can jump to it (inside the Add-ons Manager it can't scroll). An open one
 * (it answers "optionsTab") is brought to the front.
 */
async function openOptionsAt(section: string, key?: string): Promise<void> {
  await messenger.storage.local.set({ optionsFocus: { section, key, at: Date.now() } });
  const open = await messenger.runtime.sendMessage<{ tabId: number; windowId: number } | undefined>({ type: "optionsTab" }).catch(() => undefined);
  if (open) {
    await messenger.tabs.update(open.tabId, { active: true });
    await messenger.windows.update(open.windowId, { focused: true });
  } else {
    await messenger.tabs.create({ url: `options.html?tab=1#${section}` });
  }
}

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
async function tickTask({ accountId, messageId, noteId, line, raw, done }: TaskDone): Promise<boolean> {
  return !!(await changeNote(accountId, messageId, noteId, (md) => setTaskDone(md, { line, raw }, done)));
}

type TaskEditRequest = { type: "editTask"; accountId?: string; messageId: string; noteId: string; line: number; raw: string; edit: TaskEdit };

/** A quick change from the task view (D38): the task's lines before and after, for undo; null if it's gone. */
async function editTaskLine({ accountId, messageId, noteId, line, raw, edit }: TaskEditRequest): Promise<{ before: string[]; after: string[] } | null> {
  let result: ReturnType<typeof editTask> = null;
  const ok = await changeNote(accountId, messageId, noteId, (md) => (result = editTask(md, { line, raw }, edit))?.md ?? null);
  return ok && result ? { before: (result as { before: string[] }).before, after: (result as { after: string[] }).after } : null;
}

/** One note's text before and after a change made everywhere (deleting a label), for undo. */
type NoteChange = { accountId?: string; messageId: string; noteId: string; before: string; after: string };

/**
 * A label deleted from the task view: taken out of every note in these accounts (none named: all),
 * each change an edit like any other (synced, open emails redrawn). Answers what changed, for undo.
 */
async function deleteLabel(label: string, accountIds?: string[]): Promise<{ emails: number; changes: NoteChange[] }> {
  const changes: NoteChange[] = [];
  const emails = new Set<string>();
  for (const set of await getAllSets()) {
    if (!hasContent(set) || (accountIds?.length && !accountIds.includes(set.email.accountId ?? ""))) continue;
    const notes = [{ noteId: EMAIL_NOTE_ID, md: set.emailNoteMd ?? "" }, ...set.annotations.map((a) => ({ noteId: a.id, md: a.bodyMd }))];
    for (const { noteId, md } of notes) {
      const after = removeLabelFromNote(md, label);
      if (after === md) continue;
      if (await changeNote(set.email.accountId, set.email.messageId, noteId, (now) => (now === md ? after : null), false)) {
        changes.push({ accountId: set.email.accountId, messageId: set.email.messageId, noteId, before: md, after });
        emails.add(`${set.email.accountId}|${set.email.messageId}`);
      }
    }
  }
  if (changes.length) void refreshOpenMessages();
  return { emails: emails.size, changes };
}

/** Undo of deleteLabel: each note back as it was, if it is still as left. */
async function restoreNotes(changes: NoteChange[]): Promise<number> {
  let restored = 0;
  for (const c of changes) if (await changeNote(c.accountId, c.messageId, c.noteId, (now) => (now === c.after ? c.before : null), false)) restored++;
  if (restored) void refreshOpenMessages();
  return restored;
}

/** A note's text changed from the task view, as if edited in the email (D32: time and device; synced, redrawn). */
async function changeNote(accountId: string | undefined, messageId: string, noteId: string, change: (md: string) => string | null, redraw = true): Promise<boolean> {
  const set = await getSet(accountId, messageId);
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
  if (redraw) void refreshOpenMessages();
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
  const ignored = await readIgnored(); // deleted emails don't count (D43)
  const overdue = collectTasks((await getAllSets()).filter((s) => !isIgnored(ignored, s))).filter((t) => groupOf(t) === "overdue").length;
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
async function openEmail(messageId: string, focus?: { id: string; line: number }, accountId?: string): Promise<void> {
  let tab: tb.Tab;
  const headerMessageId = messageId.replace(/^<|>$/g, "");
  try {
    // The copy in the notes' account (D42), else any.
    const copy = accountId ? (await messenger.messages.query({ headerMessageId, accountId }).catch(() => null))?.messages[0] : undefined;
    tab = await messenger.messageDisplay.open(copy ? { messageId: copy.id, active: true } : { headerMessageId, active: true });
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
  const ignored = await readIgnored();
  for (const set of await getAllSets()) {
    if (!hasContent(set) || isIgnored(ignored, set)) continue; // deleted emails aren't offered (D43)
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
 * Backlinks: the emails whose notes link to this one, among the notes of the same account (D42:
 * each account its own world). Computed from the stored notes when asked.
 */
async function backlinksOf(messageId: string, accountId: string | undefined): Promise<Backlink[]> {
  const target = messageId.replace(/^<|>$/g, "");
  const out: Backlink[] = [];
  const ignored = await readIgnored();
  for (const set of await getAllSets()) {
    if (set.email.accountId !== accountId) continue; // notes in this account only (D42)
    if (isIgnored(ignored, set)) continue; // a deleted email's notes link from nowhere (D43)
    if (set.email.messageId.replace(/^<|>$/g, "") === target) continue;
    const where: string[] = [];
    if (set.emailNoteMd && linkedMessageIds(set.emailNoteMd).includes(target)) where.push("");
    for (const a of set.annotations) {
      if (!linkedMessageIds(a.bodyMd).includes(target)) continue;
      const quote = a.selectors.find((s): s is TextQuoteSelector => s.type === "TextQuoteSelector");
      where.push(quote?.exact ?? "");
    }
    if (where.length) out.push({ accountId: set.email.accountId, messageId: set.email.messageId, subject: set.email.subject ?? "", from: set.email.from ?? "", date: set.email.date ?? "", quotes: where });
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
  // A label's colour (D40) from the task view, for the accounts it names (it is a tab too, without
  // an email: it must not go the way of the email requests below). From an email it does: that
  // email's account only (D42, dev issue #3).
  if (request?.type === "setLabelColour" && request.accountIds) return setLabelColour(request.label, (request.colour as ColourName | null) ?? null, request.accountIds);
  // The labels' order, from the task view (D40).
  if (request?.type === "setLabelOrder") return setLabelOrder(request.mode, request.custom, request.accountIds);
  if (request?.type === "deleteLabel") return deleteLabel(request.label, request.accountIds);
  if (request?.type === "checkEmails") return scanEmails();
  if (request?.type === "openOptionsAt") return openOptionsAt(request.section, request.key);
  if (request?.type === "deleteNotesOf") return deleteNotesOf(request.accountId, request.messageId);
  if (request?.type === "restoreNotes") return restoreNotes(request.changes);
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
    const { accountId, messageId, noteId, line } = request;
    return openEmail(messageId, noteId !== undefined ? { id: noteId, line: line ?? 0 } : undefined, accountId);
  }
  const tabId = sender.tab?.id;
  const handler = handlers[request?.type] as Handler<ToBackground["type"]> | undefined;
  if (!handler || tabId === undefined) return undefined;
  const claimed = (request as { ref?: string }).ref;
  const claimedAccount = (request as { refAccount?: string }).refAccount || undefined;
  return displayed(tabId).then(async (shown) => {
    // Sent for another email than the tab shows now (saved while switching to the next one):
    // it belongs to that email, never to the one shown (D24). Its header button isn't ours.
    let d = shown;
    if (claimed && (claimed !== shown.email.messageId || (claimedAccount !== undefined && claimedAccount !== shown.email.accountId))) {
      if (request.type === "status") return undefined;
      d = await displayedAs(shown, claimed, claimedAccount);
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

/** All messages of a list, page by page. */
async function allMessages(list: tb.MessageList): Promise<tb.MessageHeader[]> {
  const out = [...list.messages];
  for (let id = list.id; id; ) {
    const next = await messenger.messages.continueList(id);
    out.push(...next.messages);
    id = next.id;
  }
  return out;
}

// An email moved to another account takes its notes along (D42): stored and synced in the new
// account; the old one keeps only deletion records (so its other devices remove them), unless a
// copy of the email is still there. Moves within an account change nothing; copies copy no notes.
messenger.messages.onMoved.addListener((original, moved) => void notesFollow(original, moved).catch((e) => console.error("ThunderNotes: moving notes failed", e)));

// ---- deleted emails are left alone (D43) ------------------------------------------------------------

let ignoredQueue: Promise<unknown> = Promise.resolve();
/** The emails whose notes are ignored (in the Trash or deleted for good), from storage. */
async function readIgnored(): Promise<Ignored> {
  return ((await messenger.storage.local.get(IGNORED_KEY))[IGNORED_KEY] as Ignored | undefined) ?? {};
}

/** Checks an email with notes: deleted (all copies in the Trash, or gone after a deletion for good) or not. */
function refreshDeleted(accountId: string | undefined, messageId: string, afterDeletion = false): Promise<void> {
  const next = ignoredQueue.then(async () => {
    const id = messageId.replace(/^<|>$/g, "");
    const key = ignoredKey(accountId, id);
    const ignored = await readIgnored();
    const set = accountId ? await getSet(accountId, id) : null;
    let state: "trash" | "deleted" | "missing" | null = null;
    if (set && hasContent(set)) {
      const found = await messenger.messages.query({ headerMessageId: id, accountId }).catch(() => null);
      if (!found) return; // couldn't look: leave it as it was
      state = deletedState(found.messages.filter((m) => !isCarrierFolder(m.folder)), afterDeletion);
    }
    if ((ignored[key] ?? null) === state) return;
    if (state) ignored[key] = state;
    else delete ignored[key];
    await messenger.storage.local.set({ [IGNORED_KEY]: ignored });
    countOverdueSoon();
  });
  ignoredQueue = next.catch((e) => console.warn("ThunderNotes: checking a deleted email", e));
  return next;
}

messenger.messages.onMoved.addListener((original, moved) => {
  void (async () => {
    const from = await allMessages(original);
    const to = await allMessages(moved);
    for (const [i, o] of from.entries()) {
      await refreshDeleted(o.folder?.accountId, o.headerMessageId).catch(() => {});
      const m = to[i];
      if (m && m.folder?.accountId !== o.folder?.accountId) await refreshDeleted(m.folder?.accountId, m.headerMessageId).catch(() => {});
    }
  })();
});
messenger.messages.onCopied.addListener((_original, copied) => {
  void allMessages(copied).then(async (list) => {
    for (const m of list) await refreshDeleted(m.folder?.accountId, m.headerMessageId).catch(() => {});
  });
});
messenger.messages.onDeleted.addListener((deleted) => {
  void allMessages(deleted).then(async (list) => {
    for (const m of list) await refreshDeleted(m.folder?.accountId, m.headerMessageId, true).catch(() => {});
  });
});
/**
 * Every email with notes checked: in the Trash, deleted, or not found (removed by other means, e.g.
 * on the server; D43, D44). At startup (a little later) and when the task view opens, at most once a minute.
 */
let lastScan = 0;
async function scanEmails(): Promise<void> {
  if (Date.now() - lastScan < 60_000) return;
  lastScan = Date.now();
  for (const set of await getAllSets()) if (hasContent(set) && set.email.accountId) await refreshDeleted(set.email.accountId, set.email.messageId).catch(() => {});
}
setTimeout(() => void scanEmails(), 10_000);

/** All notes on an email deleted (one whose email can't be found, D44): synced, restorable for 30 days. */
async function deleteNotesOf(accountId: string | undefined, messageId: string): Promise<number> {
  const set = await getSet(accountId, messageId);
  if (!set || !hasContent(set)) return 0;
  const count = set.annotations.length + (set.emailNoteMd ? 1 : 0);
  let next = set;
  for (const a of set.annotations) next = deleteAnnotation(next, a.id);
  if (next.emailNoteMd) next = deleteEmailNote(next);
  next = { ...next, rev: set.rev + 1, updated: new Date().toISOString() };
  await save(next);
  await refreshDeleted(accountId, messageId).catch(() => {}); // no notes: no longer listed
  return count;
}

async function notesFollow(original: tb.MessageList, movedList: tb.MessageList): Promise<void> {
  const from = await allMessages(original);
  const to = await allMessages(movedList);
  let changed = false;
  for (const [i, o] of from.entries()) {
    const m = to[i];
    const fromAccount = o.folder?.accountId;
    const toAccount = m?.folder?.accountId;
    if (!m || !fromAccount || !toAccount || fromAccount === toAccount || isCarrierFolder(o.folder) || isCarrierFolder(m.folder)) continue;
    const id = o.headerMessageId.replace(/^<|>$/g, "");
    const set = await getSet(fromAccount, id);
    if (!set || !hasContent(set)) continue;
    const copies = (await messenger.messages.query({ headerMessageId: id, accountId: fromAccount }).catch(() => null))?.messages ?? [];
    // The moved original may still be listed (IMAP: marked deleted until expunged): not a copy left.
    const keepOld = copies.some((c) => c.id !== o.id && !isCarrierFolder(c.folder));
    const { moved, left } = moveNotes(set, toAccount, await getSet(toAccount, id), keepOld);
    await putSet(moved);
    schedulePush(toAccount, id);
    if (left) {
      await putSet(left);
      schedulePush(fromAccount, id);
    }
    await tagCopies(id, true, CARRIER_FOLDER, toAccount).catch(() => {});
    changed = true;
  }
  if (changed) void refreshOpenMessages();
}
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
