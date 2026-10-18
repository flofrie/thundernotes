/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Options page: settings in cards by area (switches, live examples for highlights and dates), the
// sync state per account, export all notes as a zip of Markdown files (D25), import zips or .md files.

import { COLOURS, COLOUR_NAMES, fileName, formatDue, fromMarkdown, hasContent, isoDate, mergeSets, mergeSettings, rgba, setAlwaysShowYear, textOn, toMarkdown, type AnnotationSet, type Settings } from "@thundernotes/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { exportDue, formatDate, recordExport } from "./backup.js";
import { getAllSets, getSet, putSet } from "./store.js";
import type { ToContent } from "./protocol.js";
import { tagCopies as tagAllCopies } from "./tags.js";
import { accountByAddress, addressesById } from "./accounts.js";
import { IGNORED_KEY, ignoredKey, isMissing, type Ignored } from "./deleted.js";
import { SETTINGS_FILE, buildSettingsFile, parseSettingsFile, type SettingsFile } from "./settings-file.js";

const $ = (id: string) => document.getElementById(id)!;

function status(text: string, error = false): void {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}

async function exportAll(): Promise<void> {
  // Each file names its account by address (D42), so an import finds it on any computer.
  const addresses = await addressesById();
  const sets = (await getAllSets()).filter(hasContent).map((s) => {
    const account = s.email.accountId ? addresses.get(s.email.accountId) : undefined;
    return account ? { ...s, email: { ...s.email, account } } : s;
  });
  const files: Record<string, Uint8Array> = {};
  for (const set of sets) files[fileName(set)] = strToU8(toMarkdown(set));
  // What the notes' files don't hold: settings, label colours and order, the task view's choices.
  files[SETTINGS_FILE] = strToU8(await currentSettingsFile());
  const zip = zipSync(files, { level: 6 });
  // A download link instead of the downloads API: no extra permission needed.
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `thundernotes-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  const notes = sets.reduce((n, s) => n + s.annotations.length, 0);
  await recordExport();
  await showLastExport();
  status(`Exported ${sets.length} email${sets.length === 1 ? "" : "s"} with ${notes} highlight${notes === 1 ? "" : "s"} and notes, and the settings.`);
}

/** Markdown texts from the chosen files: .md as is, .zip unpacked; and its settings.json, if any. */
async function readFiles(files: FileList): Promise<{ texts: { name: string; text: string }[]; settings: SettingsFile | null }> {
  const out: { name: string; text: string }[] = [];
  let settings: SettingsFile | null = null;
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
      for (const [name, data] of Object.entries(entries)) {
        if (name.split("/").some((p) => p.startsWith("."))) continue;
        if (name === SETTINGS_FILE) settings = parseSettingsFile(strFromU8(data));
        else if (name.toLowerCase().endsWith(".md")) out.push({ name: `${file.name}/${name}`, text: strFromU8(data) });
      }
    } else if (file.name === SETTINGS_FILE) {
      settings = parseSettingsFile(await file.text());
    } else {
      out.push({ name: file.name, text: await file.text() });
    }
  }
  return { texts: out, settings };
}

// ---- settings in the export (settings.json) ---------------------------------------------------------

/** The task view keeps its choices in this page's origin (same as the options page). */
const TASK_VIEW_KEY = "thundernotes-tasks";
const COLLAPSED_KEY = "foldedCards";
const LAST_COLOUR_KEY = "lastColour";

async function currentSettingsFile(): Promise<string> {
  const stored = await messenger.storage.local.get([...SETTINGS.map((s) => s.key), LAST_COLOUR_KEY, "labelSettings", COLLAPSED_KEY]);
  const options: Record<string, boolean | string> = {};
  for (const { key, on } of SETTINGS) options[key] = stored[key] === undefined ? on : stored[key] === true;
  if (typeof stored[LAST_COLOUR_KEY] === "string") options[LAST_COLOUR_KEY] = stored[LAST_COLOUR_KEY] as string;
  // Per account by address (D42); `labels` stays for older versions reading the file: the first account's.
  const addresses = await addressesById();
  const byId = (stored.labelSettings as Record<string, Settings> | undefined) ?? {};
  const labelsByAccount = Object.fromEntries(Object.entries(byId).flatMap(([id, s]) => (addresses.has(id) ? [[addresses.get(id)!, s]] : [])));
  const labels: Settings = Object.values(byId)[0] ?? { version: 1, labelColours: {} };
  let taskView: unknown;
  try {
    taskView = JSON.parse(localStorage.getItem(TASK_VIEW_KEY) ?? "null") ?? undefined;
  } catch {
    taskView = undefined;
  }
  const collapsed = stored[COLLAPSED_KEY] as Record<string, boolean> | undefined;
  return buildSettingsFile({ options, labels, labelsByAccount, ...(taskView !== undefined ? { taskView } : {}), ...(collapsed && Object.keys(collapsed).length ? { collapsed } : {}) });
}

/**
 * Restores settings from an export: the switches as they were, label colours and order merged
 * label by label with this computer's (the newer wins, as sync does), the task view's choices,
 * collapsed notes added to those collapsed here.
 */
async function restoreSettings(file: SettingsFile): Promise<void> {
  const known = new Set([...SETTINGS.map((s) => s.key), LAST_COLOUR_KEY]);
  const options = Object.fromEntries(Object.entries(file.options).filter(([k]) => known.has(k)));
  const stored = await messenger.storage.local.get(["labelSettings", COLLAPSED_KEY]);
  // Label settings (D42): each account's from the file by its address, merged label by label (the
  // newer wins, as sync does); an older file's one set goes to every account.
  const byId = { ...((stored.labelSettings as Record<string, Settings> | undefined) ?? {}) };
  const incoming: [string, Settings][] = [];
  if (file.labelsByAccount) {
    for (const [address, s] of Object.entries(file.labelsByAccount)) {
      const id = await accountByAddress(address);
      if (id) incoming.push([id, s]);
    }
  } else {
    for (const a of await messenger.accounts.list(false)) incoming.push([a.id, file.labels]);
  }
  for (const [id, s] of incoming) byId[id] = mergeSettings(byId[id] ?? { version: 1, labelColours: {} }, s);
  const collapsed = { ...((stored[COLLAPSED_KEY] as Record<string, boolean> | undefined) ?? {}), ...(file.collapsed ?? {}) };
  await messenger.storage.local.set({ ...options, labelSettings: byId, [COLLAPSED_KEY]: collapsed });
  if (file.taskView !== undefined) {
    try {
      localStorage.setItem(TASK_VIEW_KEY, JSON.stringify(file.taskView));
    } catch {
      // not kept: the task view keeps its own choices
    }
  }
  // The switches on this page show the restored values.
  for (const { key } of SETTINGS) if (typeof options[key] === "boolean") ($(key) as HTMLInputElement).checked = options[key] as boolean;
  showExamples();
}

/** Tags the email's copies in the notes' account (D42); notes waiting for their account tag nothing. */
async function tagCopies(set: AnnotationSet): Promise<void> {
  if (hasContent(set) && (set.email.accountId || !set.email.account)) await tagAllCopies(set.email.messageId, true, "ThunderNotes", set.email.accountId);
}

/**
 * The account an imported set belongs to (D42). `pending`: the file names an account that isn't
 * in Thunderbird; the notes wait for it (never go to another one, dev issue #4).
 */
async function importAccount(set: AnnotationSet): Promise<{ accountId?: string; pending?: string }> {
  if (set.email.account) {
    const named = await accountByAddress(set.email.account);
    return named ? { accountId: named } : { pending: set.email.account };
  }
  // Files from before D42 name no account: the one that has notes on the email, else the first copy's.
  const id = set.email.messageId.replace(/^<|>$/g, "");
  const withNotes = (await getAllSets()).filter((s) => s.email.accountId && s.email.messageId.replace(/^<|>$/g, "") === id);
  if (withNotes.length === 1) return { accountId: withNotes[0]!.email.accountId };
  const copy = (await messenger.messages.query({ headerMessageId: id }).catch(() => null))?.messages.find((m) => m.folder?.accountId && m.folder.name !== "ThunderNotes");
  return { accountId: copy?.folder?.accountId };
}

/** Open messages redraw with the imported notes. Tabs without our display script just fail. */
async function refreshOpenMessages(): Promise<void> {
  const message: ToContent = { type: "refresh" };
  for (const tab of await messenger.tabs.query({})) {
    if (tab.id !== undefined) messenger.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

async function importFiles(files: FileList): Promise<void> {
  status("Importing…");
  const { texts, settings } = await readFiles(files);
  let created = 0;
  let merged = 0;
  let unchanged = 0;
  const problems: string[] = [];
  const repaired: string[] = [];
  const waiting = new Set<string>();
  for (const { name, text } of texts) {
    let incoming: AnnotationSet;
    try {
      // An exported file may have been edited: a section that can't be placed is kept as a note
      // of its own, and said so, instead of failing the file.
      const found: string[] = [];
      incoming = fromMarkdown(text, { onProblem: (message) => found.push(message) });
      if (found.length) repaired.push(`${name}: ${found.join("; ")}`);
    } catch (e) {
      problems.push(`${name}: ${(e as Error).message}`);
      continue;
    }
    // Its account (D42): named in the file, else the one that has notes on the email, else the
    // first copy's (none: assigned when the email is shown or synced).
    const { accountId, pending } = await importAccount(incoming);
    incoming = { ...incoming, email: { ...incoming.email, ...(accountId ? { accountId } : {}) } };
    // The address only finds the account: kept while that account isn't in Thunderbird (the notes
    // go to it once it is added), never synced.
    if (!pending) delete incoming.email.account;
    const local = await getSet(accountId, incoming.email.messageId);
    // Not assigned either (one place per email): notes for two different accounts stay apart.
    if (!accountId && local && (local.email.account ?? "") !== (incoming.email.account ?? "")) {
      problems.push(`${name}: notes on this email already wait for ${local.email.account ? `the account ${local.email.account}` : "their account"}; add that account to Thunderbird and import again.`);
      continue;
    }
    if (pending) waiting.add(pending);
    let result = incoming;
    if (!local) {
      created++;
    } else {
      const m = mergeSets(local, incoming);
      if (!m.added && !m.updated) {
        unchanged++;
        continue;
      }
      merged++;
      result = m.set;
    }
    await putSet(result);
    await tagCopies(result).catch((e) => console.warn("ThunderNotes: tagging after import failed", e));
  }
  const lines = [
    `Read ${texts.length} file${texts.length === 1 ? "" : "s"}: ${created} new email${created === 1 ? "" : "s"}, ${merged} updated, ${unchanged} unchanged.`,
  ];
  if (settings && isOn("importSettings")) {
    await restoreSettings(settings);
    lines.push("Settings restored from the export.");
  } else if (settings) {
    lines.push('The export also has settings: switch on "Also restore settings" and import again to restore them.');
  }
  if (waiting.size) {
    lines.push(`Some notes are for an account that isn't in Thunderbird (${[...waiting].join(", ")}): kept on this computer, not synced and not shown, until that account is added.`);
  }
  if (repaired.length) {
    lines.push(`Imported with repairs (each section that couldn't be placed is a note of its own; where it can't be shown on the email, the toolbar list has it under "Not found in this view") ${repaired.length}:`, ...repaired.map((p) => `• ${p}`));
  }
  if (problems.length) lines.push(`Skipped ${problems.length}:`, ...problems.map((p) => `• ${p}`));
  if (created + merged || (settings && isOn("importSettings"))) {
    await refreshOpenMessages();
    // Imported notes go to the server too (D27).
    messenger.runtime.sendMessage({ type: "syncNow" }).catch(() => {});
  }
  status(lines.join("\n"), problems.length > 0 && created + merged === 0 && !settings);
}

async function showLastExport(): Promise<void> {
  const { due, lastExport } = await exportDue();
  const el = $("lastExport");
  el.textContent =
    `Last export: ${formatDate(lastExport)}.` +
    (due ? " Notes on emails in local folders or POP accounts changed since then. They aren't synced, so an export is their only backup: removing the add-on deletes them." : "");
  el.classList.toggle("warn", due);
}
showLastExport();

// Settings: checkbox id = storage key; `on` = the default when never set.
const SETTINGS: { key: string; on: boolean }[] = [
  { key: "developerFunctions", on: false },
  { key: "showEditHints", on: true },
  { key: "useLastColour", on: true },
  { key: "contrastText", on: true },
  { key: "checkboxCycleToText", on: false },
  { key: "renumberLists", on: true },
  { key: "cmdKLinkPicker", on: true },
  { key: "pastDatesRed", on: true },
  { key: "hideCurrentYear", on: true },
  { key: "tasksStickyTop", on: true },
  { key: "tasksAnimate", on: true },
  { key: "linesScreen", on: false },
  { key: "linesPrint", on: true },
  { key: "tasksKeepOnTick", on: false },
  { key: "syncFolded", on: false },
];
messenger.storage.local.get(SETTINGS.map((s) => s.key)).then((stored) => {
  for (const { key, on } of SETTINGS) {
    const box = $(key) as HTMLInputElement;
    box.checked = stored[key] === undefined ? on : stored[key] === true;
    box.addEventListener("change", () => {
      messenger.storage.local.set({ [key]: box.checked });
      showExamples();
    });
  }
  showExamples();
});

const isOn = (id: string) => ($(id) as HTMLInputElement).checked;

// Modifier keys as keycaps, as the system names them: ⌘ and ⇧ on macOS, Ctrl and Shift elsewhere.
const MAC = /Mac/.test(navigator.platform);
for (const [selector, label] of [[".mod", MAC ? "⌘" : "Ctrl"], [".shift", MAC ? "⇧" : "Shift"]] as const) {
  for (const el of document.querySelectorAll(selector)) {
    const key = document.createElement("kbd");
    key.textContent = label;
    el.replaceWith(key);
  }
}

/** The live examples: highlights in each colour, dates as notes and the task view show them. */
function showExamples(): void {
  const highlights = $("highlightExample");
  highlights.replaceChildren(
    ...COLOUR_NAMES.map((name) => {
      const colour = COLOURS[name];
      const span = document.createElement("span");
      span.className = "hl";
      span.style.background = rgba(colour);
      if (isOn("contrastText")) span.style.color = textOn(colour);
      span.textContent = colour.label;
      return span;
    }),
  );
  setAlwaysShowYear(!isOn("hideCurrentYear"));
  const today = new Date();
  const day = (offset: number, year = today.getFullYear()) => isoDate(new Date(year, today.getMonth(), today.getDate() + offset));
  const sample: [string, string, boolean][] = [
    ["Call Anna", day(-3), true],
    ["Send the offer", day(4), false],
    ["Book flights", isoDate(new Date(today.getFullYear() + 1, 0, 12)), false],
  ];
  $("dateExample").replaceChildren(
    ...sample.flatMap(([text, iso, past], i) => {
      const date = document.createElement("span");
      date.className = `date${past && isOn("pastDatesRed") ? " overdue" : ""}`;
      date.textContent = formatDue(iso);
      const line = document.createElement("div");
      line.append(`☐ ${text} `, date, ...(i === 0 ? [Object.assign(document.createElement("span"), { className: "muted", textContent: "  (in the past)" })] : []));
      return [line];
    }),
  );
}

// ---- sync state (D27, D35) -----------------------------------------------------------------------

interface AccountState {
  id: string;
  name: string;
  synced: boolean;
  lastOk?: string;
  problem?: { message: string; since: string };
}

async function showSyncStatus(): Promise<void> {
  const accounts = (await messenger.runtime.sendMessage<AccountState[]>({ type: "syncStatus" }).catch(() => null)) ?? [];
  const list = $("accounts");
  list.replaceChildren();
  if (!accounts.length) {
    list.innerHTML = `<li class="state">No accounts.</li>`;
    return;
  }
  for (const a of accounts) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = `dot${a.problem ? " bad" : a.synced ? "" : " off"}`;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = a.name;
    const state = document.createElement("span");
    state.className = a.problem ? "problem" : "state";
    state.textContent = a.problem
      ? `Sync problem since ${formatDate(a.problem.since)}: ${a.problem.message}`
      : !a.synced
        ? "Not synced (local folders and POP accounts have no server folder; the export is their backup)"
        : a.lastOk
          ? `Synced, last ${new Date(a.lastOk).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
          : "Synced";
    li.append(dot, name, state);
    list.append(li);
  }
  // Notes of accounts removed from Thunderbird (D42): kept here, not synced; the export keeps them.
  const known = new Set(accounts.map((a) => a.id));
  const orphaned = (await getAllSets()).filter((s) => hasContent(s) && s.email.accountId && !known.has(s.email.accountId)).length;
  // Imported for an account that isn't in Thunderbird (dev issue #4): waiting for it.
  const waiting = (await getAllSets()).filter((s) => hasContent(s) && !s.email.accountId && s.email.account);
  if (waiting.length) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot off";
    const state = document.createElement("span");
    state.className = "state";
    const addresses = [...new Set(waiting.map((s) => s.email.account!))].join(", ");
    state.textContent = `Notes on ${waiting.length} email${waiting.length === 1 ? "" : "s"} were imported for an account that isn't in Thunderbird (${addresses}): kept on this computer, not synced. They go to that account once it is added.`;
    li.append(dot, state);
    list.append(li);
  }
  if (orphaned) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot off";
    const state = document.createElement("span");
    state.className = "state";
    state.textContent = `Notes on ${orphaned} email${orphaned === 1 ? "" : "s"} belong to an account no longer in Thunderbird: kept on this computer, not synced. Export keeps them.`;
    li.append(dot, state);
    list.append(li);
  }
}
showSyncStatus();

/** Notes whose email can't be found (D44): listed with Show and Delete. */
async function showMissing(): Promise<void> {
  const ignored = ((await messenger.storage.local.get(IGNORED_KEY))[IGNORED_KEY] as Ignored | undefined) ?? {};
  const names = new Map((await messenger.accounts.list(false)).map((a) => [a.id, a.name]));
  const sets = (await getAllSets()).filter((s) => hasContent(s) && isMissing(ignored, s));
  const list = $("missingList");
  list.replaceChildren();
  ($("missing") as HTMLElement).hidden = !sets.length;
  for (const set of sets) {
    const li = document.createElement("li");
    li.dataset.key = ignoredKey(set.email.accountId, set.email.messageId);
    const line = document.createElement("div");
    line.className = "line";
    const what = document.createElement("span");
    what.className = "what";
    const count = set.annotations.length + (set.emailNoteMd ? 1 : 0);
    what.textContent = `“${set.email.subject || "(no subject)"}” · ${count} note${count === 1 ? "" : "s"}`;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = [set.email.date ? formatDate(set.email.date) : "", names.get(set.email.accountId ?? "") ?? ""].filter(Boolean).join(" · ");
    const show = document.createElement("button");
    show.textContent = "Show";
    const del = document.createElement("button");
    del.className = "delete";
    del.textContent = "Delete";
    let box: HTMLPreElement | null = null;
    show.addEventListener("click", () => {
      if (box) {
        box.remove();
        box = null;
        show.textContent = "Show";
        return;
      }
      box = document.createElement("pre");
      const parts = [
        ...(set.emailNoteMd ? [`On the whole email:\n${set.emailNoteMd}`] : []),
        ...set.annotations.map((a) => {
          const quote = a.selectors.find((s) => s.type === "TextQuoteSelector") as { exact?: string } | undefined;
          return `On “${quote?.exact ?? ""}”:\n${a.bodyMd || "(highlight only)"}`;
        }),
      ];
      box.textContent = parts.join("\n\n");
      li.append(box);
      show.textContent = "Hide";
    });
    // Two clicks, as in the toolbar list: the second confirms. Armed, the button turns red; not
    // clicked again within 4 seconds, it goes back to "Delete".
    let disarm = 0;
    del.addEventListener("click", async () => {
      if (del.dataset.armed !== "1") {
        del.dataset.armed = "1";
        del.classList.add("armed");
        del.textContent = "Click again to delete";
        disarm = window.setTimeout(() => {
          delete del.dataset.armed;
          del.classList.remove("armed");
          del.textContent = "Delete";
        }, 4000);
        return;
      }
      clearTimeout(disarm);
      del.disabled = true;
      await messenger.runtime.sendMessage({ type: "deleteNotesOf", accountId: set.email.accountId, messageId: set.email.messageId }).catch(() => null);
      await showMissing();
    });
    line.append(what, when, show, del);
    li.append(line);
    list.append(li);
  }
}
// The list at once from what is known; again after the emails were checked, if it changed.
const missingShown = showMissing();
void messenger.runtime
  .sendMessage({ type: "checkEmails" })
  .catch(() => {})
  .then(async () => {
    await missingShown;
    const before = [...$("missingList").children].map((li) => (li as HTMLElement).dataset.key).join();
    const ignored = ((await messenger.storage.local.get(IGNORED_KEY))[IGNORED_KEY] as Ignored | undefined) ?? {};
    const now = (await getAllSets()).filter((s) => hasContent(s) && isMissing(ignored, s)).map((s) => ignoredKey(s.email.accountId, s.email.messageId)).join();
    if (now !== before) await showMissing();
  });

// Opened in a tab of its own (from the task view, D44): it answers, so it is brought to the front
// instead of opened again. Not inside the Add-ons Manager (it couldn't jump there).
const ownTab = new URLSearchParams(location.search).has("tab");
messenger.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type !== "optionsTab" || !ownTab) return undefined;
  return messenger.tabs.getCurrent().then((tab) => (tab?.id !== undefined ? { tabId: tab.id, windowId: tab.windowId } : undefined));
});

/**
 * Come from the task view's "settings" link (D44): to the list, that email's Delete button framed
 * for a moment. Also when this page was open already (the link only brings it to the front).
 */
async function applyFocus(): Promise<void> {
  const { optionsFocus: f } = (await messenger.storage.local.get("optionsFocus")) as { optionsFocus?: { section: string; key: string; at: number } | null };
  if (!f || f.section !== "missing" || Date.now() - f.at > 60_000) return;
  await messenger.storage.local.set({ optionsFocus: null });
  await missingShown;
  const row = [...$("missingList").children].find((li) => (li as HTMLElement).dataset.key === f.key);
  const target = (row?.querySelector("button.delete") as HTMLElement | null) ?? $("missing");
  // Straight there: the card's top at the top of the window.
  ($("missing").hidden ? $("sync") : $("missing")).scrollIntoView?.({ block: "start" });
  target.classList.remove("flash");
  void target.offsetWidth; // restart the animation
  target.classList.add("flash");
  setTimeout(() => target.classList.remove("flash"), 3000);
}
void applyFocus();
messenger.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes as Record<string, { newValue?: unknown }>).optionsFocus?.newValue) void applyFocus();
});

$("syncNow").addEventListener("click", async () => {
  const button = $("syncNow") as HTMLButtonElement;
  button.disabled = true;
  button.textContent = "Syncing…";
  await messenger.runtime.sendMessage({ type: "syncNow" }).catch(() => {});
  await showSyncStatus();
  button.disabled = false;
  button.textContent = "Sync now";
});

// Name of this device (D32): stored only when changed; empty = back to the default.
(async () => {
  const input = $("deviceName") as HTMLInputElement;
  const fallback = (await messenger.thundernotes.deviceName().catch(() => "")) || "This computer";
  const { deviceName } = await messenger.storage.local.get("deviceName");
  input.placeholder = fallback;
  input.value = typeof deviceName === "string" && deviceName.trim() ? deviceName : fallback;
  input.addEventListener("change", () => {
    const name = input.value.trim();
    if (!name) input.value = fallback;
    messenger.storage.local.set({ deviceName: name && name !== fallback ? name : "" });
  });
})();

$("export").addEventListener("click", () => exportAll().catch((e) => status(`Export failed: ${e.message}`, true)));
$("import").addEventListener("click", () => ($("file") as HTMLInputElement).click());
$("file").addEventListener("change", () => {
  const input = $("file") as HTMLInputElement;
  if (input.files?.length) importFiles(input.files).catch((e) => status(`Import failed: ${e.message}`, true));
  input.value = "";
});
