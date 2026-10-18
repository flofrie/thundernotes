/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// settings.json in the export zip: what the notes' Markdown files don't hold. The options page's
// switches, label colours and order (D40), the task view's choices, and which notes are collapsed
// on this computer. Not what belongs to one computer (device name, notes column width, sync
// bookkeeping, drafts). Restored on import only when asked to.

import type { Settings } from "@thundernotes/core";

export const SETTINGS_FILE = "settings.json";

export interface SettingsFile {
  thundernotes: "settings";
  version: 1;
  exported: string;
  /** The options page's switches (storage key → on/off) and the last highlight colour. */
  options: Record<string, boolean | string>;
  /** Label colours and order before D42 (one set for all accounts); read from older exports. */
  labels: Settings;
  /** Label colours and order per account (D42), by the account's address. */
  labelsByAccount?: Record<string, Settings>;
  /** The task view's choices (grouping, done, sort, filters), as it keeps them. */
  taskView?: unknown;
  /** Notes collapsed on this computer ("<Message-ID> <card id>"), beside those synced in the notes. */
  collapsed?: Record<string, boolean>;
}

export function buildSettingsFile(parts: Omit<SettingsFile, "thundernotes" | "version" | "exported">, now = new Date()): string {
  const file: SettingsFile = { thundernotes: "settings", version: 1, exported: now.toISOString(), ...parts };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** The settings file, checked; null if it isn't one (or of a newer version). */
export function parseSettingsFile(text: string): SettingsFile | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const f = data as Partial<SettingsFile> | null;
  if (!f || f.thundernotes !== "settings" || f.version !== 1) return null;
  const options = Object.fromEntries(
    Object.entries(f.options && typeof f.options === "object" ? f.options : {}).filter(([, v]) => typeof v === "boolean" || typeof v === "string"),
  );
  const labels = f.labels && typeof f.labels === "object" && f.labels.labelColours && typeof f.labels.labelColours === "object" ? f.labels : { version: 1 as const, labelColours: {} };
  const byAccount = f.labelsByAccount && typeof f.labelsByAccount === "object"
    ? Object.fromEntries(Object.entries(f.labelsByAccount).filter(([, s]) => s && typeof s === "object" && s.labelColours && typeof s.labelColours === "object"))
    : undefined;
  const collapsed = f.collapsed && typeof f.collapsed === "object" ? Object.fromEntries(Object.entries(f.collapsed).filter(([, v]) => v === true)) : undefined;
  return { thundernotes: "settings", version: 1, exported: String(f.exported ?? ""), options, labels, ...(byAccount ? { labelsByAccount: byAccount } : {}), ...(f.taskView !== undefined ? { taskView: f.taskView } : {}), ...(collapsed ? { collapsed } : {}) };
}
