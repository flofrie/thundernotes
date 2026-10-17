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
import { SETTINGS_FILE, buildSettingsFile, parseSettingsFile, type SettingsFile } from "./settings-file.js";

const $ = (id: string) => document.getElementById(id)!;

function status(text: string, error = false): void {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}

async function exportAll(): Promise<void> {
  const sets = (await getAllSets()).filter(hasContent);
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
  const stored = await messenger.storage.local.get([...SETTINGS.map((s) => s.key), LAST_COLOUR_KEY, "labelColours", "labelOrder", COLLAPSED_KEY]);
  const options: Record<string, boolean | string> = {};
  for (const { key, on } of SETTINGS) options[key] = stored[key] === undefined ? on : stored[key] === true;
  if (typeof stored[LAST_COLOUR_KEY] === "string") options[LAST_COLOUR_KEY] = stored[LAST_COLOUR_KEY] as string;
  const labels: Settings = {
    version: 1,
    labelColours: (stored.labelColours as Settings["labelColours"] | undefined) ?? {},
    ...(stored.labelOrder ? { labelOrder: stored.labelOrder as Settings["labelOrder"] } : {}),
  };
  let taskView: unknown;
  try {
    taskView = JSON.parse(localStorage.getItem(TASK_VIEW_KEY) ?? "null") ?? undefined;
  } catch {
    taskView = undefined;
  }
  const collapsed = stored[COLLAPSED_KEY] as Record<string, boolean> | undefined;
  return buildSettingsFile({ options, labels, ...(taskView !== undefined ? { taskView } : {}), ...(collapsed && Object.keys(collapsed).length ? { collapsed } : {}) });
}

/**
 * Restores settings from an export: the switches as they were, label colours and order merged
 * label by label with this computer's (the newer wins, as sync does), the task view's choices,
 * collapsed notes added to those collapsed here.
 */
async function restoreSettings(file: SettingsFile): Promise<void> {
  const known = new Set([...SETTINGS.map((s) => s.key), LAST_COLOUR_KEY]);
  const options = Object.fromEntries(Object.entries(file.options).filter(([k]) => known.has(k)));
  const stored = await messenger.storage.local.get(["labelColours", "labelOrder", COLLAPSED_KEY]);
  const here: Settings = {
    version: 1,
    labelColours: (stored.labelColours as Settings["labelColours"] | undefined) ?? {},
    ...(stored.labelOrder ? { labelOrder: stored.labelOrder as Settings["labelOrder"] } : {}),
  };
  const labels = mergeSettings(here, file.labels);
  const collapsed = { ...((stored[COLLAPSED_KEY] as Record<string, boolean> | undefined) ?? {}), ...(file.collapsed ?? {}) };
  await messenger.storage.local.set({
    ...options,
    labelColours: labels.labelColours,
    ...(labels.labelOrder ? { labelOrder: labels.labelOrder } : {}),
    [COLLAPSED_KEY]: collapsed,
  });
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

/** Tags every copy of the email that Thunderbird has (by Message-ID). */
async function tagCopies(set: AnnotationSet): Promise<void> {
  if (hasContent(set)) await tagAllCopies(set.email.messageId, true, "ThunderNotes");
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
  for (const { name, text } of texts) {
    let incoming: AnnotationSet;
    try {
      incoming = fromMarkdown(text);
    } catch (e) {
      problems.push(`${name}: ${(e as Error).message}`);
      continue;
    }
    const local = await getSet(incoming.email.messageId);
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
}
showSyncStatus();

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
