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
  fromMarkdown,
  gcTombstones,
  hasContent,
  mergeSets,
  parseCarrierHeaders,
  rememberSynced,
  withBases,
  type AnnotationSet,
} from "@thundernotes/core";
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
  /** Carriers that couldn't be read, with the reason; warned about while they exist (D35). */
  unreadable?: Record<string, { subject: string; reason: string }>;
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
      const local = await getSet(ref);
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
      state.unreadable = { ...state.unreadable, [id]: { subject, reason: String((e as Error)?.message ?? e) } };
    }
    entry.merged = true;
  }
  return changed;
}

async function deleteCarriers(state: AccountState, keep: (id: string, e: CarrierEntry) => boolean): Promise<void> {
  const remove = Object.entries(state.carriers).filter(([id, e]) => e.ref && !keep(id, e));
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

/** Pushes an email's notes a moment after the last change. */
export function schedulePush(messageId: string): void {
  const ref = norm(messageId);
  clearTimeout(timers.get(ref));
  timers.set(
    ref,
    setTimeout(() => {
      timers.delete(ref);
      push(ref).catch((e) => console.error(`ThunderNotes: sync of ${ref} failed`, e));
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
  const refs = [...timers.keys()];
  for (const ref of refs) {
    clearTimeout(timers.get(ref));
    timers.delete(ref);
  }
  for (const ref of refs) await push(ref);
}

async function push(ref: string): Promise<void> {
  const set = await getSet(ref);
  const accountId = set?.email.accountId;
  if (!set || !(await isImapAccount(accountId))) return;
  const changedByMerge = await tracked(accountId!, async () => {
    const state = await loadState(accountId!);
    try {
      const needed = hasContent(set) || !!set.tombstones?.length;
      const folder = await carrierFolder(accountId!, state, needed);
      if (!folder) return false;
      await scan(folder, state);
      // Changes from other devices first, so nothing is overwritten.
      const merged = await mergeRemote(accountId!, ref, state);
      const local = gcTombstones((await getSet(ref)) ?? set);
      if (!hasContent(local) && !local.tombstones?.length) {
        await deleteCarriers(state, (_, e) => e.ref !== ref);
        await deleteSet(ref);
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
      await deleteCarriers(state, (id, e) => e.ref !== ref || id === carrier.messageId);
      // The uploaded texts are synced now: possible bases for the next merge.
      const current = await getSet(ref);
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

      // Settings (D40): merged first; uploaded again (a moment later) if this device knows more.
      await mergeSettingsCarriers(state);
      const local = await getSettings();
      const settingsCarriers = Object.values(state.carriers).filter((e) => e.ref === SETTINGS_REF).length;
      if (hasSettings(local) && (!sameSettings(local, synced(state)) || settingsCarriers !== 1)) scheduleSettingsPush();

      const refs = new Set(Object.values(state.carriers).filter((e) => e.ref && e.ref !== SETTINGS_REF && !e.merged).map((e) => e.ref));
      for (const ref of refs) if (await mergeRemote(accountId, ref, state)) changed.push(ref);

      // Consolidate: several carriers for one email, or local changes not on the server yet.
      const newest = new Map<string, CarrierEntry[]>();
      for (const e of Object.values(state.carriers)) if (e.ref) newest.set(e.ref, [...(newest.get(e.ref) ?? []), e]);
      for (const set of await getAllSets()) {
        if (set.email.accountId !== accountId) continue;
        const ref = norm(set.email.messageId);
        const gced = gcTombstones(set);
        if (gced !== set) await putSet(gced);
        const carriers = newest.get(ref) ?? [];
        const latest = carriers.reduce((m, e) => Math.max(m, e.rev), -1);
        if (gced.rev > latest || gced !== set || (!hasContent(gced) && !gced.tombstones?.length)) {
          toPush.push(ref); // something newer here than on the server
        } else if (carriers.length > 1) {
          // All merged and nothing new: just remove the extra carriers (e.g. old revisions
          // another device flagged deleted but that weren't expunged yet). No new revision.
          const keepId = Object.entries(state.carriers).find(([, e]) => e.ref === ref && e.rev === latest)![0];
          await deleteCarriers(state, (id, e) => e.ref !== ref || id === keepId);
        }
      }
    } finally {
      await saveState(accountId, state);
    }
    for (const ref of toPush) schedulePush(ref);
    if (changed.length) {
      for (const ref of changed) await retag(ref);
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

// ---- settings: label colours and order (D40) -------------------------------------------------------

const LABEL_COLOURS_KEY = "labelColours";
const LABEL_ORDER_KEY = "labelOrder";

/** This device's label colours (merged with every other device's it has seen). */
export async function getLabelColours(): Promise<LabelColours> {
  return (await getSettings()).labelColours;
}

/** This device's settings shared with the others: label colours and order. */
export async function getSettings(): Promise<Settings> {
  const stored = await messenger.storage.local.get([LABEL_COLOURS_KEY, LABEL_ORDER_KEY]);
  const colours = stored[LABEL_COLOURS_KEY];
  const order = stored[LABEL_ORDER_KEY];
  return {
    version: 1,
    labelColours: colours && typeof colours === "object" ? (colours as LabelColours) : {},
    ...(order && typeof order === "object" ? { labelOrder: order as LabelOrder } : {}),
  };
}

async function saveSettings(settings: Settings): Promise<void> {
  await messenger.storage.local.set({ [LABEL_COLOURS_KEY]: settings.labelColours, ...(settings.labelOrder ? { [LABEL_ORDER_KEY]: settings.labelOrder } : {}) });
}

/** What the server is known to have; older versions stored only the colours. */
function synced(state: AccountState): Settings {
  const s = state.settingsSynced;
  if (!s) return { version: 1, labelColours: {} };
  return "version" in s && (s as Settings).labelColours ? (s as Settings) : { version: 1, labelColours: s as LabelColours };
}

/** A label's colour chosen here (null: no colour); shown at once, synced a moment later. */
export async function setLabelColour(label: string, colour: ColourName | null): Promise<void> {
  const settings = await getSettings();
  settings.labelColours[label.toLowerCase()] = { colour, updated: new Date().toISOString() };
  await saveSettings(settings);
  scheduleSettingsPush();
}

/** The labels' order chosen here (with the own order, when it changes); synced a moment later. */
export async function setLabelOrder(mode: LabelOrderMode, custom?: string[]): Promise<void> {
  const settings = await getSettings();
  settings.labelOrder = { mode, custom: (custom ?? settings.labelOrder?.custom ?? []).map((l) => l.toLowerCase()), updated: new Date().toISOString() };
  await saveSettings(settings);
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

/** The same settings go to every IMAP account (each has its own ThunderNotes folder). */
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
      const folder = await carrierFolder(accountId, state, hasSettings(await getSettings()));
      if (!folder) return;
      await scan(folder, state);
      await mergeSettingsCarriers(state); // other devices' choices first, so nothing is overwritten
      const local = await getSettings();
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
      await deleteCarriers(state, (id, e) => e.ref !== SETTINGS_REF || id === carrier.messageId);
    } finally {
      await saveState(accountId, state);
    }
  });
}

/** Merges settings carriers not read yet into this device's settings. */
async function mergeSettingsCarriers(state: AccountState): Promise<void> {
  for (const [id, entry] of Object.entries(state.carriers)) {
    if (entry.ref !== SETTINGS_REF || entry.merged) continue;
    try {
      const full = await messenger.messages.getFull(entry.tbId);
      const part = findPart(full, "application/json");
      if (!part?.partName) throw new Error("settings message without its settings");
      const incoming = parseSettings(await (await messenger.messages.getAttachmentFile(entry.tbId, part.partName)).text());
      state.settingsSynced = mergeSettings(synced(state), incoming);
      const local = await getSettings();
      const merged = mergeSettings(local, incoming);
      if (!sameSettings(merged, local)) await saveSettings(merged);
    } catch (e) {
      console.warn("ThunderNotes: could not read the settings carrier", e);
      if (isConnectionError(e)) continue; // read it next time
      state.unreadable = { ...state.unreadable, [id]: { subject: "[ThunderNotes] Settings", reason: String((e as Error)?.message ?? e) } };
    }
    entry.merged = true;
  }
}

/** Tags (or untags) every local copy of an email after its notes arrived by sync. */
async function retag(ref: string): Promise<void> {
  const set = await getSet(ref);
  await tagCopies(ref, hasContent(set), CARRIER_FOLDER).catch(() => {});
}

/**
 * Sets made before sync (or imported) don't know their account yet: look the email up by
 * Message-ID and take the account of the first copy that isn't a carrier.
 */
async function assignAccounts(): Promise<void> {
  for (const set of await getAllSets()) {
    if (set.email.accountId || !hasContent(set)) continue;
    const list = await messenger.messages.query({ headerMessageId: norm(set.email.messageId) }).catch(() => null);
    const copy = list?.messages.find((m) => m.folder?.accountId && m.folder.name !== CARRIER_FOLDER);
    if (copy?.folder?.accountId) await putSet({ ...set, email: { ...set.email, accountId: copy.folder.accountId } });
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
