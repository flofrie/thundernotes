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

function registerColumn(extension) {
  // 16 px file: icon cells use the image's own size.
  const iconUrl = extension.baseURI.resolve("icons/column.svg");
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

/** about:3pane and about:message documents (they hold the right-click menus). */
function addToInnerDocument(doc) {
  const href = doc.location?.href ?? "";
  if (href.startsWith("about:3pane") || href.startsWith("about:message")) addPrintItems(doc, "mailContext-print", "mailContext");
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
