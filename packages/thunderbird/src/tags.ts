/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The `$Annotated` tag (concept: mail-list integration): emails with highlights or notes
// carry it, so the quick filter, saved searches and a tag column work natively. On IMAP
// accounts Thunderbird stores tags as keywords on the server. Tag keys are lower case.

export const TAG_KEY = "$annotated";
const TAG_NAME = "Annotated";
const TAG_COLOUR = "#E0A800";

/** Creates the tag definition if it doesn't exist (also if the user deleted it). */
export async function ensureTag(): Promise<void> {
  const tags = await messenger.messages.tags.list();
  if (!tags.some((t) => t.key === TAG_KEY)) {
    await messenger.messages.tags.create(TAG_KEY, TAG_NAME, TAG_COLOUR);
  }
}

/**
 * Adds or removes the tag on every copy of an email Thunderbird has (by Message-ID, D2): the
 * notes are shared by all copies, e.g. the Sent and the Inbox copy of a mail to yourself.
 * Messages in `skipFolder` (the carrier folder) are left alone.
 */
export async function tagCopies(messageId: string, on: boolean, skipFolder?: string, accountId?: string): Promise<void> {
  if (on) await ensureTag();
  // The copies in the notes' account only (D42): the same email elsewhere has notes of its own.
  let page = await messenger.messages.query({ headerMessageId: messageId.replace(/^<|>$/g, ""), ...(accountId ? { accountId } : {}) });
  let changed = false;
  for (;;) {
    for (const m of page.messages) {
      if (skipFolder && m.folder?.name === skipFolder) continue;
      if (m.tags.includes(TAG_KEY) === on) continue;
      const tags = on ? [...m.tags, TAG_KEY] : m.tags.filter((t) => t !== TAG_KEY);
      await messenger.messages.update(m.id, { tags });
      changed = true;
    }
    if (!page.id) break;
    page = await messenger.messages.continueList(page.id);
  }
  // The ThunderNotes column (Experiment) reads the tag; make sure the rows redraw.
  if (changed) await messenger.thundernotes.refreshColumn().catch(() => {});
}

export interface RetagResult {
  folders: number;
  checked: number;
  tagged: number;
  untagged: number;
}

/**
 * Sets or removes the tag on every message in the given folders, from what ThunderNotes
 * has stored: tagged = the email has highlights, notes or a whole-email note.
 */
/** `annotatedIds`: "<account id>|<Message-ID>" of every email with notes (D42: per account; "*": not assigned yet). */
export async function retagFolders(folders: tb.MailFolder[], annotatedIds: Set<string>): Promise<RetagResult> {
  const result: RetagResult = { folders: folders.length, checked: 0, tagged: 0, untagged: 0 };
  let tagReady = false;
  for (const folder of folders) {
    let page = await messenger.messages.list(folder.id);
    for (;;) {
      for (const m of page.messages) {
        result.checked++;
        const should = annotatedIds.has(`${folder.accountId ?? ""}|${m.headerMessageId}`) || annotatedIds.has(`*|${m.headerMessageId}`);
        const has = m.tags.includes(TAG_KEY);
        if (should === has) continue;
        if (should && !tagReady) {
          await ensureTag();
          tagReady = true;
        }
        const tags = should ? [...m.tags, TAG_KEY] : m.tags.filter((t) => t !== TAG_KEY);
        await messenger.messages.update(m.id, { tags });
        if (should) result.tagged++;
        else result.untagged++;
      }
      if (!page.id) break;
      page = await messenger.messages.continueList(page.id);
    }
  }
  await messenger.thundernotes.refreshColumn().catch(() => {});
  return result;
}
