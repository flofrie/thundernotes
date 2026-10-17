/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Settings shared by all devices (D40): for now the colours of labels. They belong to no
 * email, so they travel in a settings carrier of their own in each IMAP account's
 * `ThunderNotes` folder (headers as a note carrier, X-Annot-Ref = SETTINGS_REF, the settings
 * as a JSON attachment). Merged per label: the newer choice wins, also "no colour" (kept with
 * its time, so it reaches the other devices).
 */

import { CARRIER_SUBJECT_PREFIX, CARRIER_VERSION, type Carrier } from "./carrier.js";
import { COLOUR_NAMES, type ColourName } from "./colours.js";
import { mergeLabelColours, sameLabelColours, type LabelColours } from "./label-colours.js";
import { LABEL_ORDER_MODES, mergeLabelOrder, type LabelOrder, type LabelOrderMode } from "./label-order.js";

/** X-Annot-Ref of the settings carrier (in place of an email's Message-ID). */
export const SETTINGS_REF = "thundernotes-settings@thundernotes.invalid";

export interface Settings {
  version: 1;
  labelColours: LabelColours;
  labelOrder?: LabelOrder;
}

/** Both devices' settings: colours per label, the order as a whole (the newer). */
export function mergeSettings(a: Settings, b: Settings): Settings {
  const labelOrder = mergeLabelOrder(a.labelOrder, b.labelOrder);
  return { version: 1, labelColours: mergeLabelColours(a.labelColours, b.labelColours), ...(labelOrder ? { labelOrder } : {}) };
}

/** The same settings (for telling whether the server is up to date). */
export function sameSettings(a: Settings, b: Settings): boolean {
  return sameLabelColours(a.labelColours, b.labelColours) && JSON.stringify(a.labelOrder ?? null) === JSON.stringify(b.labelOrder ?? null);
}

/** Whether there is anything to keep (an empty settings carrier isn't uploaded). */
export function hasSettings(s: Settings): boolean {
  return Object.keys(s.labelColours).length > 0 || !!s.labelOrder;
}

/** Only well-formed entries (a carrier from a newer or damaged version may hold others). */
export function parseSettings(json: string): Settings {
  const data = JSON.parse(json) as { labelColours?: unknown; labelOrder?: unknown };
  const labelColours: LabelColours = {};
  if (data && typeof data.labelColours === "object" && data.labelColours) {
    for (const [label, value] of Object.entries(data.labelColours as Record<string, unknown>)) {
      const v = value as { colour?: unknown; updated?: unknown } | null;
      if (!v || typeof v.updated !== "string") continue;
      if (v.colour !== null && !COLOUR_NAMES.includes(v.colour as ColourName)) continue;
      labelColours[label.toLowerCase()] = { colour: v.colour as ColourName | null, updated: v.updated };
    }
  }
  const o = data?.labelOrder as { mode?: unknown; custom?: unknown; updated?: unknown } | undefined;
  const labelOrder: LabelOrder | undefined =
    o && LABEL_ORDER_MODES.includes(o.mode as LabelOrderMode) && Array.isArray(o.custom) && typeof o.updated === "string"
      ? { mode: o.mode as LabelOrderMode, custom: o.custom.filter((l): l is string => typeof l === "string").map((l) => l.toLowerCase()), updated: o.updated }
      : undefined;
  return { version: 1, labelColours, ...(labelOrder ? { labelOrder } : {}) };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function rfc5322Date(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${DAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())} +0000`
  );
}

function base64Utf8(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const randomToken = (bytes = 8) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

export const SETTINGS_NOTICE = [
  "This message is used by ThunderNotes, a Thunderbird add-on, to store settings",
  "that are the same on all your devices, such as the colours of labels.",
  "",
  "It is internal: there is nothing to do here. Please don't edit or delete it;",
  "ThunderNotes replaces it automatically when the settings change.",
].join("\r\n");

/** The .eml of a settings carrier (CRLF line endings). */
export function buildSettingsCarrier(settings: Settings, options: { client: string; now?: Date }): Carrier {
  const now = options.now ?? new Date();
  const messageId = `tn-settings-${randomToken()}@thundernotes.invalid`;
  const boundary = `tn-${randomToken(12)}`;
  const times = [...Object.values(settings.labelColours).map((c) => c.updated), settings.labelOrder?.updated ?? ""];
  const updated = times.reduce((m, t) => (t > m ? t : m), "") || now.toISOString();
  const json = base64Utf8(JSON.stringify(settings, null, 2)).replace(/.{1,76}/g, "$&\r\n");
  const lines = [
    "From: ThunderNotes <thundernotes@thundernotes.invalid>",
    `Date: ${rfc5322Date(now)}`,
    `Subject: ${CARRIER_SUBJECT_PREFIX} Settings`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    `X-Annot-Version: ${CARRIER_VERSION}`,
    `X-Annot-Ref: <${SETTINGS_REF}>`,
    "X-Annot-Rev: 1",
    `X-Annot-Updated: ${updated}`,
    `X-Annot-Client: ${options.client}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    SETTINGS_NOTICE,
    "",
    `--${boundary}`,
    'Content-Type: application/json; charset=utf-8; name="thundernotes-settings.json"',
    'Content-Disposition: attachment; filename="thundernotes-settings.json"',
    "Content-Transfer-Encoding: base64",
    "",
    json.trimEnd(),
    `--${boundary}--`,
    "",
  ];
  return { eml: lines.join("\r\n"), messageId };
}
