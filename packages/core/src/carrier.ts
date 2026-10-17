/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Carrier messages (D7, D27): one message per email in the account's `ThunderNotes` folder.
 * Headers X-Annot-Version/Ref/Rev/Updated/Client; body = a plain-text notice for people
 * who open it in another client + the D25 Markdown file as a text/markdown attachment.
 * Every revision gets a fresh Message-ID (Thunderbird refuses duplicates in a folder).
 */

import { fileName, hash8, toMarkdown } from "./format.js";
import type { AnnotationSet } from "./index.js";

export const CARRIER_VERSION = 1;
export const CARRIER_SUBJECT_PREFIX = "[ThunderNotes]";

export const CARRIER_NOTICE = [
  "This message is used by ThunderNotes, a Thunderbird add-on, to store the",
  "highlights and notes for one email so they appear on all your devices.",
  "",
  "It is internal: there is nothing to do here. Please don't edit or delete it;",
  "ThunderNotes replaces it automatically when the notes change. To stop",
  "ThunderNotes for good, uninstall the add-on first, then delete this folder.",
].join("\r\n");

export interface CarrierMeta {
  version: number;
  /** Message-ID of the annotated email, without angle brackets. */
  ref: string;
  rev: number;
  updated: string;
  client: string;
}

export interface Carrier {
  eml: string;
  /** Message-ID of the carrier itself, without angle brackets. */
  messageId: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RFC 5322 date in UTC. */
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

/** RFC 2047 encoded word for non-ASCII header values. */
function encodeHeader(value: string): string {
  const flat = value.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(flat) ? flat : `=?UTF-8?B?${base64Utf8(flat)}?=`;
}

function randomToken(bytes = 8): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const stripBrackets = (id: string) => id.trim().replace(/^<|>$/g, "");

/** Builds the .eml of a carrier for one set (CRLF line endings). */
export function buildCarrier(set: AnnotationSet, options: { client: string; now?: Date }): Carrier {
  const now = options.now ?? new Date();
  const ref = stripBrackets(set.email.messageId);
  const messageId = `tn-${hash8(ref)}-${set.rev}-${randomToken()}@thundernotes.invalid`;
  const boundary = `tn-${randomToken(12)}`;
  const file = fileName(set).split("/").pop()!;
  const subject = `${CARRIER_SUBJECT_PREFIX} ${set.email.subject?.trim() || "(no subject)"}`;
  const markdown = base64Utf8(toMarkdown(set)).replace(/.{1,76}/g, "$&\r\n");

  const lines = [
    "From: ThunderNotes <thundernotes@thundernotes.invalid>",
    `Date: ${rfc5322Date(now)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    `X-Annot-Version: ${CARRIER_VERSION}`,
    `X-Annot-Ref: <${ref}>`,
    `X-Annot-Rev: ${set.rev}`,
    `X-Annot-Updated: ${set.updated}`,
    `X-Annot-Client: ${options.client}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    CARRIER_NOTICE,
    "",
    `--${boundary}`,
    `Content-Type: text/markdown; charset=utf-8; name="${file}"`,
    `Content-Disposition: attachment; filename="${file}"`,
    "Content-Transfer-Encoding: base64",
    "",
    markdown.trimEnd(),
    `--${boundary}--`,
    "",
  ];
  return { eml: lines.join("\r\n"), messageId };
}

/**
 * Reads the X-Annot headers. `headers` as Thunderbird's getFull returns them: lower-case
 * names, values as arrays (single strings are accepted too). Null if it isn't a carrier.
 */
export function parseCarrierHeaders(headers: Record<string, string | string[] | undefined>): CarrierMeta | null {
  const get = (name: string) => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    return (Array.isArray(v) ? v[0] : v)?.trim();
  };
  const version = Number(get("x-annot-version"));
  const ref = get("x-annot-ref");
  const rev = Number(get("x-annot-rev"));
  if (!version || !ref || !Number.isFinite(rev)) return null;
  return {
    version,
    ref: stripBrackets(ref),
    rev,
    updated: get("x-annot-updated") ?? "",
    client: get("x-annot-client") ?? "",
  };
}
