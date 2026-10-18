# ThunderNotes sync and merge specification

Normative rules for how devices combine notes (D7, D27, D32, D33, D35, D42). A compatible client
must follow them to sync with ThunderNotes without losing or reviving notes. "Must" is binding;
everything else explains. The file format is in the concept doc (format 2, D25) and the
reference files in `packages/core/test/format-fixtures/`; the merge itself is `mergeSets` in
`packages/core/src/format.ts`, the transport `packages/thunderbird/src/sync.ts`. The scenarios at
the end are tests (`packages/thunderbird/test/sync.test.ts`, "merge spec scenarios").

## 1. Model

- Notes belong to one email in one account (Message-ID + account, D42). If Thunderbird supplies an
  empty `headerMessageId`, ThunderNotes does not load or save annotations for that message: no
  fallback identity is implemented yet, so an empty key could make unrelated messages collide.
  A non-empty API value is used as-is. Thunderbird probably invents one for messages without a
  Message-ID; whether it is stable isn't verified, so such messages may in rare cases share notes
  or not find them on another computer. Known, accepted and not planned to be fixed (D2, #26). Each device keeps, per
  email, one **set**: the email's notes, deletion records and, locally only, a **sync history**
  (per note, the last 10 texts that were synced, newest last).
- The server copy of a set is a **carrier** (D7): a message in the account's `ThunderNotes`
  folder, its attachment the set as a format-2 file. Every upload is a new carrier with a fresh
  Message-ID; older carriers of the same email are removed afterwards (section 6). Several
  carriers of one email may exist at a time.
- Each note has a stable `id` (a UUID, never reused); the whole-email note is one more note.
  Merging works per note and per part (text, colour, passage), never per file.

## 2. What the fields mean

| Field | Meaning | Used for |
| --- | --- | --- |
| `rev` | The set's revision counter on its writer: `max(local, merged) + 1` whenever a change is stored | Naming and ordering carriers. **Not** proof that one carrier contains another's changes: counters of different devices are independent. |
| `updated` (set) | When the set last changed on its writer | Ordering carriers before merging (section 5) |
| `text_updated`, `text_by` | When and on which device the note's text was last written | The newer side's time and name in a conflict box; newer-wins on import |
| `text_base`, `text_bases` | hash8 of the synced texts the writer remembers, newest first (`text_base` is the first; writers before 0.48.0 send only it) | Finding the merge base (section 3) |
| `colour_updated` | When the colour was last chosen | Colour merge (section 4) |
| `updated` (note) | When anything of the note last changed | Passage and labels; deletion (section 4) |
| tombstone `deleted` | When the note was deleted | Deletion (section 4) |

Times are ISO 8601 UTC strings and are compared as strings.

## 3. Text

Merging the text of a note present on both sides, `mine` (local) and `theirs` (incoming):

1. Same text: nothing to do (the newer time is kept).
2. **Base**: the first hash in `theirs`' bases that matches `mine` or a text in the local sync
   history for that note. This is the most recent version both devices have seen.
3. With a base: three-way merge line by line (diff3). Lines changed on one side only are taken;
   lines changed differently on both sides become a **conflict box** listing both versions
   (newer first; equal times ordered by device name, then text; times in UTC), so every device
   writes the same box.
4. Without a base:
   - **import** (a backup or a file edited by hand) only: equal times with different text mean
     the file was edited by hand; the file wins and is stamped now.
   - Both: if `theirs` is a text in the local sync history, it is an old revision: keep `mine`.
   - **sync**: otherwise lines both texts have stay, and the rest becomes a conflict box. Equal
     times don't decide anything in sync (two edits, not one file).
   - **import**: otherwise the newer text wins.
5. After merging, the incoming text joins the local sync history, and after an upload so do the
   uploaded texts (so they can be bases later). History keeps the last 10 per note.

A deliberate edit back to an earlier text works: the reverting device names the text it reverted
from as base, the receiver has that text, and the three-way merge takes the revert.

## 4. The other parts

- **Colour**: the side with the newer `colour_updated` wins. Equal times with different colours:
  on import the file wins (stamped now); in sync the greater colour name, so both devices choose
  the same one whichever merges whose.
- **Passage (selectors) and labels**: the side with the newer note `updated` wins.
- **Deletion**: a note is removed if a tombstone's `deleted` is at or after the note's `updated`.
  Any change made after the deletion, on any device (an edit, a colour, a restore), keeps the
  note: the later action wins, nothing changed after the deletion is dropped. Tombstones merge by
  id, the later deletion counting.
- **Deletion records** (D33): a tombstone keeps a copy of the note for 30 days (restorable), then
  only `id` and `deleted` for a year, then goes. A device away for more than a year may bring a
  deleted note back.
- **Whole-email note**: as a note's text and colour; emptying it is its deletion (D33).
- **Folded cards** (D30): per note, the newer choice wins. **Purge** (D33): the later purge counts.

## 5. Order and convergence

- A device must merge the carriers of one email it hasn't merged yet **oldest first**: by the
  `X-Annot-Updated` header, then `X-Annot-Rev`, then Message-ID. A device that finds several
  revisions at once (a new device, old ones not removed yet) then knows each one's base.
- A merge whose result equals the incoming carrier takes that carrier's `rev` and `updated`
  (nothing to upload: no echo). Otherwise the result is a new state, uploaded (section 7).
- Settled: once every device has merged every carrier, merging again changes nothing and nobody
  uploads.

## 6. Cleanup (compaction)

- After an upload the new carrier must be recorded before older carriers of the email are
  removed (a crash in between leaves a duplicate, never a gap).
- Only carriers whose content has been merged on this device may be removed. Never one that
  couldn't be read (damaged, a newer format, its notes for another email: listed, D35), nor one
  not read yet or whose reading failed for the connection; it waits for a later check.
- The email a carrier's headers name must be the email of its notes; otherwise it is unreadable.
- Duplicates (several carriers of one email) are normal for a while and are removed by the next
  check once merged.

## 7. Uploading

- Every local change schedules an upload. An upload first merges the email's carriers not yet
  merged, then writes the result as a new carrier, then cleans up (section 6).
- Each device persistently records, per set, the exact local `rev` and `updated` plus the readable
  carrier known to represent that state. A periodic check uploads the set whenever that marker no
  longer matches the local state or its carrier no longer exists (e.g. after a failed upload or a
  replacement by another device). Comparing revision numbers is not sufficient: independent
  devices can produce the same `rev` with different content.

## 8. Editing while sync runs

- An open editor isn't replaced by incoming changes. Saving sends the text the edit started from
  (`base`); if the stored text changed meanwhile, both are combined as in section 3 with that
  base: nothing is overwritten, a line changed differently on both becomes a conflict box.

## 9. Import

Import merges files with the same rules in "import" mode (sections 3–4); repaired sections become
notes of their own (format 2). Notes named for an account not in Thunderbird wait for it (D42).

## 10. Known limits

- hash8 (32 bits) can collide; a wrong base gives a wrong three-way merge for that note only.
- A note edited on another device more than 10 synced versions ago has no common base: lines both
  have stay, the rest becomes a conflict box (nothing lost).
- An old revision coming back (a carrier restored on the server) may give a conflict box instead
  of being recognised as old; nothing is lost.
- Clocks: times decide colour, passage, labels and deletions; a device whose clock runs far ahead
  wins those. Text never depends on clocks beyond the order inside conflict boxes.
- See also section 4 (deletion records).

## Scenarios (tests)

| Scenario | Expected |
| --- | --- |
| Three devices edit different lines offline, then sync one after another | All three edits, no conflict box, settled |
| A new device reads old and new revisions in either order | The newest text, no conflict box |
| A deliberate edit back to an earlier text | Reaches the other devices |
| No common base, equal times | Shared lines kept, the rest a conflict box with both versions, same on both devices |
| Two devices edit different notes / the same line of one note | Both edits / a conflict box with both versions |
| A device away for 40 days (deletion copy expired) | The deleted note doesn't come back |
| A carrier that can't be read, or couldn't for the connection | Not removed by an upload; merged later |
| An edit from another device arrives while the note is open in the editor | Combined on saving, not overwritten |
| Two devices choose different colours at the same moment | Both end with the same colour |
| Another device replaces the uploaded carrier with the same revision while a local edit waits | The local edit is uploaded by the next check |
