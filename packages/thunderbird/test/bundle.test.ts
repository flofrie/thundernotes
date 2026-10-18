/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// D22: the message display script stays small. The Markdown parser (markdown-it) runs in the
// background; the display script reads what the renderer marked (checkbox lines, @ dates).

import * as esbuild from "esbuild";
import { describe, expect, it } from "vitest";

describe("message display script", () => {
  it("doesn't bundle the Markdown parser", async () => {
    const r = await esbuild.build({ entryPoints: ["src/content.ts"], bundle: true, write: false, format: "iife", target: "firefox128", minify: true, metafile: true, logLevel: "silent" });
    const inputs = Object.keys(Object.values(r.metafile.outputs)[0]!.inputs);
    expect(inputs.filter((p) => /markdown-it|linkify-it|markdown-structure/.test(p))).toEqual([]);
    expect(r.outputFiles[0]!.contents.length).toBeLessThan(120 * 1024);
  }, 30_000);
});
