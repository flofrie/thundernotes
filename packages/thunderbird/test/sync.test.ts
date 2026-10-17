/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// IMAP sync (D27) between two simulated devices sharing one simulated carrier folder.
// Each device loads its own copy of sync.ts with its own store; `messenger` is switched
// to the acting device for every step (steps run one after another).

import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAnnotation, hasConflict, parseConflicts, purgeDeleted, restorable, type Annotation, type AnnotationSet } from "@thundernotes/core";

interface ServerMessage {
  id: number;
  headerMessageId: string;
  eml: string;
  /** IMAP \Deleted: still listed until the folder is expunged (as on the real server). */
  deleted?: boolean;
}

function makeServer() {
  return { messages: [] as ServerMessage[], nextId: 1, folderExists: false };
}
type Server = ReturnType<typeof makeServer>;

const ACCOUNT = "acc1";
const FOLDER = { id: `${ACCOUNT}://ThunderNotes`, name: "ThunderNotes", path: "/ThunderNotes", accountId: ACCOUNT };

function headersOf(eml: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of eml.split("\r\n\r\n")[0]!.split("\r\n")) {
    const i = line.indexOf(":");
    (out[line.slice(0, i).toLowerCase()] ??= []).push(line.slice(i + 1).trim());
  }
  return out;
}

function markdownOf(eml: string): string {
  const boundary = /boundary="([^"]+)"/.exec(eml)![1]!;
  const part = eml.split(`--${boundary}`)[2]!;
  const body = part.split("\r\n\r\n").slice(1).join("").replace(/\r\n/g, "").replace(/--$/, "");
  return new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)));
}

function makeMessenger(server: Server) {
  const storage = new Map<string, unknown>();
  const stats = { imports: 0, expunges: 0, prepared: 0 };
  const find = (id: number) => server.messages.find((m) => m.id === id)!;
  const messenger = {
    runtime: { getBrowserInfo: async () => ({ name: "Thunderbird", version: "157.0" }) },
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries([keys].flat().filter((k) => storage.has(k)).map((k) => [k, structuredClone(storage.get(k))])),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) storage.set(k, structuredClone(v));
        },
      },
    },
    accounts: {
      get: async () => ({ id: ACCOUNT, name: "Test", type: "imap", rootFolder: { id: `${ACCOUNT}://`, path: "/" } }),
      list: async () => [{ id: ACCOUNT, name: "Test", type: "imap" }],
    },
    folders: {
      getSubFolders: async () => (server.folderExists ? [FOLDER] : []),
      getParentFolders: async () => [] as tb.MailFolder[],
      create: async () => {
        server.folderExists = true;
        return FOLDER;
      },
    },
    thundernotes: {
      prepareCarrierFolder: async () => void stats.prepared++,
      refreshFolder: async () => {},
      subscribeCarrierFolder: async () => "missing" as const,
      expungeFolder: async () => {
        stats.expunges++;
        server.messages = server.messages.filter((m) => !m.deleted);
      },
    },
    messages: {
      list: async () => ({
        id: null,
        messages: server.messages.map((m) => ({ id: m.id, headerMessageId: m.headerMessageId, subject: "[ThunderNotes] Test", tags: [], folder: FOLDER })),
      }),
      continueList: async () => ({ id: null, messages: [] }),
      get: async (id: number) => ({ id, headerMessageId: find(id).headerMessageId, subject: "[ThunderNotes] Test", tags: [] }),
      getFull: async (id: number) => ({
        headers: headersOf(find(id).eml),
        parts: [
          {
            contentType: "multipart/mixed",
            parts: [
              { contentType: "text/plain", partName: "1.1" },
              { contentType: find(id).eml.includes("Content-Type: application/json") ? "application/json" : "text/markdown", partName: "1.2" },
            ],
          },
        ],
      }),
      getAttachmentFile: async (id: number) => ({ text: async () => markdownOf(find(id).eml) }),
      import: async (file: File) => {
        stats.imports++;
        const eml = await file.text();
        const headerMessageId = /^Message-ID: <(.+)>$/m.exec(eml)![1]!;
        if (server.messages.some((m) => m.headerMessageId === headerMessageId)) throw new Error("duplicate Message-ID");
        const message = { id: server.nextId++, headerMessageId, eml };
        server.messages.push(message);
        return { id: message.id, headerMessageId };
      },
      delete: async (ids: number[]) => {
        for (const m of server.messages) if (ids.includes(m.id)) m.deleted = true;
      },
      query: async () => ({ id: null, messages: [] }),
    },
  };
  return { messenger, stats };
}

/** One device: its own sync module, store and messenger. */
async function device(server: Server) {
  vi.resetModules();
  vi.doMock("../src/store.js", () => {
    const sets = new Map<string, AnnotationSet>();
    return {
      getSet: async (id: string) => structuredClone(sets.get(id) ?? null),
      putSet: async (set: AnnotationSet) => void sets.set(set.email.messageId, structuredClone(set)),
      deleteSet: async (id: string) => void sets.delete(id),
      getAllSets: async () => [...sets.values()].map((s) => structuredClone(s)),
    };
  });
  vi.doMock("../src/tags.js", () => ({ tagCopies: async () => {}, TAG_KEY: "$annotated" }));
  const sync = await import("../src/sync.js");
  const store = await import("../src/store.js");
  const { messenger, stats } = makeMessenger(server);
  /** Runs one step as this device. */
  const act = async <T>(step: () => Promise<T>): Promise<T> => {
    (globalThis as { messenger?: unknown }).messenger = messenger;
    const result = await step();
    await sync.flushPushes();
    return result;
  };
  return { sync, store, stats, act, messenger };
}

const REF = "original@example.com";

function annotation(id: string, bodyMd: string, at: string): Annotation {
  return { id, selectors: [{ type: "TextQuoteSelector", exact: `quote ${id}` }], bodyMd, created: at, updated: at };
}

function initialSet(at: string): AnnotationSet {
  return {
    version: 1,
    email: { messageId: REF, subject: "Test", accountId: ACCOUNT },
    rev: 1,
    created: at,
    updated: at,
    annotations: [annotation("a1", "first note", at)],
  };
}

const notes = (set: AnnotationSet | null) => set?.annotations.map((a) => `${a.id}:${a.bodyMd}`).sort() ?? [];

afterEach(() => {
  vi.useRealTimers();
});

describe("IMAP sync between two devices", () => {
  it("pushes, pulls, deletes and merges concurrent edits", async () => {
    const server = makeServer();
    const A = await device(server);
    const B = await device(server);

    // A creates a note: one carrier on the server.
    await A.act(async () => {
      await A.store.putSet(initialSet("2026-10-15T10:00:00.000Z"));
      A.sync.schedulePush(REF);
    });
    expect(server.messages).toHaveLength(1);

    // B pulls it, without writing anything back.
    await B.act(() => B.sync.pull(ACCOUNT));
    expect(notes(await B.store.getSet(REF))).toEqual(["a1:first note"]);
    expect(B.stats.imports).toBe(0);

    // B adds a note: still one carrier (the old revision is deleted), A gets it.
    await B.act(async () => {
      const set = (await B.store.getSet(REF))!;
      const at = "2026-10-15T10:05:00.000Z";
      await B.store.putSet({ ...set, rev: set.rev + 1, updated: at, annotations: [...set.annotations, annotation("a2", "from B", at)] });
      B.sync.schedulePush(REF);
    });
    expect(server.messages).toHaveLength(1);
    await A.act(() => A.sync.pull(ACCOUNT));
    expect(notes(await A.store.getSet(REF))).toEqual(["a1:first note", "a2:from B"]);
    expect(A.stats.imports).toBe(1); // no echo

    // Concurrent: A edits a1 and B adds a3, both before syncing; both end up with both changes.
    await A.act(async () => {
      const set = (await A.store.getSet(REF))!;
      const at = "2026-10-15T11:00:00.000Z";
      await A.store.putSet({ ...set, rev: set.rev + 1, updated: at, annotations: set.annotations.map((a) => (a.id === "a1" ? { ...a, bodyMd: "edited on A", updated: at } : a)) });
    });
    await B.act(async () => {
      const set = (await B.store.getSet(REF))!;
      const at = "2026-10-15T11:01:00.000Z";
      await B.store.putSet({ ...set, rev: set.rev + 1, updated: at, annotations: [...set.annotations, annotation("a3", "also from B", at)] });
      B.sync.schedulePush(REF);
    });
    await A.act(async () => A.sync.schedulePush(REF)); // merges B's carrier before writing
    await B.act(() => B.sync.pull(ACCOUNT));
    const expected = ["a1:edited on A", "a2:from B", "a3:also from B"];
    expect(notes(await A.store.getSet(REF))).toEqual(expected);
    expect(notes(await B.store.getSet(REF))).toEqual(expected);
    expect(server.messages).toHaveLength(1);

    // A deletes a2: B loses it too, and doesn't resurrect it.
    await A.act(async () => {
      await A.store.putSet(deleteAnnotation((await A.store.getSet(REF))!, "a2", "2026-10-15T12:00:00.000Z"));
      A.sync.schedulePush(REF);
    });
    await B.act(() => B.sync.pull(ACCOUNT));
    expect(notes(await B.store.getSet(REF))).toEqual(["a1:edited on A", "a3:also from B"]);
    await A.act(() => A.sync.pull(ACCOUNT));
    expect(notes(await A.store.getSet(REF))).toEqual(["a1:edited on A", "a3:also from B"]);
  });

  it("combines edits of the same note from two devices; a line changed on both becomes a conflict box", async () => {
    const server = makeServer();
    const A = await device(server);
    const B = await device(server);
    const text = "one\ntwo\nthree";
    await A.act(async () => {
      const set = initialSet("2026-10-17T09:00:00.000Z");
      set.annotations[0]!.bodyMd = text;
      await A.store.putSet(set);
      A.sync.schedulePush(REF);
    });
    await B.act(() => B.sync.pull(ACCOUNT));
    const edit = (body: string, at: string, by: string) => (set: AnnotationSet): AnnotationSet => ({
      ...set,
      rev: set.rev + 1,
      updated: at,
      annotations: set.annotations.map((a) => ({ ...a, bodyMd: body, updated: at, textUpdated: at, textBy: by })),
    });
    // Both edit offline: A line one and three, B line three differently.
    await A.act(async () => {
      await A.store.putSet(edit("ONE\ntwo\nthree (A)", "2026-10-17T09:10:00.000Z", "MacBook")((await A.store.getSet(REF))!));
    });
    await B.act(async () => {
      await B.store.putSet(edit("one\ntwo\nthree (B)", "2026-10-17T09:12:00.000Z", "Work laptop")((await B.store.getSet(REF))!));
      B.sync.schedulePush(REF);
    });
    await A.act(async () => A.sync.schedulePush(REF)); // merges B's carrier first
    await B.act(() => B.sync.pull(ACCOUNT));
    const a = (await A.store.getSet(REF))!.annotations[0]!.bodyMd;
    const b = (await B.store.getSet(REF))!.annotations[0]!.bodyMd;
    expect(a).toBe(b);
    expect(a.startsWith("ONE\ntwo\n")).toBe(true);
    expect(hasConflict(a)).toBe(true);
    expect(parseConflicts(a)[0]!.versions.map((v) => [v.by, v.text])).toEqual([
      ["Work laptop", "three (B)"],
      ["MacBook", "three (A)"],
    ]);
    // Settled: further checks write nothing.
    const imports = A.stats.imports + B.stats.imports;
    await A.act(() => A.sync.pull(ACCOUNT));
    await B.act(() => B.sync.pull(ACCOUNT));
    expect(A.stats.imports + B.stats.imports).toBe(imports);
  });

  it("removes the carrier once everything is deleted and the tombstones expire", async () => {
    const server = makeServer();
    const A = await device(server);
    const B = await device(server);
    await A.act(async () => {
      await A.store.putSet(initialSet("2026-10-15T10:00:00.000Z"));
      A.sync.schedulePush(REF);
    });
    await A.act(async () => {
      await A.store.putSet(deleteAnnotation((await A.store.getSet(REF))!, "a1", "2026-10-15T10:10:00.000Z"));
      A.sync.schedulePush(REF);
    });
    expect(server.messages).toHaveLength(1); // the tombstone travels in the carrier
    await B.act(() => B.sync.pull(ACCOUNT));
    expect(notes(await B.store.getSet(REF))).toEqual([]);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T00:00:00.000Z"));
    await A.act(() => A.sync.pull(ACCOUNT));
    expect(server.messages).toHaveLength(0);
    expect(await A.store.getSet(REF)).toBeNull();
  });

  // Seen on the real server: "delete permanently" only flagged old revisions \Deleted, they
  // stayed listed, and every check wrote yet another revision.
  it("doesn't keep writing new revisions while deleted carriers are still listed", async () => {
    const server = makeServer();
    const A = await device(server);
    await A.act(async () => {
      await A.store.putSet(initialSet("2026-10-15T10:00:00.000Z"));
      A.sync.schedulePush(REF);
    });
    await A.act(async () => {
      const set = (await A.store.getSet(REF))!;
      await A.store.putSet({ ...set, rev: set.rev + 1, updated: "2026-10-15T10:01:00.000Z" });
      A.sync.schedulePush(REF);
    });
    expect(A.stats.imports).toBe(2);
    // Expunge fails silently on this server: the old revision stays listed, flagged.
    server.messages.push({ ...server.messages[0]!, id: server.nextId++, headerMessageId: "flagged-but-listed@x", deleted: true });
    const before = A.stats.imports;
    await A.act(() => A.sync.pull(ACCOUNT));
    await A.act(() => A.sync.pull(ACCOUNT));
    expect(A.stats.imports).toBe(before + 0);
  });

  it("restores a renamed carrier folder and says where the old one is", async () => {
    const server = makeServer();
    const A = await device(server);
    const notices: unknown[] = [];
    A.sync.setSyncHooks({ changed() {}, folderRestored: (_name, where) => void notices.push(where) });
    await A.act(async () => {
      await A.store.putSet(initialSet("2026-10-15T10:00:00.000Z"));
      A.sync.schedulePush(REF);
    });
    // Renamed elsewhere: ThunderNotes is gone; its carriers turn up in "Old notes".
    const old = server.messages.map((m) => ({ ...m }));
    server.folderExists = false;
    server.messages = [];
    A.messenger.messages.query = async () => ({
      id: null,
      messages: old.map((m) => ({ id: m.id, headerMessageId: m.headerMessageId, tags: [], folder: { id: "acc1://Old notes", path: "/Old notes" } })),
    });
    await A.act(() => A.sync.pull(ACCOUNT));
    expect(notices).toEqual([{ kind: "moved", path: "/Old notes" }]);
    expect(A.stats.prepared).toBe(2); // set up again (search exclusion) after the restore
    expect(server.folderExists).toBe(true);
    expect(server.messages).toHaveLength(1); // the notes are back in ThunderNotes
  });

  it("warns after failing twice in a row, with the reason, and clears on success (D35)", async () => {
    const server = makeServer();
    const A = await device(server);
    const seen: unknown[][] = [];
    A.sync.setSyncHooks({ changed() {}, folderRestored() {}, problemsChanged: (p) => void seen.push(p) });
    await A.act(async () => {
      await A.store.putSet(initialSet("2026-10-17T10:00:00.000Z"));
      A.sync.schedulePush(REF);
    });
    // The folder becomes invisible (unsubscribed) and the server refuses to create it again.
    server.folderExists = false;
    A.messenger.folders.create = async () => {
      throw new Error("Folder already exists");
    };
    await A.act(() => A.sync.pull(ACCOUNT).catch(() => {}));
    expect(await A.act(() => A.sync.syncProblems())).toEqual([]); // one failure: no warning yet
    await A.act(() => A.sync.pull(ACCOUNT).catch(() => {}));
    const [problem] = await A.act(() => A.sync.syncProblems());
    expect(problem!.failures).toBe(2);
    expect(problem!.kind).toBe("folder");
    expect(problem!.message).toContain("subscribe it again");
    // Subscribed again: the next sync works and the warning goes.
    server.folderExists = true;
    await A.act(() => A.sync.pull(ACCOUNT));
    expect(await A.act(() => A.sync.syncProblems())).toEqual([]);
    expect(seen.map((p) => p.length)).toEqual([1, 0]);
  });

  it("doesn't count failures when the server can't be reached at all (D35)", async () => {
    const server = makeServer();
    const A = await device(server);
    await A.act(async () => {
      await A.store.putSet(initialSet("2026-10-17T10:00:00.000Z"));
      A.sync.schedulePush(REF);
    });
    A.messenger.messages.import = async () => {
      throw new Error("Error importing message: Aborted with status: 2152398878"); // unknown host
    };
    for (let i = 0; i < 3; i++) {
      await A.act(async () => {
        const set = (await A.store.getSet(REF))!;
        await A.store.putSet({ ...set, rev: set.rev + 1 });
        A.sync.schedulePush(REF);
      }).catch(() => {});
    }
    expect(await A.act(() => A.sync.syncProblems())).toEqual([]);
  });

  it("warns at once about a carrier that can't be read (D35)", async () => {
    const server = makeServer();
    const A = await device(server);
    const B = await device(server);
    await A.act(async () => {
      await A.store.putSet(initialSet("2026-10-17T10:00:00.000Z"));
      A.sync.schedulePush(REF);
    });
    B.messenger.messages.getAttachmentFile = async () => ({ text: async () => "not a ThunderNotes file" }) as unknown as File;
    await B.act(() => B.sync.pull(ACCOUNT).catch(() => {}));
    const [problem] = await B.act(() => B.sync.syncProblems());
    expect(problem?.kind).toBe("read");
    // Still there at the next check: still warned about; removed: the warning goes.
    await B.act(() => B.sync.pull(ACCOUNT).catch(() => {}));
    expect((await B.act(() => B.sync.syncProblems())).map((p) => p.kind)).toEqual(["read"]);
    // Deleted from the toolbar list: gone from the server, and the warning goes.
    const [item] = (await B.act(() => B.sync.syncProblems()))[0]!.items!;
    await B.act(() => B.sync.deleteUnreadable(ACCOUNT, item!.id));
    expect(server.messages).toHaveLength(0);
    expect(await B.act(() => B.sync.syncProblems())).toEqual([]);
  });

  it("subscribes an unsubscribed carrier folder again instead of creating a new one (D36)", async () => {
    const server = makeServer();
    const A = await device(server);
    const notices: string[] = [];
    A.sync.setSyncHooks({ changed() {}, folderRestored: () => void notices.push("restored"), folderResubscribed: () => void notices.push("resubscribed"), problemsChanged() {} });
    await A.act(async () => {
      await A.store.putSet(initialSet("2026-10-17T10:00:00.000Z"));
      A.sync.schedulePush(REF);
    });
    // Unsubscribed: hidden from add-ons, still on the server.
    server.folderExists = false;
    A.messenger.thundernotes.subscribeCarrierFolder = async () => {
      server.folderExists = true;
      return "subscribed" as const;
    };
    A.messenger.folders.create = async () => {
      throw new Error("must not create");
    };
    await A.act(() => A.sync.pull(ACCOUNT));
    expect(notices).toEqual(["resubscribed"]);
    expect(server.messages).toHaveLength(1);
  });

  it("reads a carrier whose headers weren't available at first (not filed as foreign)", async () => {
    const server = makeServer();
    const A = await device(server);
    const B = await device(server);
    await A.act(async () => {
      await A.store.putSet(initialSet("2026-10-17T10:00:00.000Z"));
      A.sync.schedulePush(REF);
    });
    const getFull = B.messenger.messages.getFull;
    B.messenger.messages.getFull = async () => {
      throw new Error("not downloaded yet");
    };
    await B.act(() => B.sync.pull(ACCOUNT));
    expect(await B.store.getSet(REF)).toBeNull();
    B.messenger.messages.getFull = getFull;
    await B.act(() => B.sync.pull(ACCOUNT));
    expect(notes(await B.store.getSet(REF))).toEqual(["a1:first note"]);
  });

  it("uploads notes made before sync existed", async () => {
    const server = makeServer();
    const A = await device(server);
    await A.act(async () => {
      await A.store.putSet(initialSet("2026-10-01T10:00:00.000Z"));
      await A.sync.pull(ACCOUNT); // finds a local set without a carrier
    });
    expect(server.folderExists).toBe(true);
    expect(server.messages).toHaveLength(1);
  });

  it("syncs label colours through one settings carrier, merged per label (D40)", async () => {
    const server = makeServer();
    const A = await device(server);
    const B = await device(server);
    const colours = (d: typeof A) => d.act(() => d.sync.getLabelColours()).then((c) => Object.fromEntries(Object.entries(c).map(([l, v]) => [l, v.colour])));
    const settingsCarriers = () => server.messages.filter((m) => !m.deleted && m.eml.includes("X-Annot-Ref: <thundernotes-settings@thundernotes.invalid>"));

    await A.act(() => A.sync.setLabelColour("Work", "blue"));
    expect(settingsCarriers()).toHaveLength(1);
    await B.act(() => B.sync.pull(ACCOUNT));
    expect(await colours(B)).toEqual({ work: "blue" });

    // Both change different labels; A also takes the colour off "work".
    await B.act(() => B.sync.setLabelColour("home", "green"));
    await new Promise((r) => setTimeout(r, 5)); // a later time stamp
    await A.act(() => A.sync.setLabelColour("work", null));
    await B.act(() => B.sync.pull(ACCOUNT));
    await A.act(() => A.sync.pull(ACCOUNT));
    expect(await colours(A)).toEqual({ work: null, home: "green" });
    expect(await colours(B)).toEqual({ work: null, home: "green" });
    expect(settingsCarriers()).toHaveLength(1);

    // Nothing new: no new upload.
    const imports = A.stats.imports + B.stats.imports;
    await A.act(() => A.sync.pull(ACCOUNT));
    await B.act(() => B.sync.pull(ACCOUNT));
    expect(A.stats.imports + B.stats.imports).toBe(imports);
    expect(await B.act(() => B.sync.syncProblems())).toEqual([]);
  });

  it("keeps notes and settings apart", async () => {
    const server = makeServer();
    const A = await device(server);
    const B = await device(server);
    await A.act(async () => {
      await A.store.putSet(initialSet("2026-10-17T10:00:00.000Z"));
      A.sync.schedulePush(REF);
      await A.sync.setLabelColour("work", "red");
    });
    await B.act(() => B.sync.pull(ACCOUNT));
    expect(notes(await B.store.getSet(REF))).toEqual(["a1:first note"]);
    expect((await B.act(() => B.sync.getLabelColours())).work?.colour).toBe("red");
    expect(await B.store.getSet("thundernotes-settings@thundernotes.invalid")).toBeNull();
    expect(server.messages.filter((m) => !m.deleted)).toHaveLength(2);
  });

  it("syncs the label order as a whole, next to colours changed elsewhere (D40)", async () => {
    const server = makeServer();
    const A = await device(server);
    const B = await device(server);
    await A.act(() => A.sync.setLabelColour("work", "blue"));
    await B.act(() => B.sync.pull(ACCOUNT));
    await new Promise((r) => setTimeout(r, 5));
    await A.act(() => A.sync.setLabelOrder("custom", ["home", "work"]));
    await B.act(() => B.sync.setLabelColour("home", "green"));
    await A.act(() => A.sync.pull(ACCOUNT));
    await B.act(() => B.sync.pull(ACCOUNT));
    for (const d of [A, B]) {
      const s = await d.act(() => d.sync.getSettings());
      expect(s.labelOrder).toMatchObject({ mode: "custom", custom: ["home", "work"] });
      expect(Object.fromEntries(Object.entries(s.labelColours).map(([l, v]) => [l, v.colour]))).toEqual({ work: "blue", home: "green" });
    }
    // A later arrangement on B wins as a whole.
    await new Promise((r) => setTimeout(r, 5));
    await B.act(() => B.sync.setLabelOrder("az"));
    await A.act(() => A.sync.pull(ACCOUNT));
    expect((await A.act(() => A.sync.getSettings())).labelOrder).toMatchObject({ mode: "az", custom: ["home", "work"] }); // the own order kept
  });

  it("a purge reaches the other device, which still had the copies (D33)", async () => {
    const server = makeServer();
    const A = await device(server);
    const B = await device(server);
    const base = { ...initialSet("2026-10-17T10:00:00.000Z"), annotations: [annotation("a1", "first", "2026-10-17T10:00:00.000Z"), annotation("a2", "second", "2026-10-17T10:00:00.000Z")] };
    await A.act(async () => {
      await A.store.putSet(base);
      A.sync.schedulePush(REF);
    });
    await A.act(async () => {
      const s = deleteAnnotation((await A.store.getSet(REF))!, "a1", "2026-10-17T11:00:00.000Z");
      await A.store.putSet({ ...s, rev: s.rev + 1 });
      A.sync.schedulePush(REF);
    });
    await B.act(() => B.sync.pull(ACCOUNT));
    expect(restorable(await B.store.getSet(REF)).annotations.map((a) => a.id)).toEqual(["a1"]); // B has the copy
    await A.act(async () => {
      await A.store.putSet(purgeDeleted((await A.store.getSet(REF))!, "2026-10-17T12:00:00.000Z"));
      A.sync.schedulePush(REF);
    });
    await B.act(() => B.sync.pull(ACCOUNT));
    const onB = (await B.store.getSet(REF))!;
    expect(restorable(onB).annotations).toEqual([]);
    expect(onB.annotations.map((a) => a.id)).toEqual(["a2"]); // the rest untouched
    expect(onB.tombstones?.map((t) => t.id)).toEqual(["a1"]); // the deletion itself stays
  });
});
