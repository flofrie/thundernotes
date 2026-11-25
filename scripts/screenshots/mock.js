/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Screenshot harness: a stand-in for Thunderbird's WebExtension API, with sample notes.
(function () {
  const ACC = "account1";
  const d = (s) => new Date(s).toISOString();
  const set = (id, subject, from, date, updated, extra) => Object.assign({
    version: 1, rev: 1, created: d(date), updated: d(updated),
    email: { messageId: id + "@example.org", subject, from, date: d(date), accountId: ACC, account: "me@example.org" },
    annotations: [],
  }, extra);
  const hl = (id, exact, colour, md, updated) => ({ id, selectors: [{ type: "TextQuoteSelector", exact }], colour, bodyMd: md, created: d(updated), updated: d(updated), textUpdated: d(updated) });
  const SETS = [
    set("kickoff", "Project Lighthouse: kick-off notes", "Mara Lindqvist <mara@example.org>", "2026-11-10T09:12", "2026-11-12T08:40", {
      emailNoteMd: "## Follow-up\n- [ ] Send the revised timeline to Mara @2026-11-13 #lighthouse\n- [ ] Book the workshop room @2026-11-17 #lighthouse\n- [x] Share the kick-off slides ✅ 2026-11-11",
      emailNoteColour: "yellow", emailNoteUpdated: d("2026-11-12T08:40"),
      annotations: [
        hl("k1", "the first milestone moves to the end of January", "orange", "That's **three weeks** later than planned — check the budget impact.\n- [ ] Ask finance about Q1 @2026-11-14 #budget", "2026-11-11T16:05"),
        hl("k2", "Jonas will own the data migration", "green", "Good. He did the last one too.", "2026-11-10T10:30"),
      ],
    }),
    set("invoice", "Invoice 2026-0412 for October", "Billing <billing@example.org>", "2026-10-27T07:55", "2026-11-11T14:20", {
      annotations: [
        hl("i1", "payable within 14 days", "red", "Due **10 Nov**.\n- [ ] Pay invoice 2026-0412 @2026-11-10 #finance", "2026-11-11T14:20"),
      ],
    }),
    set("offer", "Offer: venue for the team offsite", "Hotel Bergblick <events@example.org>", "2026-11-05T11:02", "2026-11-09T19:12", {
      emailNoteMd: "Looks good, compare with [the other offer](mid:offer2@example.org) before deciding.\n- [ ] Decide on the venue @2026-11-19 #offsite",
      emailNoteColour: "blue", emailNoteUpdated: d("2026-11-09T19:12"),
      annotations: [
        hl("o1", "including breakfast and two meeting rooms", "blue", "", "2026-11-09T19:05"),
        hl("o2", "a deposit of 30 %", "pink", "Ask whether they'd accept 20 %.", "2026-11-09T19:10"),
      ],
    }),
    set("offer2", "Re: Offsite in March — our proposal", "Seehof Events <hello@example.org>", "2026-11-06T15:40", "2026-11-09T18:50", {
      annotations: [hl("o3", "free cancellation until four weeks before", "green", "Better cancellation terms than Bergblick.", "2026-11-09T18:50")],
    }),
    set("review", "Code review: sync retries", "Priya Raman <priya@example.org>", "2026-11-07T13:20", "2026-11-08T10:02", {
      annotations: [
        hl("r1", "retry with exponential backoff", "purple", "Idea for next sprint:\n- [ ] Write up the retry design @2026-11-20 #dev\n  - [ ] Collect failure cases\n  - [ ] Draft the timeouts", "2026-11-08T10:02"),
      ],
    }),
    set("newsletter", "This week in open source", "Weekly Digest <digest@example.org>", "2026-11-04T06:00", "2026-11-04T21:15", {
      annotations: [
        hl("n1", "a new release of the mail client is due in December", "yellow", "Test the add-on against it.\n- [ ] Try ThunderNotes on the beta #dev", "2026-11-04T21:15"),
        hl("n2", "how to keep notes as plain files", "green", "", "2026-11-04T21:10"),
      ],
    }),
  ];
  const STORAGE = { hideCurrentYear: true, labelSettings: { [ACC]: { version: 1, labelColours: Object.fromEntries(Object.entries({ lighthouse: "orange", budget: "red", finance: "pink", offsite: "blue", dev: "purple" }).map(([k, c]) => [k, { colour: c, updated: "2026-11-01T00:00:00Z" }])) } } };
  const noop = { addListener() {}, removeListener() {} };
  const api = {
    runtime: {
      sendMessage: async (m) => {
        if (m?.type === "syncStatus") return { accounts: [], warning: null, lastSync: new Date(Date.now() - 4 * 60000).toISOString() };
        return undefined;
      },
      onMessage: noop, getURL: (p) => new URL(p, location.href).href, getManifest: () => ({ version: window.__version ?? "0.0.0", name: "ThunderNotes" }), id: "thundernotes@webterminate.com",
      openOptionsPage: async () => {},
    },
    storage: { local: { get: async (k) => { if (k == null) return { ...STORAGE }; const keys = typeof k === "string" ? [k] : Array.isArray(k) ? k : Object.keys(k); const out = {}; for (const x of keys) if (x in STORAGE) out[x] = STORAGE[x]; return out; }, set: async (o) => Object.assign(STORAGE, o), remove: async () => {} }, onChanged: noop },
    tabs: { getCurrent: async () => ({ id: 1, windowId: 1 }), query: async () => [], sendMessage: async () => undefined, create: async () => {} },
    accounts: { list: async () => [{ id: ACC, name: "me@example.org", type: "imap" }] },
    messages: { query: async () => ({ messages: [] }) },
    windows: { openDefaultBrowser: async () => {} },
    thundernotes: { deviceName: async () => "MacBook" },
    i18n: { getMessage: () => "" },
  };
  window.messenger = api;
  window.browser = api;
  // A small in-memory IndexedDB: headless Chrome's real one never answers under virtual time.
  const data = new Map(SETS.map((x) => [`${ACC}\u001f${x.email.messageId}`, x]));
  const req = (fn) => { const r = { result: undefined, error: null, onsuccess: null, onerror: null }; setTimeout(() => { r.result = fn(); r.onsuccess?.({ target: r }); }, 0); return r; };
  const store = { get: (k) => req(() => data.get(k)), getAll: () => req(() => [...data.values()]), put: (v, k) => req(() => (data.set(k, v), k)), delete: (k) => req(() => void data.delete(k)), getAllKeys: () => req(() => [...data.keys()]) };
  const database = { transaction: () => ({ objectStore: () => store }), objectStoreNames: { contains: () => true }, close() {} };
  Object.defineProperty(window, "indexedDB", { value: { open: () => req(() => database) } });
  const s = document.createElement("script");
  s.src = window.__page;
  document.body.append(s);
})();
