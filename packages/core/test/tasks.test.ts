/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { preferredSpellings, convertLooseDates, dateSuggestions, editTask, setAlwaysShowYear, formatDue, isOverdue, labelsIn, isValidDate, looseDates, markDone, parseDateWord, setTaskDone, taskAt, taskAtLine, tasksIn, removeLabelFromNote, labelsInText, looseDatesInText } from "../src/index.js";

const today = new Date(2026, 9, 16); // Fri 16 Oct 2026

describe("tasks (D38)", () => {
  it("parses typed dates", () => {
    expect(parseDateWord("today", today)).toBe("2026-10-16");
    expect(parseDateWord("morgen", today)).toBe("2026-10-17");
    expect(parseDateWord("fri", today)).toBe("2026-10-23"); // the next Friday, not today
    expect(parseDateWord("montag", today)).toBe("2026-10-19");
    expect(parseDateWord("24.10.", today)).toBe("2026-10-24");
    expect(parseDateWord("24.10", today)).toBe("2026-10-24");
    expect(parseDateWord("10.10", today)).toBe("2027-10-10"); // already past this year
    expect(parseDateWord("1.3.", today)).toBe("2027-03-01"); // past this year: next year
    expect(parseDateWord("24.10.27", today)).toBe("2027-10-24");
    expect(parseDateWord("31.2.", today)).toBeNull();
    expect(parseDateWord("banana", today)).toBeNull();
  });

  it("understands past days, in a week/month and counts (D38)", () => {
    // today is Friday 16 Oct 2026
    expect(parseDateWord("yesterday", today)).toBe("2026-10-15");
    expect(parseDateWord("gestern", today)).toBe("2026-10-15");
    expect(parseDateWord("vorgestern", today)).toBe("2026-10-14");
    expect(parseDateWord("lastmonday", today)).toBe("2026-10-12");
    expect(parseDateWord("last-mon", today)).toBe("2026-10-12");
    expect(parseDateWord("letztenmontag", today)).toBe("2026-10-12");
    expect(parseDateWord("lastfriday", today)).toBe("2026-10-09"); // today is Friday: a week ago
    expect(parseDateWord("lastbanana", today)).toBeNull();
    expect(parseDateWord("inaweek", today)).toBe("2026-10-23");
    expect(parseDateWord("in-a-week", today)).toBe("2026-10-23");
    expect(parseDateWord("ineinerwoche", today)).toBe("2026-10-23");
    expect(parseDateWord("inamonth", today)).toBe("2026-11-16");
    expect(parseDateWord("3d", today)).toBe("2026-10-19");
    expect(parseDateWord("3t", today)).toBe("2026-10-19");
    expect(parseDateWord("2w", today)).toBe("2026-10-30");
    expect(parseDateWord("1m", today)).toBe("2026-11-16");
    expect(parseDateWord("1y", today)).toBe("2027-10-16");
    expect(parseDateWord("-3d", today)).toBe("2026-10-13");
    expect(parseDateWord("-1w", today)).toBe("2026-10-09");
    expect(parseDateWord("1m", new Date(2027, 0, 31))).toBe("2027-02-28"); // the month's last day
    expect(parseDateWord("3dprinting", today)).toBeNull();
    expect(parseDateWord("3x", today)).toBeNull();
  });

  it("understands year-first number dates, also with one digit (D38)", () => {
    expect(parseDateWord("26-1-2", today)).toBe("2026-01-02");
    expect(parseDateWord("2026-1-2", today)).toBe("2026-01-02");
    expect(parseDateWord("27-10-24", today)).toBe("2027-10-24");
    expect(parseDateWord("26-01-02", today)).toBe("2026-01-02");
    expect(parseDateWord("26-2-30", today)).toBeNull();
    expect(parseDateWord("26-13-1", today)).toBeNull();
    expect(parseDateWord("2026-1", today)).toBeNull();
    expect(looseDates("call @26-1-2 now", today)).toMatchObject([{ word: "26-1-2", iso: "2026-01-02", numeric: true }]);
  });

  it("shows dates without the year in the current year, with it otherwise", () => {
    expect(formatDue("2026-10-24", today, "en-GB")).toBe("Sat 24 Oct");
    expect(formatDue("2027-01-11", today, "en-GB")).toBe("Mon 11 Jan 2027");
    setAlwaysShowYear(true); // the setting "Hide the current year" off
    expect(formatDue("2026-10-24", today, "en-GB")).toBe("Sat 24 Oct 2026");
    setAlwaysShowYear(false);
    expect(isOverdue("2026-10-15", today)).toBe(true);
    expect(isOverdue("2026-10-16", today)).toBe(false);
  });

  it("suggests likely dates while typing", () => {
    expect(dateSuggestions("", today).map((s) => s.hint).slice(0, 3)).toEqual(["today", "tomorrow", "sunday"]); // tomorrow is Saturday: not twice
    expect(dateSuggestions("mo", today)[0]).toEqual({ iso: "2026-10-19", hint: "mo" });
    expect(dateSuggestions("", today).map((s) => s.hint)).not.toContain("yesterday"); // the empty list looks ahead
    expect(dateSuggestions("y", today)).toEqual([{ iso: "2026-10-15", hint: "yesterday" }]);
    expect(dateSuggestions("last", today).map((s) => s.hint).slice(0, 2)).toEqual(["last thursday", "last wednesday"]);
    expect(dateSuggestions("ina", today).map((s) => s.hint)).toEqual(["in a week", "in a month"]);
    expect(dateSuggestions("ge", today)).toEqual([{ iso: "2026-10-15", hint: "gestern" }]);
    expect(dateSuggestions("vorg", today)).toEqual([{ iso: "2026-10-14", hint: "vorgestern" }]);
    expect(dateSuggestions("mor", today)).toEqual([{ iso: "2026-10-17", hint: "morgen" }]);
    expect(dateSuggestions("üb", today)[0]).toEqual({ iso: "2026-10-18", hint: "übermorgen" });
    expect(dateSuggestions("letztenmont", today)).toEqual([{ iso: "2026-10-12", hint: "letzten montag" }]);
    expect(dateSuggestions("ineinerw", today)).toEqual([{ iso: "2026-10-23", hint: "in einer woche" }]);
    expect(dateSuggestions("3", today).map((s) => s.hint)).toEqual(["in 3 days", "in 3 weeks", "in 3 months"]);
    expect(dateSuggestions("-2", today).map((s) => s.hint)).toEqual(["2 days ago", "2 weeks ago", "2 months ago"]);
    expect(dateSuggestions("2w", today)).toEqual([{ iso: "2026-10-30", hint: "in 2 weeks" }]);
  });

  it("finds labels, not headings, numbers or URL fragments", () => {
    expect(labelsIn("# Heading\n- [ ] call #contract-renewal #important\nsee #123 and https://x.example/#top\n```\n#code\n```")).toEqual([
      "contract-renewal",
      "important",
    ]);
  });

  it("finds @ dates that aren't ISO yet, and converts them", () => {
    const md = "- [ ] call @24.10.27 and @freitag. Also @mo, @2026-10-24, anna@24.10.27\n```\n@24.10.27\n```";
    const loose = looseDates(md, today);
    expect(loose.map((d) => [d.word, d.iso, d.numeric])).toEqual([
      ["24.10.27", "2027-10-24", true],
      ["freitag", "2026-10-23", false],
    ]);
    expect(convertLooseDates(md, loose).split("\n")[0]).toBe("- [ ] call @2027-10-24 and @2026-10-23. Also @mo, @2026-10-24, anna@24.10.27");
  });
});

describe("task view (D38)", () => {
  it("finds checklist items with their dates and labels, not in code", () => {
    const md = [
      "Intro @2026-10-01",
      "- [ ] call Anna @2026-10-24 #contract",
      "  about the offer @2026-10-20",
      "  - [x] sub-task #done",
      "1. [ ] numbered",
      "> - [ ] quoted",
      "- plain item",
      "```",
      "- [ ] in code",
      "```",
    ].join("\n");
    const tasks = tasksIn(md);
    expect(tasks.map((t) => [t.line, t.text, t.done])).toEqual([
      [1, "call Anna @2026-10-24 #contract about the offer @2026-10-20", false],
      [3, "sub-task #done", true],
      [4, "numbered", false],
      [5, "quoted", false],
    ]);
    expect(tasks[0]!.dates).toEqual(["2026-10-20", "2026-10-24"]);
    expect(tasks[0]!.labels).toEqual(["contract"]);
  });

  it("ticks an item by its line, or finds it again after the note changed", () => {
    const md = "- [ ] a\n- [ ] b";
    const b = tasksIn(md)[1]!;
    expect(setTaskDone(md, b, true, today)).toBe("- [ ] a\n- [x] b ✅ 2026-10-16");
    expect(setTaskDone("new line\n" + md, b, true, today)).toBe("new line\n- [ ] a\n- [x] b ✅ 2026-10-16");
    expect(setTaskDone("- [ ] a", b, true, today)).toBeNull(); // gone
    expect(setTaskDone("- [x] b", { line: 0, raw: "- [x] b" }, false)).toBe("- [ ] b");
  });
});

describe("finished date (D38)", () => {
  it("adds today's date on ticking and removes it on unticking", () => {
    expect(markDone("- [ ] call Anna @2026-10-20 #work", true, today)).toBe("- [x] call Anna @2026-10-20 #work ✅ 2026-10-16");
    expect(markDone("- [x] call Anna ✅ 2026-10-16", false, today)).toBe("- [ ] call Anna");
    expect(markDone("- [x] call ✅ 2026-10-01", true, today)).toBe("- [x] call ✅ 2026-10-01"); // keeps its date
    expect(markDone("> 1. [ ] quoted  ", true, today)).toBe("> 1. [x] quoted ✅ 2026-10-16");
    expect(markDone("plain text", true, today)).toBe("plain text");
  });

  it("reads it into the task, and ticks through setTaskDone", () => {
    const md = "- [ ] a\n- [x] b ✅ 2026-10-01";
    expect(tasksIn(md).map((t) => t.doneOn)).toEqual([undefined, "2026-10-01"]);
    expect(setTaskDone(md, tasksIn(md)[0]!, true, today)).toBe("- [x] a ✅ 2026-10-16\n- [x] b ✅ 2026-10-01");
    expect(setTaskDone(md, tasksIn(md)[1]!, false, today)).toBe("- [ ] a\n- [ ] b");
  });

  it("ignores impossible dates: no due date, no finished date", () => {
    const [open, done] = tasksIn("- [ ] call @2026-13-45 and @2026-10-20\n- [x] done ✅ 2026-02-30");
    expect(open!.dates).toEqual(["2026-10-20"]);
    expect(done!.doneOn).toBeUndefined();
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2027-02-29")).toBe(false);
  });
});

describe("quick changes from the task view (D38)", () => {
  const md = "- [ ] call Anna @2026-10-20 #work\n  about the offer @2026-10-25\n- [x] done ✅ 2026-10-01";
  const [call, done] = tasksIn(md);
  const edit = (task: typeof call, e: Parameters<typeof editTask>[2], text = md) => editTask(text, task!, e)?.md;

  it("sets, moves and removes the due date", () => {
    expect(edit(call, { kind: "due", iso: "2026-10-17", from: "2026-10-20" })).toBe("- [ ] call Anna @2026-10-17 #work\n  about the offer @2026-10-25\n- [x] done ✅ 2026-10-01");
    expect(edit(done, { kind: "due", iso: "2026-10-17" })).toBe("- [ ] call Anna @2026-10-20 #work\n  about the offer @2026-10-25\n- [x] done @2026-10-17 ✅ 2026-10-01"); // before the finished date
    expect(edit(call, { kind: "due", iso: null, from: "2026-10-25" })).toBe("- [ ] call Anna @2026-10-20 #work\n  about the offer\n- [x] done ✅ 2026-10-01"); // also on a continuation line
  });

  it("changes or removes only the occurrence clicked when a date is there twice", () => {
    const twice = "- [ ] a @2026-10-20 and @2026-10-20\n  again @2026-10-20";
    const t = tasksIn(twice)[0]!;
    expect(editTask(twice, t, { kind: "due", iso: null, from: "2026-10-20", nth: 1 })!.md).toBe("- [ ] a @2026-10-20 and\n  again @2026-10-20");
    expect(editTask(twice, t, { kind: "due", iso: "2026-10-21", from: "2026-10-20", nth: 2 })!.md).toBe("- [ ] a @2026-10-20 and @2026-10-20\n  again @2026-10-21");
    expect(editTask(twice, t, { kind: "due", iso: null, from: "2026-10-20" })!.md).toBe("- [ ] a and\n  again"); // without nth: all
  });

  it("adds and removes labels", () => {
    expect(edit(call, { kind: "addLabel", label: "urgent" })).toBe("- [ ] call Anna @2026-10-20 #work #urgent\n  about the offer @2026-10-25\n- [x] done ✅ 2026-10-01");
    expect(edit(call, { kind: "addLabel", label: "Work" })).toBe(md); // has it already
    expect(edit(call, { kind: "removeLabel", label: "work" })).toBe("- [ ] call Anna @2026-10-20\n  about the offer @2026-10-25\n- [x] done ✅ 2026-10-01");
    expect(editTask("- [ ] a #work-x #work", { line: 0, raw: "- [ ] a #work-x #work" }, { kind: "removeLabel", label: "work" })!.md).toBe("- [ ] a #work-x");
  });

  it("puts the lines back (undo), only if they are still as left", () => {
    const changed = editTask(md, call!, { kind: "due", iso: null, from: "2026-10-25" })!;
    const undo = { kind: "restore" as const, block: changed.before, current: changed.after };
    expect(editTask(changed.md, call!, undo)!.md).toBe(md);
    expect(editTask(md, call!, undo)).toBeNull(); // not as left: nothing done
  });
});

describe("label spellings (D38)", () => {
  it("one label regardless of case, shown as most often written (on a tie the first)", () => {
    const m = preferredSpellings(["URGENT", "urgent", "URGENT", "Work", "work"]);
    expect(m.get("urgent")).toBe("URGENT");
    expect(m.get("work")).toBe("Work");
  });
});

describe("taskAt (copy the task on a clicked line)", () => {
  const md = ["Intro", "- [ ] call Anna", "  about the offer", "  - [x] sub-task", "", "- plain item"].join("\n");
  it("finds the task on its own line and on the lines continuing its text", () => {
    expect(taskAt(md, 1)?.text).toBe("call Anna about the offer");
    expect(taskAt(md, 2)?.text).toBe("call Anna about the offer");
  });
  it("finds a sub-item as a task of its own", () => {
    expect(taskAt(md, 3)?.text).toBe("sub-task");
  });
  it("finds nothing on text, blank lines or other list items", () => {
    expect(taskAt(md, 0)).toBeNull();
    expect(taskAt(md, 4)).toBeNull();
    expect(taskAt(md, 5)).toBeNull();
  });
});

describe("sub-tasks (the item a task is indented under)", () => {
  const md = [
    "- [ ] Prepare offer",
    "  - [ ] call Anna",
    "    about the price",
    "  - [x] send draft",
    "",
    "  - [ ] book room",
    "- Project Falcon",
    "  - [ ] kick-off",
    "    1. [ ] agenda",
    "Text",
    "  - [ ] after text",
  ].join("\n");
  const byText = Object.fromEntries(tasksIn(md).map((t) => [t.text, t.parent]));
  it("finds a task's parent task, over continuation lines, siblings and blank lines", () => {
    expect(byText["Prepare offer"]).toBeUndefined();
    expect(byText["call Anna about the price"]).toEqual({ line: 0, text: "Prepare offer", task: true });
    expect(byText["send draft"]).toEqual({ line: 0, text: "Prepare offer", task: true });
    expect(byText["book room"]).toEqual({ line: 0, text: "Prepare offer", task: true });
  });
  it("names a plain bullet as what a task is part of, and nests numbered items", () => {
    expect(byText["kick-off"]).toEqual({ line: 6, text: "Project Falcon", task: false });
    expect(byText["agenda"]).toEqual({ line: 7, text: "kick-off", task: true });
  });
  it("has none once the list ended", () => {
    expect(byText["after text"]).toBeUndefined();
  });
});

describe("removeLabelFromNote (a label deleted everywhere)", () => {
  it("takes the label out wherever it is, in any case, closing up the text", () => {
    const md = "- [ ] call Anna #Urgent today\n- [ ] #urgent first\nNote #urgent\n- [ ] keep #urgently and #other";
    expect(removeLabelFromNote(md, "urgent")).toBe("- [ ] call Anna today\n- [ ] first\nNote\n- [ ] keep #urgently and #other");
  });
  it("leaves code blocks alone", () => {
    const md = "```\n#urgent in code\n```\ntext #urgent";
    expect(removeLabelFromNote(md, "urgent")).toBe("```\n#urgent in code\n```\ntext");
  });
});

// D22: helpers for the message display script, which has no Markdown parser.
describe("parser-free helpers", () => {
  it("find the task on a line from the lines' shape, as taskAt does outside code", () => {
    const md = "- [ ] send offer\n  to Anna\n- [ ]\ntext";
    for (const line of [0, 1, 2, 3]) expect(taskAtLine(md, line)?.text ?? null).toEqual(taskAt(md, line)?.text ?? null);
    expect(taskAtLine(md, 1)?.text).toBe("send offer to Anna");
    // In code only the parser knows: the caller (a rendered box, the editor's syntax tree) rules that out.
    expect(taskAt("```\n- [ ] x\n```", 1)).toBeNull();
  });
  it("read labels and @ dates in a piece of text", () => {
    expect(labelsInText("#a and #b, #a")).toEqual(["a", "b"]);
    expect(looseDatesInText("call @24.10.27", new Date("2026-10-18T12:00:00")).map((d) => d.iso)).toEqual(["2027-10-24"]);
  });
});
