/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import type { AnnotationSet } from "@thundernotes/core";
import { collectTasks, emailRef, listAsMarkdown, noteAsMarkdown, notesAsMarkdown, shiftHeadings, sections, dateFilterLabel, dateFilterWord, monthWord, monthWords, groupTasks, labelCounts, labelsOf } from "../src/task-list.js";

const today = new Date(2026, 9, 16); // Fri 16 Oct 2026

function set(messageId: string, date: string, emailNoteMd: string, notes: [string, string, string][] = []): AnnotationSet {
  return {
    version: 1,
    email: { messageId, subject: messageId === "a" ? "Contract" : "Holiday plans", from: `"Anna" <anna@x>`, date },
    rev: 1,
    created: date,
    updated: date,
    emailNoteMd,
    annotations: notes.map(([id, quote, bodyMd]) => ({
      id,
      selectors: [{ type: "TextQuoteSelector", exact: quote }],
      bodyMd,
      created: date,
      updated: date,
    })),
  };
}

const sets = [
  set("a", "2026-10-10T08:00:00Z", "- [ ] overdue @2026-10-14 #work\n- [x] done @2026-10-01", [["n1", "the offer", "- [ ] today @2026-10-16\n- [ ] later @2026-11-30 #work #home"]]),
  set("b", "2026-10-12T08:00:00Z", "- [ ] week @2026-10-23 and @2026-10-30\n- [ ] no date #home\nplain @2026-10-01\n- [ ]\n- [ ]   \n- [x] "),
];

describe("task view list (D38)", () => {
  const tasks = collectTasks(sets);
  const all = { labels: [], text: "", showDone: false };

  it("collects every checklist item with its email and note, not empty ones", () => {
    expect(tasks).toHaveLength(6);
    const later = tasks.find((t) => t.text.startsWith("later"))!;
    expect(later).toMatchObject({ messageId: "a", noteId: "n1", quote: "the offer", subject: "Contract", sender: "Anna", senderAddress: "anna@x", due: "2026-11-30" });
    expect(tasks.find((t) => t.text.startsWith("week"))!.due).toBe("2026-10-23"); // the earliest date
    expect(tasks.find((t) => t.done)!.due).toBeUndefined();
  });

  it("groups by due date, done ones only when shown", () => {
    const groups = (f = all) => groupTasks(tasks, f, today).map((g) => [g.key, g.tasks.map((t) => t.text.split(" ")[0])]);
    expect(groups()).toEqual([
      ["overdue", ["overdue"]],
      ["today", ["today"]],
      ["week", ["week"]],
      ["later", ["later"]],
      ["none", ["no"]],
    ]);
    expect(groups({ ...all, showDone: true }).at(-1)).toEqual(["done", ["done"]]);
  });

  it("filters by labels (all of them) and words", () => {
    const texts = (f: typeof all) => groupTasks(tasks, f, today).flatMap((g) => g.tasks.map((t) => t.text.split(" ")[0]));
    expect(texts({ ...all, labels: ["work"] })).toEqual(["overdue", "later"]);
    expect(texts({ ...all, labels: ["work", "home"] })).toEqual(["later"]);
    expect(texts({ ...all, text: "offer" })).toEqual(["today", "later"]); // the highlighted passage counts too
    expect(texts({ ...all, text: "holiday" })).toEqual(["week", "no"]);
    expect(labelsOf(tasks, false)).toEqual(["home", "work"]);
  });

  it("orders labels by open tasks, the same with done ones shown", () => {
    // "a" and "z" have one open task each: their order must not depend on the switch.
    const sets2 = [set("c", "2026-10-12T08:00:00Z", "- [ ] a #a\n- [ ] b #z\n- [ ] c #top\n- [ ] c2 #top\n- [x] d #z\n- [x] e #z\n- [x] g #old")];
    const t = collectTasks(sets2);
    const order = (showDone: boolean) => labelCounts(t, showDone).map((l) => l.label);
    expect(order(false)).toEqual(["top", "a", "z"]); // the same number: alphabetically
    expect(order(true)).toEqual(["top", "a", "z", "old"]); // the same, done-only labels last
    expect(labelCounts(t, false).find((l) => l.label === "z")!.count).toBe(1);
    expect(labelCounts(t, true).find((l) => l.label === "z")!.count).toBe(3);
  });

  it("orders the Done group by when finished, due date or label (D38)", () => {
    const done = collectTasks([
      set("d", "2026-10-12T08:00:00Z", [
        "- [x] old @2026-10-01 #zeta ✅ 2026-10-02",
        "- [x] recent @2026-10-20 #alpha ✅ 2026-10-15",
        "- [x] undated",
        "- [x] middle #beta ✅ 2026-10-10",
      ].join("\n")),
    ]);
    const order = (doneSort?: "finished-desc" | "finished-asc" | "due-asc" | "due-desc" | "label") =>
      groupTasks(done, { labels: [], text: "", showDone: true, doneSort }, today).find((g) => g.key === "done")!.tasks.map((t) => t.text.split(" ")[0]);
    expect(order()).toEqual(["recent", "middle", "old", "undated"]); // newest first by default
    expect(order("finished-asc")).toEqual(["old", "middle", "recent", "undated"]); // without a date: last
    expect(order("due-asc")).toEqual(["old", "recent", "middle", "undated"]); // no due date: last, newest done first
    expect(order("due-desc")).toEqual(["recent", "old", "middle", "undated"]);
    expect(order("label")).toEqual(["recent", "middle", "old", "undated"]); // alpha, beta, zeta, none
  });

  it("lists tasks without a date oldest email first, waiting longest (D38)", () => {
    const t = collectTasks([set("old", "2026-09-01T08:00:00Z", "- [ ] older"), set("new", "2026-10-15T08:00:00Z", "- [ ] newer")]);
    expect(groupTasks(t, { labels: [], text: "", showDone: false }, today)[0]!.tasks.map((x) => x.text)).toEqual(["older", "newer"]);
  });

  it("knows dates as filter words: year, month, day (D38)", () => {
    expect(dateFilterWord("@2026")).toMatchObject({ year: 2026 });
    expect(dateFilterWord("@2026-10")).toMatchObject({ year: 2026, month: 10 });
    expect(dateFilterWord("@2026-13")).toBeNull();
    expect(dateFilterWord("@2026-02-30")).toBeNull();
    expect(dateFilterWord("2026-10-24")).toBeNull(); // only with "@"
    expect(dateFilterLabel("@2027")).toBe("@2027");
    expect(dateFilterLabel("@2027-01-11")).toMatch(/^@\w+ 11 Jan 2027$/);
    expect(dateFilterLabel("@2027-01")).toMatch(/^@Jan 2027$/);
    expect(dateFilterLabel("@2026-12")).toMatch(/^@Dec 2026$/); // always with the year, also this year
    expect(dateFilterLabel("@2026-10-24")).toMatch(/^@\w+ 24 Oct 2026$/);
  });

  it("knows month names (English, German) as months of the current year (D38)", () => {
    expect(monthWords("ja", today)).toEqual(["@2026-01"]);
    expect(monthWords("ma", today)).toEqual(["@2026-03", "@2026-05"]);
    expect(monthWords("ok", today)).toEqual(["@2026-10"]);
    expect(monthWord("feb", today)).toBe("@2026-02");
    expect(monthWord("dezember", today)).toBe("@2026-12");
    expect(monthWord("febr", today)).toBeNull(); // only whole names or the usual short forms
  });

  it("takes phrases in quotes as one term, spaces included (D38)", () => {
    const t = collectTasks([set("q", "2026-10-12T08:00:00Z", "- [ ] send the offer\n- [ ] offer send\n- [ ] call back Ben")]);
    const texts = (text: string) => groupTasks(t, { labels: [], text, showDone: false }, today).flatMap((g) => g.tasks.map((x) => x.text));
    expect(texts("send offer")).toEqual(["send the offer", "offer send"]);
    expect(texts('"offer send"')).toEqual(["offer send"]);
    expect(texts("„call back“")).toEqual(["call back Ben"]);
    expect(texts('"offer se')).toEqual(["offer send"]); // unclosed, while typing
  });


  it("finds tasks by the sender's address too", () => {
    const t = collectTasks(sets);
    expect(groupTasks(t, { labels: [], text: "anna@x", showDone: false }, today).flatMap((g) => g.tasks)).toHaveLength(5);
  });

  it("writes the shown list as Markdown, the email as \"Subject\" - Name <address>, date (D38)", async () => {
    const t = collectTasks([set("md", "2026-10-12T08:00:00Z", "- [ ] send it @2026-10-20 #work\n- [ ] read [Offer – Ben, 12 Oct](mid:o@x) and [the draft](mid:d@x), [old](mid:gone@x)")]);
    const lookup = async (id: string) =>
      id === "o@x" ? { subject: "Offer", name: "Ben", address: "ben@y", date: "2026-10-12T09:00:00Z" } : id === "d@x" ? { subject: 'Re: "Draft"', name: "", address: "c@z" } : null;
    const md = await listAsMarkdown(sections(t, { labels: [], text: "", showDone: false }, ["work"], today), lookup);
    expect(md).toBe(
      '## Next 7 days\n\n- [ ] send it @2026-10-20 #work ("Holiday plans" - Anna <anna@x>, 2026-10-12)\n\n' +
        '## No date\n\n- [ ] read (reference to email: "Offer" - Ben <ben@y>, 2026-10-12) and the draft (reference to email: "Re: "Draft"" - <c@z>), ' +
        '(reference to email: old) ("Holiday plans" - Anna <anna@x>, 2026-10-12)\n'
    );
    const byEmail = await listAsMarkdown(sections(t, { labels: [], text: "", showDone: false, groupBy: "email" }, ["work"], today), lookup);
    expect(byEmail.split("\n")[0]).toBe('## "Holiday plans" - Anna <anna@x>, 2026-10-12');
  });

  it("writes the subject exactly as it is, the address alone without a name", () => {
    expect(emailRef({ subject: 'Re: "Offer" - x', name: "Anna", address: "anna@x" })).toBe('"Re: "Offer" - x" - Anna <anna@x>');
    expect(emailRef({ subject: "Hi", name: "anna@x", address: "anna@x" })).toBe('"Hi" - <anna@x>');
    expect(emailRef({ subject: "Hi", name: "", address: "" })).toBe('"Hi"');
  });
});

describe("notes as Markdown (copied from an email)", () => {
  const email = { subject: "Contract", name: "Anna Berg", address: "anna@example.com", date: "2026-10-12T09:00:00Z" };
  const lookup = async (id: string) => (id === "x@y" ? { subject: "Offer", name: "Ben", address: "ben@example.com", date: "2026-10-01T09:00:00Z" } : null);

  it("copies one note: a heading with the passage and the email, then the text", async () => {
    expect(await noteAsMarkdown({ quote: "the price\nis final", md: "Ask about [Offer – Ben, 1 Oct](mid:x@y)" }, email, lookup)).toBe(
      '## Note anchored to "the price is final" in email "Contract" - Anna Berg <anna@example.com>, 2026-10-12\n\nAsk about (reference to email: "Offer" - Ben <ben@example.com>, 2026-10-01)\n',
    );
  });

  it("copies the note on the whole email under a heading saying so", async () => {
    expect(await noteAsMarkdown({ md: "Reply by Friday" }, email)).toBe('## Note on email "Contract" - Anna Berg <anna@example.com>, 2026-10-12\n\nReply by Friday\n');
  });

  it("copies all notes under the email as heading, each under its own, plain highlights left out", async () => {
    const md = await notesAsMarkdown(email, "Overall fine", [{ quote: "price", md: "too high" }, { quote: "deadline", md: "" }]);
    expect(md).toBe(
      '## "Contract" - Anna Berg <anna@example.com>, 2026-10-12\n\n### Note on the whole email\n\nOverall fine\n\n### Note anchored to "price"\n\ntoo high\n',
    );
  });
});

describe("shiftHeadings (a note's headings under its heading in a copy)", () => {
  it("pushes headings down, past six levels too", () => {
    expect(shiftHeadings("# Plan\ntext\n#### Deep", 3)).toBe("#### Plan\ntext\n####### Deep");
  });
  it("turns underlined headings into # headings", () => {
    expect(shiftHeadings("Title\n===\n\nSub\n---\nmore", 2)).toBe("### Title\n\n#### Sub\nmore");
  });
  it("leaves code blocks, hashtags and rules alone", () => {
    const md = "```sh\n# comment\n```\n#label here\n\n- item\n---";
    expect(shiftHeadings(md, 2)).toBe(md);
  });
});

describe("sub-tasks (D38)", () => {
  it("links a task to its parent task and counts the parent's done sub-tasks", () => {
    const set = {
      version: 1,
      email: { messageId: "m@x", subject: "S", from: "A <a@x>", date: "2026-10-10T08:00:00Z" },
      rev: 1,
      created: "2026-10-10T08:00:00Z",
      updated: "2026-10-10T08:00:00Z",
      emailNoteMd: "- [ ] parent\n  - [x] one\n  - [ ] two\n- Topic\n  - [ ] three",
      annotations: [],
    } as unknown as AnnotationSet;
    const byText = Object.fromEntries(collectTasks([set]).map((t) => [t.text, t]));
    expect(byText.parent!.children).toHaveLength(2);
    expect(byText.parent!.childrenDone).toBe(1);
    expect(byText.one!.parentKey).toBe("|m@x|email-note|0");
    expect(byText.two!.partOf).toBe("parent");
    expect(byText.three!.partOf).toBe("Topic");
    expect(byText.three!.parentKey).toBeUndefined();
  });

  it("keeps done sub-tasks under their parents when grouped by email with done inline", () => {
    const set = {
      version: 1,
      email: { messageId: "m@x", subject: "S", from: "A <a@x>", date: "2026-10-10T08:00:00Z" },
      rev: 1,
      created: "2026-10-10T08:00:00Z",
      updated: "2026-10-10T08:00:00Z",
      emailNoteMd: "- [ ] parent\n  - [x] one\n  - [ ] two\n- [ ] last",
      annotations: [],
    } as unknown as AnnotationSet;
    const [section] = sections(collectTasks([set]), { labels: [], text: "", showDone: true, doneInline: true, groupBy: "email" }, []);
    expect(section!.tasks.map((t) => t.text)).toEqual(["parent", "one", "two", "last"]);
  });
});
