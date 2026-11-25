/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// A link in a highlight: its right-click menu opens it and copies it.

import { describe, expect, it } from "vitest";
import { linkItems } from "../src/link-items.js";

function use(href: string): { labels: string[]; opened: string[]; copied: string[] } {
  const opened: string[] = [];
  const copied: string[] = [];
  const items = linkItems(href, (u) => opened.push(u), (t) => copied.push(t));
  for (const item of items) item.run?.();
  return { labels: items.map((i) => i.label), opened, copied };
}

describe("a highlighted link's menu entries", () => {
  it("opens and copies a web address", () => {
    expect(use("https://example.com/a?b=1")).toEqual({ labels: ["Open link", "Copy link"], opened: ["https://example.com/a?b=1"], copied: ["https://example.com/a?b=1"] });
  });

  it("copies an email address without mailto: or its subject", () => {
    expect(use("mailto:anna%40x.org?subject=Hi")).toMatchObject({ labels: ["Open link", "Copy email address"], copied: ["anna@x.org"] });
    expect(use("mailto:bob@x.org").copied).toEqual(["bob@x.org"]);
  });

  it("copies a link to an email as it is", () => {
    expect(use("mid:a@x")).toEqual({ labels: ["Open email", "Copy link to email"], opened: ["mid:a@x"], copied: ["mid:a@x"] });
  });

  it("has nothing for no link", () => {
    expect(use("").labels).toEqual([]);
  });
});
