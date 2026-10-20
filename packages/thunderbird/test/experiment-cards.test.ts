/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment jsdom

// The Experiment's post-it and note previews on cards (implementation.js, part 8, D26). The file runs with
// stand-ins for Thunderbird's modules; a card is a stand-in with Thunderbird's template parts.

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

const source = readFileSync(new URL("../experiments/thundernotes/implementation.js", `file://${__filename}`), "utf8");

interface Parts {
  addCardIcons(win: unknown): void;
  uninstallCardIcons(): void;
  setCardPreviews(previews: Record<string, { text: string; background?: string; color?: string; border?: string }>): Promise<void>;
}

/** The Experiment's own functions, with Thunderbird's modules stubbed. */
function load(): Parts {
  const ChromeUtils = {
    waiveXrays: <T>(x: T) => x,
    importESModule: () => ({ ExtensionCommon: { ExtensionAPI: class {} }, ExtensionUtils: { ExtensionError: Error }, setTimeout, clearTimeout, ExtensionSupport: {} }),
    // Accounts by server, as MailServices.accounts answers.
    defineESModuleGetters(lazy: Record<string, unknown>) {
      lazy.MailServices = { accounts: { findAccountForServer: (server: { account: string }) => ({ key: server.account }) } };
    },
  };
  const scope: { thundernotes?: new () => { getAPI(c: unknown): { thundernotes: Parts } } } = {};
  const run = new Function("ChromeUtils", "Services", `${source}\nreturn { addCardIcons, uninstallCardIcons };`);
  const parts = run.call(scope, ChromeUtils, {});
  return { ...parts, setCardPreviews: new scope.thundernotes!().getAPI({}).thundernotes.setCardPreviews };
}

/** Message headers by row: keywords as Thunderbird stores them, Message-ID; null for a group header. */
let headers: ({ keywords: string; messageId?: string } | null)[];
let filled: number;

class ThreadCard {
  el: HTMLElement;
  _index: number;
  ownerDocument = document;
  // As seen through the Experiment's eyes in Thunderbird: no window to be had from a card.
  ownerGlobal = undefined;
  constructor(index: number) {
    this._index = index;
    this.el = document.createElement("td"); // a card is a table cell, as in Thunderbird
    this.el.innerHTML = `<div class="thread-card-row"><span class="sender">Anna</span><span class="date">Today</span></div>
      <div class="thread-card-icon-info"><img class="attachment-icon"><thread-card-tags></thread-card-tags></div>`;
    (document.querySelector(".tree") ?? document.body).append(this.el);
  }
  querySelector(selector: string) {
    return this.el.querySelector(selector);
  }
  closest(selector: string) {
    return this.el.closest(selector);
  }
  /** As Thunderbird's: the message's tag keys onto the card's tags element. */
  fillRow() {
    filled++;
    const h = headers[this._index];
    const tags = this.querySelector("thread-card-tags")!;
    if (h) tags.setAttribute("tags", h.keywords);
    else tags.removeAttribute("tags");
  }
}

/** The message list's window: its list (gDBView) by row, as Thunderbird's. */
function windowWith(Card: typeof ThreadCard, list = true) {
  const gDBView = {
    getMsgHdrAt: (i: number) => {
      const h = headers[i];
      if (!h) throw new Error("dummy row");
      return { messageId: h.messageId ?? `m${i}@x`, folder: { server: { account: "account1" } }, getStringProperty: (name: string) => (name === "keywords" ? h.keywords : "") };
    },
  };
  return {
    customElements: { get: () => Card, whenDefined: async () => Card },
    document,
    threadTree: { invalidate() {} },
    addEventListener() {},
    requestAnimationFrame() {},
    ...(list && { gDBView }),
  };
}

const icon = (card: ThreadCard) => card.querySelector(".thundernotes-card-icon") as HTMLImageElement | null;

beforeEach(() => {
  document.body.innerHTML = "";
  headers = [{ keywords: "$label1 $annotated" }, { keywords: "$label1" }, null];
  filled = 0;
});

describe("the post-it on cards", () => {
  it("shows on cards of messages with notes, among the icons before the tags; not on others", () => {
    const { addCardIcons, uninstallCardIcons } = load();
    class Card extends ThreadCard {}
    addCardIcons(windowWith(Card));
    const cards = [0, 1, 2].map((i) => new Card(i));
    cards.forEach((c) => c.fillRow());
    expect(filled).toBe(3); // Thunderbird's own filling still runs
    expect(icon(cards[0]!)?.hidden).toBe(false);
    expect(icon(cards[0]!)?.nextElementSibling?.tagName).toBe("THREAD-CARD-TAGS");
    expect(icon(cards[1]!)).toBeNull();
    expect(icon(cards[2]!)).toBeNull(); // a group header
    uninstallCardIcons();
  });

  it("follows a reused card to another message, and the tag being removed", () => {
    const { addCardIcons, uninstallCardIcons } = load();
    class Card extends ThreadCard {}
    addCardIcons(windowWith(Card));
    const card = new Card(0);
    card.fillRow();
    card._index = 1; // scrolled: the same card shows another message
    card.fillRow();
    expect(icon(card)?.hidden).toBe(true);
    card._index = 0;
    headers[0] = { keywords: "$label1" };
    card.fillRow();
    expect(icon(card)?.hidden).toBe(true);
    uninstallCardIcons();
  });

  it("reads the card's tags: also where the message list's own values are hidden from the Experiment", () => {
    const { addCardIcons, uninstallCardIcons } = load();
    class Card extends ThreadCard {}
    addCardIcons(windowWith(Card, false)); // no list to be seen
    const card = new Card(0);
    card.fillRow();
    expect(icon(card)?.hidden).toBe(false);
    uninstallCardIcons();
  });

  it("wraps once, and is undone when the add-on stops", () => {
    const { addCardIcons, uninstallCardIcons } = load();
    class Card extends ThreadCard {}
    const own = Card.prototype.fillRow;
    addCardIcons(windowWith(Card));
    addCardIcons(windowWith(Card)); // the same window again: not wrapped twice
    const card = new Card(0);
    card.fillRow();
    expect(filled).toBe(1);
    uninstallCardIcons();
    expect(Card.prototype.fillRow).toBe(own);
    expect(icon(card)).toBeNull();
  });
});

const preview = (card: ThreadCard) => card.querySelector(".thundernotes-card-preview") as HTMLElement | null;
/** The lozenge inside a preview's box. */
const pill = (card: ThreadCard) => preview(card)?.firstElementChild as HTMLElement | null;

describe("the whole-email note's preview on cards", () => {
  it("3 rows: on the last line, right-aligned against the icons; only for emails with a preview", async () => {
    const { addCardIcons, uninstallCardIcons, setCardPreviews } = load();
    class Card extends ThreadCard {}
    addCardIcons(windowWith(Card));
    await setCardPreviews({ "account1|m0@x": { text: "Call Anna · ☐ send the offer", background: "rgba(64, 192, 87, 0.5)", color: "#000000", border: "#2b8a3e" } });
    const [withNote, without] = [new Card(0), new Card(1)];
    withNote.fillRow();
    without.fillRow();
    expect(pill(withNote)?.textContent).toBe("Call Anna · ☐ send the offer");
    expect(preview(withNote)?.title).toBe("Call Anna · ☐ send the offer"); // the whole text on hover
    // A lozenge in the note's colour.
    expect(pill(withNote)?.style.background).toContain("rgba(64, 192, 87, 0.5)");
    expect(pill(withNote)?.style.color).toBe("rgb(0, 0, 0)");
    expect(pill(withNote)?.style.borderRadius).toBe("999px");
    // The outline inside the lozenge, which stays shorter than the card's line (else it was cut off).
    expect(pill(withNote)?.style.boxShadow).toContain("inset");
    expect(pill(withNote)?.style.borderStyle).toBe("");
    expect(Number(pill(withNote)?.style.lineHeight)).toBeLessThan(1.5);
    // The subject's size: no size of its own (it inherits the card's, as the subject does).
    expect(pill(withNote)?.style.fontSize).toBe("");
    // A limit that counts when the list's width is worked out (a long note widened the whole list).
    expect(pill(withNote)?.style.maxInlineSize).toMatch(/em$/);
    expect(preview(withNote)?.parentElement?.className).toBe("thread-card-icon-info");
    expect(preview(withNote)?.nextElementSibling?.className).toBe("attachment-icon");
    // Thunderbird's own icons box, which it puts at the right end, is left as it is (stretching it
    // put the icons short of the edge in Thunderbird).
    expect((withNote.querySelector(".thread-card-icon-info") as HTMLElement).getAttribute("style")).toBeNull();
    expect(preview(without)).toBeNull();
    uninstallCardIcons();
  });

  it("2 rows: on the first line against the date, the sender left as Thunderbird sizes it", async () => {
    const { addCardIcons, uninstallCardIcons, setCardPreviews } = load();
    document.body.innerHTML = `<div class="tree cards-row-compact"></div>`;
    class Card extends ThreadCard {}
    addCardIcons(windowWith(Card));
    await setCardPreviews({ "account1|m0@x": { text: "Call Anna" } });
    const card = new Card(0);
    card.fillRow();
    expect(preview(card)?.previousElementSibling?.className).toBe("sender");
    expect(preview(card)?.nextElementSibling?.className).toBe("date");
    expect(preview(card)?.style.maxInlineSize).not.toMatch(/%/); // a percentage widened the list
    // Changing the sender's sizing shifted the date in Thunderbird: left alone.
    expect((card.querySelector(".sender") as HTMLElement).getAttribute("style")).toBeNull();
    expect((card.querySelector(".date") as HTMLElement).getAttribute("style")).toBeNull();
    uninstallCardIcons();
    expect(preview(card)).toBeNull();
  });

  it("goes when the note goes, or with the previews switched off", async () => {
    const { addCardIcons, uninstallCardIcons, setCardPreviews } = load();
    class Card extends ThreadCard {}
    addCardIcons(windowWith(Card));
    await setCardPreviews({ "account1|m0@x": { text: "Call Anna" } });
    const card = new Card(0);
    card.fillRow();
    await setCardPreviews({});
    card.fillRow();
    expect(preview(card)?.hidden).toBe(true);
    uninstallCardIcons();
  });

  it("is per account: the same email in another account shows its own", async () => {
    const { addCardIcons, uninstallCardIcons, setCardPreviews } = load();
    class Card extends ThreadCard {}
    addCardIcons(windowWith(Card));
    await setCardPreviews({ "account2|m0@x": { text: "Elsewhere" } });
    const card = new Card(0);
    card.fillRow();
    expect(preview(card)).toBeNull();
    uninstallCardIcons();
  });

  it("is left out on narrow cards", async () => {
    const { addCardIcons, uninstallCardIcons, setCardPreviews } = load();
    class Card extends ThreadCard {}
    let frame: (() => void) | undefined;
    const win = { ...windowWith(Card), requestAnimationFrame: (f: () => void) => void (frame = f) };
    addCardIcons(win);
    await setCardPreviews({ "account1|m0@x": { text: "Call Anna" } });
    const card = new Card(0);
    const width = (w: number) => (card.el.getBoundingClientRect = () => new DOMRect(0, 0, w, 40));
    width(420);
    card.fillRow();
    frame?.();
    expect(preview(card)?.hidden).toBe(true);
    width(900); // the pane made wider: refitted
    card.fillRow();
    frame?.();
    expect(preview(card)?.hidden).toBe(false);
    uninstallCardIcons();
  });

  /** Sets an element's laid-out sizes, as Thunderbird would have them (jsdom has no layout). */
  const size = (el: Element | null, width: number, scroll = width) => {
    Object.defineProperty(el!, "clientWidth", { configurable: true, value: width });
    Object.defineProperty(el!, "scrollWidth", { configurable: true, value: scroll });
    (el as HTMLElement).getBoundingClientRect = () => new DOMRect(0, 0, width, 20);
  };

  it("measured: up to 75 % of the line's free room, with 2 rows after the sender's whole name and the date", async () => {
    const { addCardIcons, uninstallCardIcons, setCardPreviews } = load();
    document.body.innerHTML = `<div class="tree cards-row-compact"></div>`;
    class Card extends ThreadCard {}
    let frame: (() => void) | undefined;
    addCardIcons({ ...windowWith(Card), requestAnimationFrame: (f: () => void) => void (frame = f) });
    await setCardPreviews({ "account1|m0@x": { text: "Call Anna" } });
    const card = new Card(0);
    card.fillRow();
    size(card.el, 1200);
    size(card.querySelector(".thread-card-row"), 1000);
    // Thunderbird stretches the sender's box (600); its name's text needs 220.
    size(card.querySelector(".sender"), 600);
    const range = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 220, 20);
    size(card.querySelector(".date"), 120);
    frame!();
    Range.prototype.getBoundingClientRect = range;
    // 1000 − 220 (the name) − 120 (date) − 12 − 4 (the preview's margins) = 644 free; 75 %: 483.
    expect(pill(card)?.style.maxInlineSize).toBe("483px");
    uninstallCardIcons();
  });

  it("measured: with 3 rows the third line, less the icons and the replies button", async () => {
    const { addCardIcons, uninstallCardIcons, setCardPreviews } = load();
    class Card extends ThreadCard {}
    let frame: (() => void) | undefined;
    addCardIcons({ ...windowWith(Card), requestAnimationFrame: (f: () => void) => void (frame = f) });
    await setCardPreviews({ "account1|m0@x": { text: "Call Anna" } });
    const card = new Card(0);
    // Thunderbird's third line: the replies button, then the icons box.
    const icons = card.querySelector(".thread-card-icon-info")!;
    const line = document.createElement("div");
    line.className = "thread-card-dynamic-row";
    line.innerHTML = `<button class="thread-card-button"></button>`;
    icons.before(line);
    line.append(icons);
    card.fillRow();
    size(card.el, 1200);
    size(line, 1100);
    size(line.querySelector(".thread-card-button"), 60);
    size(icons.querySelector(".attachment-icon"), 0); // no attachment: not shown
    size(icons.querySelector(".thundernotes-card-icon"), 16);
    size(icons.querySelector("thread-card-tags"), 40);
    frame!();
    // 1100 − 60 (button) − 16 − 40 (icons) − 12 (margin) = 972 free; 75 %: 729.
    expect(pill(card)?.style.maxInlineSize).toBe("729px");
    uninstallCardIcons();
  });
});
