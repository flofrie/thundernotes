/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// ThunderNotes Experiment API: the add-on's only privileged code (D19, D26, D27). Keep it small.
// 1. A "ThunderNotes" icon column in the message list, via Thunderbird's
//    ThreadPaneColumns module (mail/base/content/modules/ThreadPaneColumns.mjs). It shows
//    the post-it on messages with the `$annotated` keyword (set by the add-on, tags.ts).
// 2. Excluding a folder from global search, exactly like the Folder Properties checkbox
//    (mailnews/base/content/folderProps.js); tested in spikes/imap-folder.
// 3. Prompt fetching of the carrier folder (no MailExtension API fetches a folder): the
//    "check this folder for new messages" flag, and an explicit fetch at startup (D27).
// 4. A default device name for conflict boxes (D32): no MailExtension API knows the
//    computer's name.
// 5. Re-subscribing the carrier folder (D36): an unsubscribed IMAP folder is hidden from
//    add-ons (spike imap-folder), so sync silently stopped. Done like the Subscribe dialog
//    (mailnews/base/content/subscribe.js): populate the server's folder list (which also makes
//    unsubscribed folders findable for the subscribe command), subscribe, then let Thunderbird
//    rediscover its folders (commitSubscribeChanges = ReDiscoverAllFolders). setState alone only
//    ticks the box in the dialog's model; it sends nothing (seen in testing).
// 6. Focusing the message pane (D37): after "Copy ThunderNotes link" in the message list, a
//    note being edited gets the cursor back without a click; no MailExtension API moves the
//    focus between Thunderbird's panes.
// 7. "Print with Notes" in Thunderbird's own menus, right after "Print…" (D23): the File menu
//    (#printMenuItem) and the right-click menu of the message list and of the shown email
//    (#mailContext-print, in about:3pane and about:message). Add-ons can only add right-click
//    items in their own submenu and none to the File menu. A click tells the shown email to
//    print its notes (a DOM event the display script listens for), then opens the print dialog
//    as Thunderbird's own "Print…" does (top.PrintUtils.startPrintWindow, about3Pane.js /
//    aboutMessage.js). Without "Print…" in a menu, the items go to its end.
// 8. The post-it in the message list's cards view too (D26): cards don't show custom columns
//    (thread-card.mjs fills a fixed template). Each about:3pane's ThreadCard.fillRow is wrapped
//    to add the icon to the card's icons (attachment, tags) for messages with `$annotated`, and
//    a one-line preview of the whole-email note where the card has room (the add-on hands the
//    previews over: setCardPreviews; this code never reads the notes); undone when it stops.

"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { ExtensionUtils } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");
var { ExtensionError } = ExtensionUtils;
var { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");

const COLUMN_ID = "thundernotesCol";
const TAG_KEY = "$annotated";
/** Set once all folders' saved column layouts include our column (see placeColumn). */
const PLACED_PREF = "extensions.thundernotes.columnPlaced";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ThreadPaneColumns: "chrome://messenger/content/ThreadPaneColumns.mjs",
  Gloda: "resource:///modules/gloda/GlodaPublic.sys.mjs",
  MailServices: "resource:///modules/MailServices.sys.mjs",
});

function isAnnotated(msgHdr) {
  return msgHdr.getStringProperty("keywords").split(" ").includes(TAG_KEY);
}

/** The column's (and cards') icon, set at startup. */
let iconUrl = "";

function registerColumn(extension) {
  // 16 px file: icon cells use the image's own size.
  iconUrl = extension.baseURI.resolve("icons/column.svg");
  // A previous run may not have cleaned up (crash, reload). Only then: removing a column that
  // isn't there makes every message list log an error (nsIMsgDBView.removeColumnHandler).
  const columns = lazy.ThreadPaneColumns.getCustomColumns?.() ?? [{ id: COLUMN_ID }];
  if (columns.some((c) => c.id === COLUMN_ID)) lazy.ThreadPaneColumns.removeCustomColumn(COLUMN_ID);
  lazy.ThreadPaneColumns.addCustomColumn(COLUMN_ID, {
    name: "ThunderNotes",
    icon: true,
    iconHeaderUrl: iconUrl,
    iconCellDefinitions: [{ id: "annotated", url: iconUrl, title: "Has ThunderNotes highlights or notes", alt: "ThunderNotes" }],
    iconCallback: (msgHdr) => (isAnnotated(msgHdr) ? "annotated" : ""),
    textCallback: (msgHdr) => (isAnnotated(msgHdr) ? "ThunderNotes" : ""),
    sortCallback: (msgHdr) => (isAnnotated(msgHdr) ? 1 : 0),
    resizable: false,
    sortable: true,
  });
}

/**
 * Thunderbird hides columns missing from a folder's saved layout ("columnStates") and sorts
 * them first. So once, on first start, our column goes into every folder's layout: visible,
 * right after the attachment column. Folders without a saved layout get their default one.
 * Later changes by the user (hiding, moving) are left alone.
 */
function placeColumn() {
  if (Services.prefs.getBoolPref(PLACED_PREF, false)) return;
  for (const folder of lazy.MailServices.accounts.allFolders) {
    let db;
    const wasOpen = folder.databaseOpen;
    try {
      db = folder.msgDatabase;
    } catch (e) {
      continue; // no local database (e.g. never-opened server folder)
    }
    try {
      const saved = db.dBFolderInfo.getCharProperty("columnStates");
      let states;
      if (saved) {
        states = JSON.parse(saved);
        if (states[COLUMN_ID]) continue;
      } else {
        states = {};
        lazy.ThreadPaneColumns.getDefaultColumns(folder).forEach((c, i) => {
          if (c.id !== COLUMN_ID) states[c.id] = { visible: !c.hidden, ordinal: i };
        });
      }
      const order = Object.keys(states).sort((a, b) => states[a].ordinal - states[b].ordinal);
      const after = order.indexOf("attachmentCol");
      order.splice(after === -1 ? order.length : after + 1, 0, COLUMN_ID);
      states[COLUMN_ID] = { visible: true, ordinal: 0 };
      order.forEach((id, i) => (states[id].ordinal = i));
      db.dBFolderInfo.setCharProperty("columnStates", JSON.stringify(states));
      db.commit(Ci.nsMsgDBCommitType.kLargeCommit);
    } catch (e) {
      console.warn(`ThunderNotes: could not place the column in ${folder.URI}`, e);
    } finally {
      if (!wasOpen) folder.msgDatabase = null; // don't keep databases open we opened
    }
  }
  Services.prefs.setBoolPref(PLACED_PREF, true);
}

/** Open message lists re-read their (now updated) column layout. */
function refreshOpenMessageLists() {
  for (const win of Services.wm.getEnumerator("mail:3pane")) {
    for (const tab of win.document.getElementById("tabmail")?.tabInfo ?? []) {
      const about3Pane = tab.chromeBrowser?.contentWindow;
      try {
        about3Pane?.threadPane?.restoreColumns();
        about3Pane?.threadTree?.reset();
      } catch (e) {}
    }
  }
}

// MailFolderId (e.g. "account1://Annotations") -> nsIMsgFolder. First the helper the built-in
// folders API uses; it is internal, so fall back to a URI lookup.
function resolveFolder(folderId) {
  try {
    const { getFolder } = ChromeUtils.importESModule("resource:///modules/ExtensionAccounts.sys.mjs");
    const { folder } = getFolder(folderId);
    if (folder) return folder;
  } catch (e) {}
  const match = /^([^:]+):\/\/(.*)$/.exec(folderId);
  const account = match && lazy.MailServices.accounts.getAccount(match[1]);
  const folder = account && lazy.MailServices.folderLookup.getFolderForURL(`${account.incomingServer.rootFolder.URI}/${match[2]}`);
  if (!folder) throw new ExtensionError(`Folder not found: ${folderId}`);
  return folder;
}

function includedInGlobalSearch(folder) {
  const glodaFolder = lazy.Gloda.getFolderForFolder(folder);
  return glodaFolder.indexingPriority != glodaFolder.kIndexingNeverPriority;
}

// ---- 7. "Print with Notes" in Thunderbird's menus ------------------------------------------------

const PRINT_ITEMS = [
  { id: "thundernotes-print-shown", label: "Print with Notes…", event: "thundernotes-print-shown" },
  { id: "thundernotes-print-expanded", label: "Print with Notes, All Expanded…", event: "thundernotes-print-expanded" },
];
const PRINT_LISTENER = "thundernotes-print-menus";
/** Undoes what was added (items, listeners), per document. */
const printCleanups = new Set();

/** The browser showing the email for a menu's document: about:message, about:3pane, or a window. */
function messageBrowserFor(doc) {
  try {
    const win = doc.defaultView;
    const href = doc.location?.href ?? "";
    if (href.startsWith("about:message")) return win.getMessagePaneBrowser?.() ?? null;
    if (href.startsWith("about:3pane")) return win.messageBrowser?.contentWindow?.getMessagePaneBrowser?.() ?? null;
    const tabmail = doc.getElementById("tabmail");
    if (tabmail) {
      if (tabmail.currentAbout3Pane) return messageBrowserFor(tabmail.currentAbout3Pane.document);
      if (tabmail.currentAboutMessage) return tabmail.currentAboutMessage.getMessagePaneBrowser?.() ?? null;
      return null;
    }
    // A message window.
    return doc.getElementById("messageBrowser")?.contentWindow?.getMessagePaneBrowser?.() ?? null;
  } catch {
    return null;
  }
}

/** Whether the shown email has notes or highlights (the display script marks its document). */
function hasNotes(browser) {
  return !!browser?.contentDocument?.documentElement?.hasAttribute("data-thundernotes-notes");
}

function printWithNotes(browser, eventName) {
  const doc = browser.contentDocument;
  // All within the menu click, as "Print…" does: the email gets ready (its listener lays the
  // notes out at once), then the print dialog. After a pause (tried first) it didn't open: a
  // print dialog seems to need the user's click itself.
  doc.dispatchEvent(new doc.defaultView.Event(eventName));
  try {
    // The email's about:message window (browser.ownerGlobal is undefined here: seen in testing).
    const aboutMessage = browser.ownerDocument?.defaultView;
    console.log("ThunderNotes: Print with Notes: opening the print dialog");
    if (aboutMessage.commandController) aboutMessage.commandController.doCommand("cmd_print");
    else aboutMessage.top.PrintUtils.startPrintWindow(browser.browsingContext, {});
  } catch (e) {
    console.error("ThunderNotes: opening the print dialog failed", e);
    // The email goes back to printing without notes at once.
    doc.dispatchEvent(new doc.defaultView.Event("thundernotes-print-done"));
  }
}

/** The two items right after the menu's "Print…" (`anchorId`), shown with it, active with notes. */
function addPrintItems(doc, anchorId, popupId) {
  if (doc.getElementById(PRINT_ITEMS[0].id)) return;
  const anchor = doc.getElementById(anchorId);
  const popup = anchor?.parentNode ?? doc.getElementById(popupId);
  if (!popup) return;
  const items = [];
  let after = anchor;
  for (const p of PRINT_ITEMS) {
    const item = doc.createXULElement("menuitem");
    item.id = p.id;
    item.setAttribute("label", p.label);
    item.addEventListener("command", (e) => {
      e.stopPropagation(); // not for the menu's own command handling
      const browser = messageBrowserFor(doc);
      if (browser) printWithNotes(browser, p.event);
    });
    if (after) after.after(item);
    else popup.append(item);
    after = item;
    items.push(item);
  }
  const onShowing = (e) => {
    if (e.target !== popup) return;
    // Right-click in the message list on an email that isn't the shown one: Thunderbird's menu
    // then acts on that email (mailContext.js, setOverrideSelection), but ours can only print the
    // shown one, so they aren't offered (they showed, going by the shown email's notes).
    const elsewhere = !!doc.defaultView?.mailContextMenu?.selectionIsOverridden;
    const active = hasNotes(messageBrowserFor(doc));
    for (const item of items) {
      item.hidden = !!anchor?.hidden || elsewhere;
      item.disabled = !active;
    }
  };
  popup.addEventListener("popupshowing", onShowing);
  const cleanup = () => {
    popup.removeEventListener("popupshowing", onShowing);
    for (const item of items) item.remove();
  };
  printCleanups.add(cleanup);
  doc.defaultView.addEventListener("unload", () => printCleanups.delete(cleanup), { once: true });
}

// ---- 8. The post-it on cards -----------------------------------------------------------------------

const CARD_ICON_CLASS = "thundernotes-card-icon";
const CARD_PREVIEW_CLASS = "thundernotes-card-preview";
/** Undoes the wrapped fillRow and the icons, per about:3pane window. */
const cardCleanups = new Set();
/** Previews of whole-email notes by "<account id>|<Message-ID>" (setCardPreviews): text and colours. */
let cardPreviews = new Map();
/** Redraws the cards of each about:3pane window that has the hook (for new previews). */
const cardRedraws = new Set();
/** A preview cut down to less than this is hidden (a short one, shown whole, never is). */
const PREVIEW_MIN_WIDTH = 120;
let previewLookupWarned = false;

/**
 * The message shown by a card of the message list in `win`. Through the page's own objects: the
 * list (gDBView) and the card's row (_index) are set by its scripts and hidden from this code
 * otherwise. The window comes from the hook, not the card: an unwrapped card has no ownerGlobal
 * (seen by the owner: "unwrapped(...) is undefined"). Throws for group headers.
 */
function messageOfCard(card, win) {
  return unwrapped(win).gDBView?.getMsgHdrAt(unwrapped(card)._index);
}

/** The key of a card's email in cardPreviews, or null (a group header, or it can't be told). */
function cardPreviewKey(card, win) {
  try {
    const hdr = messageOfCard(card, win);
    if (!hdr) return null;
    const account = lazy.MailServices.accounts.findAccountForServer(hdr.folder.server)?.key ?? "";
    return `${account}|${hdr.messageId}`;
  } catch (e) {
    // Group headers ("dummy" rows) throw too; those have no tags element filled.
    if (!previewLookupWarned && card.querySelector("thread-card-tags")?.hasAttribute("tags")) {
      previewLookupWarned = true;
      console.warn("ThunderNotes: card previews: can't tell which email a card shows", e);
    }
    return null;
  }
}

/** Narrower cards show no preview: there a lozenge would crowd the sender, subject or icons. */
const PREVIEW_MIN_CARD_WIDTH = 560;

/** The share of a line's free room a preview may take (the owner's wish). */
const PREVIEW_SHARE = 0.75;

const widthOf = (el) => el.getBoundingClientRect().width;

/**
 * What the sender's name needs: its text's width, plus its padding. Not its box: Thunderbird
 * stretches the sender across the free room (and scrollWidth is at least the box), which counted
 * the room as taken (seen in a render: the preview cut short with room to spare).
 */
function senderNeed(sender) {
  const range = sender.ownerDocument.createRange();
  range.selectNodeContents(sender);
  const text = range.getBoundingClientRect().width;
  const style = sender.ownerDocument.defaultView?.getComputedStyle(sender);
  return Math.ceil(text + (parseFloat(style?.paddingInlineStart) || 0) + (parseFloat(style?.paddingInlineEnd) || 0));
}

/**
 * The widest a preview may be, in px: PREVIEW_SHARE of its line's free room, measured once
 * Thunderbird has laid the card out. With 2 rows the line is the first one, and the others on it
 * need the sender's whole name (senderNeed, also where it is cut short), the date and the rest;
 * with 3 rows the third line, less the icons and the replies button. A limit in px counts when
 * the list's width is worked out, so it can't widen the list (a percentage could). Null: not
 * measurable (no line).
 */
function previewLimit(preview) {
  const box = preview.parentElement;
  const view = preview.ownerDocument.defaultView;
  if (!box || !view) return null;
  const gap = parseFloat(view.getComputedStyle(box).columnGap) || 0;
  const others = [...box.children].filter((el) => el !== preview && !el.hidden && widthOf(el) > 0);
  let need = others.reduce((sum, el) => sum + (el.classList.contains("sender") ? senderNeed(el) : widthOf(el)) + gap, 0);
  need += (parseFloat(preview.style.marginInlineStart) || 0) + (parseFloat(preview.style.marginInlineEnd) || 0);
  let width = box.clientWidth;
  if (box.classList.contains("thread-card-icon-info")) {
    // The icons box is only as wide as its content: the room is its line's.
    const line = box.parentElement;
    if (!line) return null;
    width = line.clientWidth;
    const button = line.querySelector(".thread-card-button");
    if (button && widthOf(button) > 0) need += widthOf(button) + gap;
  }
  return Math.max(0, Math.floor(PREVIEW_SHARE * (width - need)));
}

/**
 * Left out on narrow cards; else as wide as PREVIEW_SHARE of its line's free room allows
 * (previewLimit), hidden where that cuts it below PREVIEW_MIN_WIDTH.
 */
function fitPreview(preview) {
  const pill = preview.firstElementChild;
  if (!pill || preview.dataset.text === undefined) return;
  const card = preview.closest("td") ?? preview.parentElement;
  preview.hidden = !preview.dataset.text || (card?.getBoundingClientRect().width ?? Infinity) < PREVIEW_MIN_CARD_WIDTH;
  if (preview.hidden) return;
  const limit = previewLimit(preview);
  if (limit !== null) pill.style.maxInlineSize = `${limit}px`;
  const cut = pill.scrollWidth > pill.clientWidth + 1;
  preview.style.visibility = cut && pill.clientWidth < PREVIEW_MIN_WIDTH ? "hidden" : "";
}

/**
 * A card's preview, a lozenge in the note's colour (as the margin's cards), as wide as its text
 * up to a limit, ending in "…" when longer, right-aligned (the owner's choice): with 3 rows on
 * the third line right before the icons, inside Thunderbird's own icons box, which Thunderbird
 * already puts at the line's right end as wide as its content (stretching that box across the
 * line put it, with the star, short of the edge in Thunderbird; seen by the owner); with 2 rows
 * on the first line right before the date, at most half the line (the sender keeps
 * Thunderbird's own sizing and fills the rest; changing it shifted the date).
 * The message list is a table sized to its content, and a percentage limit doesn't count when a
 * browser works out what its content needs: a long note widened the whole list, pushing every
 * date out of view. So the lozenge has a limit that does count: in px, measured (fitPreview,
 * up to PREVIEW_SHARE of the line's free room); until measured 27 em on the first line, 20 em
 * in the icons box (which can't shrink below its content).
 */
function placePreview(card, data, win) {
  const text = data?.text ?? "";
  let preview = card.querySelector(`.${CARD_PREVIEW_CLASS}`);
  if (!text) {
    if (preview) (preview.hidden = true), (preview.dataset.text = "");
    return;
  }
  const sender = card.querySelector(".sender");
  const icons = card.querySelector(".thread-card-icon-info");
  if (!preview) {
    const doc = card.ownerDocument;
    preview = doc.createElement("span");
    preview.className = CARD_PREVIEW_CLASS;
    preview.style.cssText = "flex:0 1 auto;min-inline-size:0;display:flex;align-items:center;justify-content:flex-end;";
    // Shorter than the card's line, its outline drawn inside (an inset shadow, no border): the
    // card's lines are as high as their text and cut off what sticks out, which took the
    // outline's top and bottom (seen by the owner).
    const pill = doc.createElement("span");
    pill.style.cssText =
      // No font size of its own: the card's text size, as the subject's (the owner's wish).
      "min-inline-size:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" +
      "line-height:1.3;padding:0 8px;border-radius:999px;box-sizing:border-box;";
    preview.append(pill);
  }
  const pill = preview.firstElementChild;
  pill.style.background = data.background ?? "";
  pill.style.color = data.color ?? "";
  pill.style.boxShadow = data.border ? `inset 0 0 0 1px ${data.border}` : "";
  if (card.closest(".cards-row-compact") && sender) {
    sender.after(preview);
    preview.style.marginInlineStart = "12px";
    preview.style.marginInlineEnd = "4px";
    if (!pill.style.maxInlineSize.endsWith("px")) pill.style.maxInlineSize = "27em";
  } else if (icons) {
    icons.prepend(preview);
    preview.style.marginInlineStart = "12px";
    preview.style.marginInlineEnd = "0";
    if (!pill.style.maxInlineSize.endsWith("px")) pill.style.maxInlineSize = "20em";
  }
  pill.textContent = text;
  preview.title = text;
  preview.dataset.text = text;
  preview.hidden = false;
  win.requestAnimationFrame(() => fitPreview(preview));
}

/** The page's own object behind a wrapper (values its scripts set, like gDBView or a row's _index). */
function unwrapped(obj) {
  try {
    return ChromeUtils.waiveXrays(obj);
  } catch {
    return obj;
  }
}

/**
 * Whether a card's message has notes. First the tags Thunderbird wrote on the card
 * (`<thread-card-tags tags="… $annotated">`, filled just before): a plain attribute, always
 * readable from here. The message list's own values (gDBView, the row's index) can be hidden
 * from this Experiment's code (seen in testing: no card got the icon), so they are only the
 * fallback, read through unwrapped().
 */
function cardAnnotated(card, win) {
  const tags = card.querySelector("thread-card-tags")?.getAttribute("tags");
  if (tags) return tags.split(" ").includes(TAG_KEY);
  try {
    // Group headers ("dummy" rows) have no message: getMsgHdrAt throws.
    const hdr = messageOfCard(card, win);
    return !!hdr && isAnnotated(hdr);
  } catch {
    return false;
  }
}

/** One card: the post-it among its icons if its message has notes, else none. */
/** One card of the message list in `win`. */
function markCard(card, win) {
  const annotated = cardAnnotated(card, win);
  placePreview(card, annotated && cardPreviews.size ? cardPreviews.get(cardPreviewKey(card, win)) : "", win);
  let icon = card.querySelector(`.${CARD_ICON_CLASS}`);
  if (!annotated) return void (icon && (icon.hidden = true));
  if (!icon) {
    const doc = card.ownerDocument;
    icon = doc.createElement("img");
    icon.className = CARD_ICON_CLASS;
    icon.src = iconUrl;
    icon.alt = "ThunderNotes";
    icon.title = "Has ThunderNotes highlights or notes";
    icon.style.cssText = "width:16px;height:16px;flex-shrink:0;margin-block-start:1px;";
    const tags = card.querySelector("thread-card-tags");
    if (tags) tags.before(icon);
    else card.querySelector(".thread-card-icon-info")?.prepend(icon);
  }
  icon.hidden = false;
}

/** Wraps the window's ThreadCard.fillRow once (as soon as the element is defined), then redraws. */
function addCardIcons(win) {
  const patch = () => {
    const Card = win.customElements.get("thread-card");
    if (!Card || Card.prototype.thundernotesFillRow) return;
    const original = Card.prototype.fillRow;
    Card.prototype.thundernotesFillRow = original;
    Card.prototype.fillRow = function () {
      original.call(this);
      try {
        markCard(this, win);
      } catch (e) {
        console.warn("ThunderNotes: marking a card failed", e);
      }
    };
    const redraw = () => unwrapped(win).threadTree?.invalidate?.();
    // The pane resized: previews refitted (cards aren't filled again for that).
    const tree = win.document.getElementById("threadTree");
    const observer = tree && win.ResizeObserver ? new win.ResizeObserver(() => {
      for (const preview of win.document.querySelectorAll(`.${CARD_PREVIEW_CLASS}`)) fitPreview(preview);
    }) : null;
    if (tree) observer?.observe(tree);
    const cleanup = () => {
      Card.prototype.fillRow = original;
      delete Card.prototype.thundernotesFillRow;
      observer?.disconnect();
      cardRedraws.delete(redraw);
      for (const el of win.document.querySelectorAll(`.${CARD_ICON_CLASS}, .${CARD_PREVIEW_CLASS}`)) el.remove();
    };
    cardCleanups.add(cleanup);
    cardRedraws.add(redraw);
    win.addEventListener("unload", () => (cardCleanups.delete(cleanup), cardRedraws.delete(redraw)), { once: true });
    redraw(); // cards already shown
  };
  if (win.customElements.get("thread-card")) patch();
  else win.customElements.whenDefined("thread-card").then(patch, () => {});
}

function uninstallCardIcons() {
  for (const cleanup of cardCleanups) cleanup();
  cardCleanups.clear();
}

/** about:3pane and about:message documents (they hold the right-click menus; about:3pane the cards). */
function addToInnerDocument(doc) {
  const href = doc.location?.href ?? "";
  if (href.startsWith("about:3pane") || href.startsWith("about:message")) addPrintItems(doc, "mailContext-print", "mailContext");
  if (href.startsWith("about:3pane")) {
    try {
      addCardIcons(doc.defaultView);
    } catch (e) {
      console.error("ThunderNotes: adding the post-it to cards failed", e);
    }
  }
}

/** New about:3pane / about:message documents (new tabs, windows, a message opened). */
const innerDocumentObserver = {
  observe(doc) {
    const href = doc?.location?.href ?? "";
    if (!href.startsWith("about:3pane") && !href.startsWith("about:message")) return;
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", () => addToInnerDocument(doc), { once: true });
    else addToInnerDocument(doc);
  },
};

function installPrintMenus() {
  ExtensionSupport.registerWindowListener(PRINT_LISTENER, {
    chromeURLs: ["chrome://messenger/content/messenger.xhtml", "chrome://messenger/content/messageWindow.xhtml"],
    onLoadWindow(win) {
      addPrintItems(win.document, "printMenuItem", "menu_FilePopup");
      // The documents already there: each tab's about:3pane / about:message and the email inside.
      const tabmail = win.document.getElementById("tabmail");
      for (const tab of tabmail?.tabInfo ?? []) {
        const inner = tab.chromeBrowser?.contentDocument;
        if (inner) addToInnerDocument(inner);
        const message = inner?.defaultView?.messageBrowser?.contentDocument;
        if (message) addToInnerDocument(message);
      }
      const message = win.document.getElementById("messageBrowser")?.contentDocument;
      if (message) addToInnerDocument(message);
    },
  });
  Services.obs.addObserver(innerDocumentObserver, "document-element-inserted");
}

function uninstallPrintMenus() {
  Services.obs.removeObserver(innerDocumentObserver, "document-element-inserted");
  ExtensionSupport.unregisterWindowListener(PRINT_LISTENER);
  for (const cleanup of printCleanups) cleanup();
  printCleanups.clear();
}

this.thundernotes = class extends ExtensionCommon.ExtensionAPI {
  // manifest: "events": ["startup"], so the column exists as soon as the add-on starts.
  onStartup() {
    try {
      registerColumn(this.extension);
      if (!Services.prefs.getBoolPref(PLACED_PREF, false)) {
        placeColumn();
        refreshOpenMessageLists();
      }
    } catch (e) {
      console.error("ThunderNotes: registering the column failed", e);
    }
    try {
      installPrintMenus();
    } catch (e) {
      console.error("ThunderNotes: adding Print with Notes to the menus failed", e);
    }
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) return;
    lazy.ThreadPaneColumns.removeCustomColumn(COLUMN_ID);
    try {
      uninstallCardIcons();
    } catch (e) {
      console.error("ThunderNotes: removing the post-it from cards failed", e);
    }
    try {
      uninstallPrintMenus();
    } catch (e) {
      console.error("ThunderNotes: removing Print with Notes from the menus failed", e);
    }
    // Without this, a reloaded add-on may keep running the old Experiment code.
    Services.obs.notifyObservers(null, "startupcache-invalidate");
  }

  getAPI(context) {
    return {
      thundernotes: {
        async refreshColumn() {
          lazy.ThreadPaneColumns.refreshCustomColumn(COLUMN_ID);
        },
        async setCardPreviews(previews) {
          cardPreviews = new Map(Object.entries(previews ?? {}));
          for (const redraw of cardRedraws) redraw();
        },
        async prepareCarrierFolder(folderId) {
          const folder = resolveFolder(folderId);
          // Same flag as Folder Properties > "When getting new messages, always check this folder".
          folder.setFlag(Ci.nsMsgFolderFlags.CheckNew);
          if (includedInGlobalSearch(folder)) {
            lazy.Gloda.setFolderIndexingPriority(folder, lazy.Gloda.getFolderForFolder(folder).kIndexingNeverPriority);
          }
        },
        async refreshFolder(folderId) {
          const folder = resolveFolder(folderId);
          if (!(folder instanceof Ci.nsIMsgImapMailFolder)) {
            folder.updateFolder(null);
            return;
          }
          await new Promise((resolve) => {
            folder.updateFolderWithListener(null, {
              QueryInterface: ChromeUtils.generateQI(["nsIUrlListener"]),
              OnStartRunningUrl() {},
              OnStopRunningUrl() {
                resolve();
              },
            });
          });
        },
        async subscribeCarrierFolder(accountId, name) {
          const server = lazy.MailServices.accounts.getAccount(accountId)?.incomingServer;
          if (!server || server.type !== "imap") return "notImap";
          if (server.rootFolder.containsChildNamed(name)) return "visible";
          const imap = server.QueryInterface(Ci.nsIImapIncomingServer);
          if (!imap.usingSubscription) return "missing"; // all folders shown: it really is missing
          const subscribable = server.QueryInterface(Ci.nsISubscribableServer);
          // The server's full folder list, subscribed or not (LIST), as the dialog shows it.
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 30000);
            subscribable.subscribeListener = {
              QueryInterface: ChromeUtils.generateQI(["nsISubscribeListener"]),
              OnDonePopulating() {
                clearTimeout(timer);
                resolve();
              },
            };
            subscribable.startPopulating(null, true, false);
          });
          let exists = false;
          let subscribed = false;
          try {
            exists = subscribable.isSubscribable(name);
            subscribed = subscribable.isSubscribed(name);
          } catch {
            // not in the list: missing
          }
          if (exists && !subscribed) {
            subscribable.subscribe(name); // IMAP SUBSCRIBE (asynchronous)
            // Give the server a moment, then rediscover; again if it doesn't show up at once.
            for (let i = 0; i < 3 && !server.rootFolder.containsChildNamed(name); i++) {
              await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)));
              subscribable.commitSubscribeChanges();
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }
          subscribable.subscribeCleanup();
          return exists ? (subscribed ? "visible" : "subscribed") : "missing";
        },
        async focusCurrentTab() {
          const win = Services.wm.getMostRecentWindow("mail:3pane");
          const tabmail = win?.document.getElementById("tabmail");
          // A content tab (the task view): its browser; the page inside then gets the keys.
          const browser = tabmail?.currentTabInfo?.browser ?? tabmail?.getBrowserForSelectedTab?.();
          if (!browser) return false;
          browser.focus();
          return true;
        },
        async focusMessagePane() {
          const win = Services.wm.getMostRecentWindow("mail:3pane");
          const tabmail = win?.document.getElementById("tabmail");
          const about3Pane = tabmail?.currentAbout3Pane;
          // The 3-pane tab's message browser shows about:message, which holds the message.
          const aboutMessage = about3Pane?.messageBrowser?.contentWindow ?? tabmail?.currentAboutMessage;
          const browser = aboutMessage?.getMessagePaneBrowser?.() ?? aboutMessage?.document?.getElementById("messagepane");
          if (!browser) return false;
          browser.focus();
          return true;
        },
        async deviceName() {
          let host = "";
          try {
            // "Florians-MacBook-Pro.local" -> "Florians MacBook Pro"
            host = (Services.dns.myHostName || "").split(".")[0].replace(/[-_]+/g, " ").trim();
          } catch {}
          let profile = "";
          let profiles = 0;
          try {
            const service = Cc["@mozilla.org/toolkit/profile-service;1"].getService(Ci.nsIToolkitProfileService);
            profile = service.currentProfile?.name ?? "";
            for (const _ of service.profiles) profiles++;
          } catch {}
          const name = host || "This computer";
          return profiles > 1 && profile ? `${name} (${profile})` : name;
        },
        async expungeFolder(folderId) {
          // "Delete permanently" on IMAP only sets \Deleted; old carrier revisions stay on the
          // server (and in Thunderbird's list) until the folder is expunged.
          const folder = resolveFolder(folderId);
          if (!(folder instanceof Ci.nsIMsgImapMailFolder)) return;
          await new Promise((resolve) => {
            folder.expunge(
              {
                QueryInterface: ChromeUtils.generateQI(["nsIUrlListener"]),
                OnStartRunningUrl() {},
                OnStopRunningUrl() {
                  resolve();
                },
              },
              null
            );
          });
        },
        async getGlobalSearch(folderId) {
          return includedInGlobalSearch(resolveFolder(folderId));
        },
        async setGlobalSearch(folderId, include) {
          const folder = resolveFolder(folderId);
          if (include) {
            // `true` as in folderProps.js: lets special folders get a priority too.
            lazy.Gloda.resetFolderIndexingPriority(folder, true);
          } else {
            lazy.Gloda.setFolderIndexingPriority(folder, lazy.Gloda.getFolderForFolder(folder).kIndexingNeverPriority);
          }
          return includedInGlobalSearch(folder);
        },
      },
    };
  }
};
