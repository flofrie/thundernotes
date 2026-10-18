/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// IMAP sync (D7, D14, D27). Each IMAP account keeps one carrier message per annotated email
// in its `ThunderNotes` folder. Local changes are pushed a moment later (new revision
// imported, old ones deleted permanently); carriers from other devices are pulled at startup,
// periodically and when Thunderbird reports changes in the folder, then merged (mergeSets).
// Emails in local folders or POP accounts are not synced. Settings shared by all devices (label
// colours, D40) travel in one settings carrier per account, merged per label.

import {
  SETTINGS_REF,
  buildCarrier,
  buildSettingsCarrier,
  hasSettings,
  mergeSettings,
  parseSettings,
  sameSettings,
  type ColourName,
  type LabelColours,
  type LabelOrder,
  type LabelOrderMode,
  type Settings,
  type SettingsByAccount,
  fromMarkdown,
  gcTombstones,
  hasContent,
  hasDeletions,
  mergeSets,
  parseCarrierHeaders,
  rememberSynced,
  withBases,
  type AnnotationSet,
} from "@thundernotes/core";
import { accountByAddress } from "./accounts.js";
import { deleteSet, getAllSets, getSet, putSet } from "./store.js";
import { tagCopies } from "./tags.js";

export const CARRIER_FOLDER = "ThunderNotes";
const PUSH_DELAY_MS = 2000;

/** What we know about one carrier message (by its Message-ID). */
interface CarrierEntry {
  tbId: number;
  /** Message-ID of the annotated email; "" for messages that aren't carriers. */
  ref: string;
  rev: number;
  updated: string;
  client: string;
  /** Its content has been merged into the local store. */
  merged: boolean;
}

interface AccountState {
  folderId: string | null;
  carriers: Record<string, CarrierEntry>;
  /** Carriers we deleted that may still be listed until the folder is expunged. */
  deleted?: string[];
  /**
   * Carriers that couldn't be read, with the reason; warned about while they exist (D35). Kept:
   * never removed by cleanup (they may hold notes this version doesn't understand, e.g. from a
   * newer ThunderNotes), only by the user; read again after an update of the add-on (`version`).
   */
  unreadable?: Record<string, { subject: string; reason: string; version?: string }>;
  /** Settings as the server has them (read from settings carriers or uploaded), D40. Older versions stored only the colours. */
  settingsSynced?: Settings | LabelColours;
}

export interface SyncHooks {
  /** Local sets changed by a pull: redraw open messages. */
  changed(refs: string[]): void;
  /** The carrier folder went missing and was recreated (D20 notice); `where` says what became of it. */
  folderRestored(accountName: string, where: LostFolder): void;
  /** The carrier folder was unsubscribed and has been subscribed again (D36 notice). */
  folderResubscribed(accountName: string): void;
  /** Sync started or stopped failing for an account (D35): update the warning. */
  problemsChanged(problems: SyncProblem[]): void;
}

/** What kind of ThunderNotes-specific problem (D35); the toolbar list explains each. */
export type SyncProblemKind = "folder" | "upload" | "read" | "cleanup" | "other";

/** Sync of an account failing (D35): since when, how often in a row, and why. */
export interface SyncProblem {
  accountId: string;
  accountName: string;
  since: string;
  failures: number;
  kind: SyncProblemKind;
  message: string;
  /** The messages concerned (unreadable carriers), so the toolbar list can offer to delete them. */
  items?: { id: string; subject: string }[];
}

/** A sync failure of a known kind; `now`: warn at once (it won't be retried by itself). */
export class SyncError extends Error {
  constructor(
    readonly kind: SyncProblemKind,
    message: string,
    readonly now = false,
    readonly items?: { id: string; subject: string }[]
  ) {
    super(message);
  }
}

/** Firefox network errors (0x804B…: unknown host, refused, timeout, offline, reset, interrupt, proxy). */
const NETWORK_STATUS = new Set([0x804b001e, 0x804b000d, 0x804b000e, 0x804b0010, 0x804b0014, 0x804b0047, 0x804b002a, 0x804b0048]);

/**
 * The server can't be reached at all (no network, offline, server down): not a ThunderNotes
 * problem, Thunderbird shows those itself, so it doesn't count towards the warning.
 */
export function isConnectionError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = String((error as Error)?.message ?? error);
  for (const m of message.matchAll(/status:?\s*(\d{9,10})/g)) if (NETWORK_STATUS.has(Number(m[1]))) return true;
  return /NS_ERROR_(?:UNKNOWN_HOST|CONNECTION_REFUSED|NET_TIMEOUT|NET_RESET|NET_INTERRUPT|OFFLINE|UNKNOWN_PROXY_HOST|PROXY_CONNECTION_REFUSED)/.test(message);
}

/** Failures in a row before the warning shows: one can be a passing network hiccup. */
const WARN_AFTER = 2;
const PROBLEMS_KEY = "syncProblems";

async function loadProblems(): Promise<Record<string, SyncProblem>> {
  const { [PROBLEMS_KEY]: stored } = await messenger.storage.local.get(PROBLEMS_KEY);
  return stored && typeof stored === "object" ? (stored as Record<string, SyncProblem>) : {};
}

/** Accounts whose sync failed WARN_AFTER times or more in a row. */
export async function syncProblems(): Promise<SyncProblem[]> {
  return Object.values(await loadProblems()).filter((p) => p.failures >= WARN_AFTER);
}

const LAST_OK_KEY = "syncLastOk";

/** When each account last synced without a problem (for the options page), at most once a minute. */
async function recordSuccess(accountId: string): Promise<void> {
  const { [LAST_OK_KEY]: stored } = await messenger.storage.local.get(LAST_OK_KEY);
  const all = stored && typeof stored === "object" ? (stored as Record<string, string>) : {};
  if (all[accountId] && Date.now() - Date.parse(all[accountId]) < 60_000) return;
  await messenger.storage.local.set({ [LAST_OK_KEY]: { ...all, [accountId]: new Date().toISOString() } });
}

/** Per account: synced (IMAP) or not (local, POP), when it last synced, its problem if any. */
export async function syncStatus(): Promise<{ id: string; name: string; synced: boolean; lastOk?: string; problem?: SyncProblem }[]> {
  const { [LAST_OK_KEY]: stored } = await messenger.storage.local.get(LAST_OK_KEY);
  const lastOk = stored && typeof stored === "object" ? (stored as Record<string, string>) : {};
  const problems = new Map((await syncProblems()).map((p) => [p.accountId, p]));
  return (await messenger.accounts.list(false)).map((a) => ({
    id: a.id,
    name: a.name,
    synced: a.type === "imap",
    ...(lastOk[a.id] ? { lastOk: lastOk[a.id] } : {}),
    ...(problems.has(a.id) ? { problem: problems.get(a.id)! } : {}),
  }));
}

async function recordOutcome(accountId: string, error: unknown): Promise<void> {
  if (error === null) await recordSuccess(accountId).catch(() => {});
  const all = await loadProblems();
  const before = JSON.stringify(Object.values(all).filter((p) => p.failures >= WARN_AFTER));
  if (error === null) {
    if (!all[accountId]) return;
    // A carrier that can't be read stays a problem while it is there, whatever else succeeds.
    if (all[accountId].kind === "read") {
      const state = await loadState(accountId);
      if (Object.keys(state.unreadable ?? {}).some((id) => id in state.carriers)) return;
    }
    delete all[accountId];
  } else if (isConnectionError(error)) {
    log(accountId, `server not reachable, not counted: ${(error as Error)?.message ?? error}`);
    return;
  } else {
    const account = await messenger.accounts.get(accountId).catch(() => null);
    const known = all[accountId];
    const failures = (known?.failures ?? 0) + 1;
    all[accountId] = {
      accountId,
      accountName: account?.name ?? accountId,
      since: known?.since ?? new Date().toISOString(),
      failures: error instanceof SyncError && error.now ? Math.max(failures, WARN_AFTER) : failures,
      kind: error instanceof SyncError ? error.kind : "other",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof SyncError && error.items && { items: error.items }),
    };
  }
  await messenger.storage.local.set({ [PROBLEMS_KEY]: all });
  const after = Object.values(all).filter((p) => p.failures >= WARN_AFTER);
  if (JSON.stringify(after) !== before) hooks.problemsChanged(after);
}

/** Sync work for an account, one step at a time, with its outcome recorded for the warning. */
function tracked<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  return serial(accountId, async () => {
    try {
      const result = await work();
      await recordOutcome(accountId, null);
      return result;
    } catch (e) {
      await recordOutcome(accountId, e).catch(() => {});
      throw e;
    }
  });
}

/**
 * What became of a carrier folder that is no longer at its place: found elsewhere (renamed or
 * moved, by this or another device, webmail or on the server), in the trash, or not found.
 */
export type LostFolder = { kind: "moved"; path: string } | { kind: "trash" } | { kind: "unknown" };

let hooks: SyncHooks = { changed() {}, folderRestored() {}, folderResubscribed() {}, problemsChanged() {} };

/** What sync decided, in the add-on's console (Debug Add-ons → Inspect), for odd cases. */
function log(accountId: string, message: string): void {
  console.info(`ThunderNotes sync (${accountId}): ${message}`);
}

/** Accounts checked this session for an unsubscribed carrier folder while nothing pointed to one. */
const subscriptionChecked = new Set<string>();

/**
 * An unsubscribed carrier folder is hidden from add-ons, and sync silently stopped (D36): ask
 * the server, and if the folder is there, subscribe it again and wait until Thunderbird shows it.
 */
async function resubscribe(accountId: string): Promise<tb.MailFolder | null> {
  const result = await messenger.thundernotes.subscribeCarrierFolder(accountId, CARRIER_FOLDER).catch((e) => {
    log(accountId, `subscription check failed: ${e?.message ?? e}`);
    return "missing" as const;
  });
  log(accountId, `carrier folder not visible; on the server: ${result}`);
  if (result !== "subscribed" && result !== "visible") return null;
  for (let i = 0; i < 20; i++) {
    const folder = await findFolder(accountId);
    if (folder) {
      if (result === "subscribed") {
        const account = await messenger.accounts.get(accountId);
        hooks.folderResubscribed(account?.name ?? accountId);
      }
      return folder;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new SyncError("folder", `The folder "${CARRIER_FOLDER}" was subscribed again but Thunderbird doesn't show it yet; it should appear after a restart.`);
}

export function setSyncHooks(h: SyncHooks): void {
  hooks = h;
}

const norm = (messageId: string) => messageId.trim().replace(/^<|>$/g, "");

// ---- small helpers ------------------------------------------------------------------------

async function clientId(): Promise<string> {
  const { clientId } = await messenger.storage.local.get("clientId");
  if (typeof clientId === "string") return clientId;
  const id = `tb-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  await messenger.storage.local.set({ clientId: id });
  return id;
}

const stateKey = (accountId: string) => `sync:${accountId}`;

async function loadState(accountId: string): Promise<AccountState> {
  const { [stateKey(accountId)]: s } = await messenger.storage.local.get(stateKey(accountId));
  return (s as AccountState | undefined) ?? { folderId: null, carriers: {} };
}

async function saveState(accountId: string, state: AccountState): Promise<void> {
  await messenger.storage.local.set({ [stateKey(accountId)]: state });
}

/** All sync work for one account runs one step at a time. */
const queues = new Map<string, Promise<unknown>>();
function serial<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(accountId) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(accountId, next);
  return next;
}

export async function isImapAccount(accountId: string | undefined): Promise<boolean> {
  if (!accountId) return false;
  const account = await messenger.accounts.get(accountId).catch(() => null);
  return account?.type === "imap";
}

async function allMessages(folderId: string): Promise<tb.MessageHeader[]> {
  const out: tb.MessageHeader[] = [];
  let page = await messenger.messages.list(folderId);
  out.push(...page.messages);
  while (page.id) {
    page = await messenger.messages.continueList(page.id);
    out.push(...page.messages);
  }
  return out;
}

/** "Delete permanently": an options object from TB 137, the (deprecated) boolean before. */
async function deleteOptions(): Promise<{ deletePermanently: boolean } | boolean> {
  const { version } = await messenger.runtime.getBrowserInfo();
  return parseInt(version, 10) >= 137 ? { deletePermanently: true } : true;
}

/** At most `ms`, so an unreachable server doesn't stall sync. */
function within<T>(ms: number, promise: Promise<T>): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(resolve, ms))]);
}

// ---- the carrier folder ------------------------------------------------------------------------

async function findFolder(accountId: string): Promise<tb.MailFolder | null> {
  const account = await messenger.accounts.get(accountId);
  if (!account?.rootFolder) return null;
  const subfolders = await messenger.folders.getSubFolders(account.rootFolder.id, false);
  return subfolders.find((f) => f.name === CARRIER_FOLDER) ?? null;
}

/**
 * Looks for the carriers we knew (by Message-ID) elsewhere in Thunderbird. Thunderbird only
 * finds them in folders it has seen, so "unknown" is possible after a change elsewhere.
 */
async function locate(state: AccountState): Promise<LostFolder> {
  for (const id of Object.keys(state.carriers).slice(0, 5)) {
    const hit = (await messenger.messages.query({ headerMessageId: id }).catch(() => null))?.messages[0];
    const folder = hit?.folder;
    if (!folder) continue;
    const parents = await messenger.folders.getParentFolders(folder.id).catch(() => []);
    const inTrash = [folder, ...parents].some((f) => f.specialUse?.includes("trash"));
    return inTrash ? { kind: "trash" } : { kind: "moved", path: folder.path };
  }
  return { kind: "unknown" };
}

/** The account's carrier folder; created when `create` is set. Detects a deleted folder (D20). */
/** Carrier folders set up in this session (search exclusion, fetching: D19, D27). */
const prepared = new Set<string>();

async function carrierFolder(accountId: string, state: AccountState, create: boolean): Promise<tb.MailFolder | null> {
  let folder = await findFolder(accountId);
  // Not visible: maybe unsubscribed. Checked whenever sync needs the folder; otherwise (a new
  // device whose notes are all on the server) once per session.
  if (!folder && (create || state.folderId || !subscriptionChecked.has(accountId))) {
    subscriptionChecked.add(accountId);
    folder = await resubscribe(accountId);
  }
  if (!folder && (create || state.folderId)) {
    log(accountId, state.folderId ? "carrier folder missing on the server: creating it again" : "creating the carrier folder");
    const account = await messenger.accounts.get(accountId);
    if (!account?.rootFolder) return null;
    const lost = state.folderId !== null;
    const where = lost ? await locate(state) : null;
    try {
      folder = await messenger.folders.create(account.rootFolder.id, CARRIER_FOLDER);
    } catch (e) {
      // Typically: the folder still exists on the server but isn't subscribed, so Thunderbird
      // doesn't show it to add-ons, and the server refuses to create it again.
      if (isConnectionError(e)) throw e;
      throw new SyncError(
        "folder",
        `The folder "${CARRIER_FOLDER}" can't be reached and couldn't be created (${(e as Error)?.message ?? e}). ` +
          `If you unsubscribed it, subscribe it again (right-click the account → Subscribe…).`
      );
    }
    // A restored folder has the old folder's id: set it up again (it is a new folder).
    prepared.delete(folder.id);
    state.carriers = {};
    if (where) hooks.folderRestored(account.name, where);
  }
  if (folder) state.folderId = folder.id;
  // Excluded from global search and fetched promptly: on creation, restore, and once per
  // session (also repairs a setting changed by hand in Folder Properties).
  if (folder && !prepared.has(folder.id)) {
    prepared.add(folder.id);
    await messenger.thundernotes.prepareCarrierFolder(folder.id).catch((e) => console.warn("ThunderNotes: folder setup", e));
  }
  return folder;
}

/** Brings the carrier index up to date with the folder's messages (reads headers of new ones). */
async function scan(folder: tb.MailFolder, state: AccountState): Promise<void> {
  const seen = new Set<string>();
  let fresh = 0;
  const deleted = new Set(state.deleted ?? []);
  for (const m of await allMessages(folder.id)) {
    seen.add(m.headerMessageId);
    if (deleted.has(m.headerMessageId)) continue; // flagged deleted, not expunged yet
    const known = state.carriers[m.headerMessageId];
    // Filed as "not a carrier" although it looks like one (its headers couldn't be read then,
    // before the fix below): read it again.
    const recheck = known && !known.ref && m.subject?.startsWith("[ThunderNotes]");
    if (known && !recheck) {
      known.tbId = m.id;
      continue;
    }
    fresh++;
    const full = await messenger.messages.getFull(m.id).catch((e) => {
      log(folder.accountId ?? "?", `couldn't read the headers of "${m.subject}" yet: ${e?.message ?? e}`);
      return null;
    });
    // Headers not available yet (e.g. not downloaded): not decided, read again next time.
    if (!full?.headers || !Object.keys(full.headers).length) {
      delete state.carriers[m.headerMessageId];
      continue;
    }
    const meta = parseCarrierHeaders(full.headers);
    state.carriers[m.headerMessageId] = meta
      ? { tbId: m.id, ref: norm(meta.ref), rev: meta.rev, updated: meta.updated, client: meta.client, merged: false }
      : { tbId: m.id, ref: "", rev: 0, updated: "", client: "", merged: true };
  }
  if (fresh) log(folder.accountId ?? "?", `found ${fresh} new message(s) in ${folder.path} (${seen.size} in all)`);
  for (const id of Object.keys(state.carriers)) if (!seen.has(id)) delete state.carriers[id];
  state.deleted = [...deleted].filter((id) => seen.has(id));
}

function findPart(part: tb.MessagePart, type: string): tb.MessagePart | null {
  if (part.contentType === type) return part;
  for (const p of part.parts ?? []) {
    const hit = findPart(p, type);
    if (hit) return hit;
  }
  return null;
}

/** The AnnotationSet stored in one carrier. */
async function readCarrier(tbId: number): Promise<AnnotationSet> {
  const full = await messenger.messages.getFull(tbId);
  const part = findPart(full, "text/markdown");
  if (!part?.partName) throw new Error("carrier without Markdown part");
  // getFull leaves attachment bodies empty (spike finding); read the attachment file.
  const file = await messenger.messages.getAttachmentFile(tbId, part.partName);
  return fromMarkdown(await file.text());
}

/** Same annotations, tombstones, whole-email note and folding (ignoring revision and timestamps of the set). */
function sameNotes(a: AnnotationSet, b: AnnotationSet): boolean {
  const key = (s: AnnotationSet) =>
    JSON.stringify([
      // What the user sees, not timestamps or merge bookkeeping.
      [...s.annotations]
        .sort((x, y) => x.id.localeCompare(y.id))
        .map((a) => [a.id, a.bodyMd, a.colour ?? "", a.selectors, a.tags ?? []]),
      [...(s.tombstones ?? [])].sort((x, y) => x.id.localeCompare(y.id)),
      s.emailNoteMd ?? "",
      s.emailNoteColour ?? "",
      Object.entries(s.folded ?? {}).sort(([x], [y]) => x.localeCompare(y)),
      s.purgedBefore ?? "",
    ]);
  return key(a) === key(b);
}

/** A carrier's set taken over as is (nothing local): its texts are now synced. */
function adopt(incoming: AnnotationSet, ref: string, accountId: string): AnnotationSet {
  const set: AnnotationSet = {
    ...incoming,
    email: { ...incoming.email, messageId: ref, accountId },
    annotations: incoming.annotations.map(({ textBase: _, ...a }) => a),
  };
  delete set.emailNoteBase;
  return rememberSynced(set, set);
}

/** Merges every not-yet-merged carrier of one email into the local store. */
async function mergeRemote(accountId: string, ref: string, state: AccountState): Promise<boolean> {
  let changed = false;
  for (const [id, entry] of Object.entries(state.carriers)) {
    if (entry.ref !== ref || entry.merged) continue;
    try {
      const incoming = await readCarrier(entry.tbId);
      // The notes must be for the email the headers name; else they'd be merged into the wrong one.
      if (norm(incoming.email.messageId) !== ref) throw new Error(`the notes inside are for another email (${incoming.email.messageId})`);
      const local = await getSet(accountId, ref);
      // Three-way per note against the base the carrier names (D32).
      const result = local
        ? mergeSets(local, incoming, undefined, "sync").set
        : adopt(incoming, ref, accountId);
      if (local && result.rev === local.rev) {
        await putSet(result); // only the sync history learnt the incoming texts
      } else {
        // Only took over the other device's state: adopt its revision, so we don't echo it back.
        if (sameNotes(result, incoming)) {
          result.rev = incoming.rev;
          result.updated = incoming.updated;
        }
        result.email.accountId ??= accountId;
        await putSet(result);
        changed = true;
      }
    } catch (e) {
      console.warn(`ThunderNotes: could not read carrier for ${ref}`, e);
      if (isConnectionError(e)) continue; // read it next time
      const subject = (await messenger.messages.get(entry.tbId).catch(() => null))?.subject ?? ref;
      state.unreadable = { ...state.unreadable, [id]: { subject, reason: String((e as Error)?.message ?? e), version: addonVersion() } };
    }
    entry.merged = true;
  }
  return changed;
}

/** This add-on's version (unreadable carriers are read again after an update). */
const addonVersion = () => messenger.runtime.getManifest?.().version ?? "";

/** Unreadable carriers recorded by an earlier version of the add-on: read again (it may understand them now). */
function retryAfterUpdate(state: AccountState): void {
  for (const [id, u] of Object.entries(state.unreadable ?? {})) {
    if ((u.version ?? "") === addonVersion() || !state.carriers[id]) continue;
    delete state.unreadable![id];
    state.carriers[id]!.merged = false;
  }
}

async function deleteCarriers(state: AccountState, keep: (id: string, e: CarrierEntry) => boolean): Promise<void> {
  // Only carriers whose content is merged here: never an unreadable one (it may hold notes merged
  // nowhere; only the user removes it), nor one not read yet or whose reading failed for the
  // connection (dev issue #1: it was deleted by the next upload, its notes merged nowhere).
  const remove = Object.entries(state.carriers).filter(([id, e]) => e.ref && !keep(id, e) && e.merged && !state.unreadable?.[id]);
  if (!remove.length) return;
  await messenger.messages
    .delete(
      remove.map(([, e]) => e.tbId),
      await deleteOptions()
    )
    .catch((e) => {
      if (isConnectionError(e)) throw e;
      throw new SyncError("cleanup", `Old versions of ThunderNotes messages couldn't be removed (${e?.message ?? e}).`);
    });
  for (const [id] of remove) delete state.carriers[id];
  state.deleted = [...new Set([...(state.deleted ?? []), ...remove.map(([id]) => id)])];
  if (state.folderId) {
    await within(30_000, messenger.thundernotes.expungeFolder(state.folderId).catch((e) => console.warn("ThunderNotes: expunge", e)));
  }
}

// ---- push ---------------------------------------------------------------------------------------

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Pushes an email's notes in one account (D42) a moment after the last change. */
export function schedulePush(accountId: string | undefined, messageId: string): void {
  if (!accountId) return; // not assigned to an account yet: pullAll does that, then pushes
  const ref = norm(messageId);
  const key = `${accountId}\u001f${ref}`;
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      push(accountId, ref).catch((e) => console.error(`ThunderNotes: sync of ${ref} failed`, e));
    }, PUSH_DELAY_MS)
  );
}

/** Runs scheduled pushes now (tests; before the background unloads). */
export async function flushPushes(): Promise<void> {
  if (settingsTimer) {
    clearTimeout(settingsTimer);
    settingsTimer = undefined;
    await pushSettingsAll();
  }
  const keys = [...timers.keys()];
  for (const key of keys) {
    clearTimeout(timers.get(key));
    timers.delete(key);
  }
  for (const key of keys) {
    const [accountId, ref] = key.split("\u001f") as [string, string];
    await push(accountId, ref);
  }
}

async function push(accountId: string, ref: string): Promise<void> {
  const set = await getSet(accountId, ref);
  if (!set || !(await isImapAccount(accountId))) return;
  const changedByMerge = await tracked(accountId!, async () => {
    const state = await loadState(accountId!);
    try {
      const needed = hasContent(set) || hasDeletions(set);
      const folder = await carrierFolder(accountId!, state, needed);
      if (!folder) return false;
      await scan(folder, state);
      // Changes from other devices first, so nothing is overwritten.
      const merged = await mergeRemote(accountId!, ref, state);
      const local = gcTombstones((await getSet(accountId, ref)) ?? set);
      if (!hasContent(local) && !hasDeletions(local)) {
        await deleteCarriers(state, (_, e) => e.ref !== ref);
        await deleteSet(accountId, ref);
        return merged;
      }
      // Each note names the synced text it was edited from: the receiver's merge base (D32).
      const carrier = buildCarrier(withBases(local), { client: await clientId() });
      const file = new File([carrier.eml], "carrier.eml", { type: "message/rfc822" });
      const header = await messenger.messages.import(file, folder.id, { read: true, new: false }).catch((e) => {
        if (isConnectionError(e)) throw e;
        throw new SyncError("upload", `The server didn't accept the message with the notes of "${local.email.subject ?? ref}" (${e?.message ?? e}).`);
      });
      log(accountId!, `uploaded revision ${local.rev} of ${ref} to ${folder.path}`);
      state.carriers[carrier.messageId] = {
        tbId: header.id,
        ref,
        rev: local.rev,
        updated: local.updated,
        client: await clientId(),
        merged: true,
      };
      // Recorded before the old revisions go: a crash in between leaves a duplicate, never a gap.
      await saveState(accountId!, state);
      await deleteCarriers(state, (id, e) => e.ref !== ref || id === carrier.messageId);
      // The uploaded texts are synced now: possible bases for the next merge.
      const current = await getSet(accountId, ref);
      if (current) await putSet(rememberSynced(current, local));
      return merged;
    } finally {
      await saveState(accountId!, state);
    }
  });
  if (changedByMerge) hooks.changed([ref]);
}

// ---- pull ---------------------------------------------------------------------------------------

/** Fetches carriers of one account and merges what changed; pushes what's newer locally. */
export function pull(accountId: string): Promise<void> {
  return tracked(accountId, async () => {
    const state = await loadState(accountId);
    const changed: string[] = [];
    const toPush: string[] = [];
    try {
      const localSets = (await getAllSets()).filter((s) => s.email.accountId === accountId);
      const folder = await carrierFolder(accountId, state, localSets.some(hasContent));
      if (!folder) return;
      await within(30_000, messenger.thundernotes.refreshFolder(folder.id).catch(() => {}));
      await scan(folder, state);
      retryAfterUpdate(state);

      // Settings (D40): merged first; uploaded again (a moment later) if this device knows more.
      await mergeSettingsCarriers(accountId, state);
      const local = await getSettings(accountId);
      const settingsCarriers = Object.values(state.carriers).filter((e) => e.ref === SETTINGS_REF).length;
      if (hasSettings(local) && (!sameSettings(local, synced(state)) || settingsCarriers !== 1)) scheduleSettingsPush();

      const refs = new Set(Object.values(state.carriers).filter((e) => e.ref && e.ref !== SETTINGS_REF && !e.merged).map((e) => e.ref));
      for (const ref of refs) if (await mergeRemote(accountId, ref, state)) changed.push(ref);

      // Consolidate: several carriers for one email, or local changes not on the server yet.
      const newest = new Map<string, CarrierEntry[]>();
      // Readable ones only: an unreadable carrier is neither the newest state nor removed.
      for (const [id, e] of Object.entries(state.carriers)) if (e.ref && !state.unreadable?.[id]) newest.set(e.ref, [...(newest.get(e.ref) ?? []), e]);
      for (const set of await getAllSets()) {
        if (set.email.accountId !== accountId) continue;
        const ref = norm(set.email.messageId);
        const gced = gcTombstones(set);
        if (gced !== set) await putSet(gced);
        const carriers = newest.get(ref) ?? [];
        const latest = carriers.reduce((m, e) => Math.max(m, e.rev), -1);
        if (gced.rev > latest || gced !== set || (!hasContent(gced) && !hasDeletions(gced))) {
          toPush.push(ref); // something newer here than on the server
        } else if (carriers.length > 1) {
          // All merged and nothing new: just remove the extra carriers (e.g. old revisions
          // another device flagged deleted but that weren't expunged yet). No new revision.
          const keepId = Object.entries(state.carriers).find(([id, e]) => e.ref === ref && e.rev === latest && !state.unreadable?.[id])![0];
          await deleteCarriers(state, (id, e) => e.ref !== ref || id === keepId);
        }
      }
    } finally {
      await saveState(accountId, state);
    }
    for (const ref of toPush) schedulePush(accountId, ref);
    if (changed.length) {
      for (const ref of changed) await retag(accountId, ref);
      hooks.changed(changed);
    }
    // Carriers that can't be read: warned about at once and for as long as they are in the
    // folder (they aren't read again by themselves); gone, the warning goes too.
    const unreadable = Object.entries(state.unreadable ?? {}).filter(([id]) => id in state.carriers);
    // Entries stored by an earlier version are plain text, without the subject: look it up.
    let repaired = false;
    for (const pair of unreadable) {
      const value = pair[1] as unknown;
      if (value && typeof value === "object" && (value as { subject?: string }).subject) continue;
      const subject = (await messenger.messages.get(state.carriers[pair[0]]!.tbId).catch(() => null))?.subject ?? pair[0];
      pair[1] = { subject, reason: typeof value === "string" ? value : "can't be read" };
      repaired = true;
    }
    if (repaired || unreadable.length !== Object.keys(state.unreadable ?? {}).length) {
      state.unreadable = Object.fromEntries(unreadable);
      await saveState(accountId, state);
    }
    if (unreadable.length) {
      throw new SyncError(
        "read",
        `ThunderNotes messages that can't be read: ${unreadable.map(([, u]) => `"${u.subject}": ${u.reason}`).join("; ")}`,
        true,
        unreadable.map(([id, u]) => ({ id, subject: u.subject }))
      );
    }
  });
}

// ---- settings: label colours and order (D40), per account (D42) -------------------------------------

/** Label colours and order per account (D42): Thunderbird's account id → its settings. */
export const LABEL_SETTINGS_KEY = "labelSettings";
/** Before D42: one set of label settings for the whole profile. */
const LABEL_COLOURS_KEY = "labelColours";
const LABEL_ORDER_KEY = "labelOrder";

/**
 * Every account's label settings. The first time (from the shared settings before D42): every
 * account starts with the colours and order used so far.
 */
export function getAllSettings(): Promise<SettingsByAccount> {
  return settingsLocked(readAllSettings);
}

/**
 * Reads and writes of the label settings one after another: two accounts' pulls (or a choice made
 * meanwhile) each wrote the whole map back, and the later write lost the other's merge.
 */
let settingsQueue: Promise<unknown> = Promise.resolve();
function settingsLocked<T>(work: () => Promise<T>): Promise<T> {
  const next = settingsQueue.then(work, work);
  settingsQueue = next.catch(() => {});
  return next;
}

/** One account's settings changed by `change`, read and written within the lock. */
function updateSettings(accountId: string, change: (s: Settings) => Settings): Promise<void> {
  return settingsLocked(async () => {
    const all = await readAllSettings();
    const next = change(structuredClone(all[accountId] ?? { version: 1, labelColours: {} }));
    await messenger.storage.local.set({ [LABEL_SETTINGS_KEY]: { ...all, [accountId]: next } });
  });
}

async function readAllSettings(): Promise<SettingsByAccount> {
  const stored = await messenger.storage.local.get([LABEL_SETTINGS_KEY, LABEL_COLOURS_KEY, LABEL_ORDER_KEY]);
  const byAccount = stored[LABEL_SETTINGS_KEY];
  if (byAccount && typeof byAccount === "object") return byAccount as SettingsByAccount;
  const colours = stored[LABEL_COLOURS_KEY];
  const order = stored[LABEL_ORDER_KEY];
  const shared: Settings = {
    version: 1,
    labelColours: colours && typeof colours === "object" ? (colours as LabelColours) : {},
    ...(order && typeof order === "object" ? { labelOrder: order as LabelOrder } : {}),
  };
  const all: SettingsByAccount = {};
  if (hasSettings(shared)) for (const a of await messenger.accounts.list(false)) all[a.id] = structuredClone(shared);
  await messenger.storage.local.set({ [LABEL_SETTINGS_KEY]: all });
  return all;
}

/** One account's label settings (shared by its devices through its settings carrier). */
export async function getSettings(accountId: string): Promise<Settings> {
  return (await getAllSettings())[accountId] ?? { version: 1, labelColours: {} };
}

/** The accounts a choice applies to: those named, else all. */
async function accountsFor(accountIds: string[] | undefined): Promise<string[]> {
  return accountIds?.length ? accountIds : (await messenger.accounts.list(false)).map((a) => a.id);
}

/** What the server is known to have; older versions stored only the colours. */
function synced(state: AccountState): Settings {
  const s = state.settingsSynced;
  if (!s) return { version: 1, labelColours: {} };
  return "version" in s && (s as Settings).labelColours ? (s as Settings) : { version: 1, labelColours: s as LabelColours };
}

/** A label's colour chosen (null: no colour) in these accounts (none named: all); synced a moment later. */
export async function setLabelColour(label: string, colour: ColourName | null, accountIds?: string[]): Promise<void> {
  const updated = new Date().toISOString();
  for (const accountId of await accountsFor(accountIds)) {
    await updateSettings(accountId, (s) => ({ ...s, labelColours: { ...s.labelColours, [label.toLowerCase()]: { colour, updated } } }));
  }
  scheduleSettingsPush();
}

/** The labels' order chosen in these accounts (none named: all); synced a moment later. */
export async function setLabelOrder(mode: LabelOrderMode, custom?: string[], accountIds?: string[]): Promise<void> {
  const updated = new Date().toISOString();
  for (const accountId of await accountsFor(accountIds)) {
    await updateSettings(accountId, (s) => ({ ...s, labelOrder: { mode, custom: (custom ?? s.labelOrder?.custom ?? []).map((l) => l.toLowerCase()), updated } }));
  }
  scheduleSettingsPush();
}

let settingsTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSettingsPush(): void {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    settingsTimer = undefined;
    void pushSettingsAll();
  }, PUSH_DELAY_MS);
}

/** Each IMAP account's own settings to its own ThunderNotes folder (D42). */
async function pushSettingsAll(): Promise<void> {
  for (const account of await messenger.accounts.list(false)) {
    if (account.type !== "imap") continue;
    await pushSettings(account.id).catch((e) => console.error(`ThunderNotes: settings sync of ${account.name} failed`, e));
  }
}

function pushSettings(accountId: string): Promise<void> {
  return tracked(accountId, async () => {
    const state = await loadState(accountId);
    try {
      const folder = await carrierFolder(accountId, state, hasSettings(await getSettings(accountId)));
      if (!folder) return;
      await scan(folder, state);
      await mergeSettingsCarriers(accountId, state); // other devices' choices first, so nothing is overwritten
      const local = await getSettings(accountId);
      const current = Object.entries(state.carriers).filter(([, e]) => e.ref === SETTINGS_REF);
      if (!hasSettings(local) || (sameSettings(local, synced(state)) && current.length === 1)) return;
      const carrier = buildSettingsCarrier(local, { client: await clientId() });
      const file = new File([carrier.eml], "settings.eml", { type: "message/rfc822" });
      const header = await messenger.messages.import(file, folder.id, { read: true, new: false }).catch((e) => {
        if (isConnectionError(e)) throw e;
        throw new SyncError("upload", `The server didn't accept the message with the ThunderNotes settings (${e?.message ?? e}).`);
      });
      log(accountId, `uploaded settings to ${folder.path}`);
      state.carriers[carrier.messageId] = { tbId: header.id, ref: SETTINGS_REF, rev: 1, updated: "", client: await clientId(), merged: true };
      state.settingsSynced = local;
      await saveState(accountId, state); // recorded before the old ones go
      await deleteCarriers(state, (id, e) => e.ref !== SETTINGS_REF || id === carrier.messageId);
    } finally {
      await saveState(accountId, state);
    }
  });
}

/** Merges the account's settings carriers not read yet into its settings on this device. */
async function mergeSettingsCarriers(accountId: string, state: AccountState): Promise<void> {
  for (const [id, entry] of Object.entries(state.carriers)) {
    if (entry.ref !== SETTINGS_REF || entry.merged) continue;
    try {
      const full = await messenger.messages.getFull(entry.tbId);
      const part = findPart(full, "application/json");
      if (!part?.partName) throw new Error("settings message without its settings");
      const incoming = parseSettings(await (await messenger.messages.getAttachmentFile(entry.tbId, part.partName)).text());
      state.settingsSynced = mergeSettings(synced(state), incoming);
      await updateSettings(accountId, (local) => mergeSettings(local, incoming));
    } catch (e) {
      console.warn("ThunderNotes: could not read the settings carrier", e);
      if (isConnectionError(e)) continue; // read it next time
      state.unreadable = { ...state.unreadable, [id]: { subject: "[ThunderNotes] Settings", reason: String((e as Error)?.message ?? e), version: addonVersion() } };
    }
    entry.merged = true;
  }
}

/** Tags (or untags) the email's copies in the account after its notes arrived by sync. */
async function retag(accountId: string, ref: string): Promise<void> {
  const set = await getSet(accountId, ref);
  await tagCopies(ref, hasContent(set), CARRIER_FOLDER, accountId).catch(() => {});
}

/**
 * Sets made before sync (or imported) don't know their account yet: look the email up by
 * Message-ID and take the account of the first copy that isn't a carrier. Imported for an
 * account by address: that account once it is in Thunderbird, never another (dev issue #4).
 */
async function assignAccounts(): Promise<void> {
  for (const set of await getAllSets()) {
    if (set.email.accountId || (!hasContent(set) && !hasDeletions(set))) continue;
    let accountId: string | undefined;
    if (set.email.account) {
      accountId = await accountByAddress(set.email.account);
    } else {
      const list = await messenger.messages.query({ headerMessageId: norm(set.email.messageId) }).catch(() => null);
      accountId = list?.messages.find((m) => m.folder?.accountId && m.folder.name !== CARRIER_FOLDER)?.folder?.accountId;
    }
    if (!accountId) continue;
    // Moved from "no account" to its account (D42); merged should that account have notes on it already.
    const there = await getSet(accountId, set.email.messageId);
    const { account: _, ...email } = set.email;
    const moved = { ...set, email: { ...email, accountId } };
    await putSet(there ? mergeSets(there, moved, undefined, "import").set : moved, "");
  }
}

/** Pulls every IMAP account. */
export async function pullAll(): Promise<void> {
  await assignAccounts().catch((e) => console.warn("ThunderNotes: assigning accounts failed", e));
  for (const account of await messenger.accounts.list(false)) {
    if (account.type === "imap") await pull(account.id).catch((e) => console.error(`ThunderNotes: sync of ${account.name} failed`, e));
  }
}

/** Whether a folder is an account's carrier folder (for the cover over carriers, D27). */
export function isCarrierFolder(folder: tb.MailFolder | undefined): boolean {
  return !!folder && folder.name === CARRIER_FOLDER && folder.path === `/${CARRIER_FOLDER}`;
}

/**
 * From the toolbar list: deletes an unreadable carrier from the server for good (D35). Once
 * none is left, the warning goes.
 */
export function deleteUnreadable(accountId: string, id: string): Promise<void> {
  return serial(accountId, async () => {
    const state = await loadState(accountId);
    try {
      const entry = state.carriers[id];
      if (entry) {
        await messenger.messages.delete([entry.tbId], await deleteOptions());
        delete state.carriers[id];
        state.deleted = [...new Set([...(state.deleted ?? []), id])];
        if (state.folderId) await within(30_000, messenger.thundernotes.expungeFolder(state.folderId).catch(() => {}));
      }
      if (state.unreadable) delete state.unreadable[id];
      log(accountId, `deleted unreadable message ${id}`);
    } finally {
      await saveState(accountId, state);
    }
    if (!Object.keys(state.unreadable ?? {}).length) await recordOutcome(accountId, null);
  });
}
