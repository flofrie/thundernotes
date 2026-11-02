/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The release's two manifests (manifest-variants.mjs, D41): ATN's with the highest Thunderbird
// version, GitHub's without, otherwise the same.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs build script without types
import { maxVersion, withoutMaxVersion } from "../manifest-variants.mjs";

const manifest = readFileSync(new URL("../manifest.json", `file://${__filename}`), "utf8");

describe("the GitHub release's manifest", () => {
  it("has no highest Thunderbird version, and is otherwise the committed one", () => {
    const github = withoutMaxVersion(manifest);
    expect(maxVersion(manifest)).toMatch(/^\d+\.\*$/);
    expect(maxVersion(github)).toBeNull();
    const parsed = JSON.parse(github);
    const committed = JSON.parse(manifest);
    delete committed.browser_specific_settings.gecko.strict_max_version;
    expect(parsed).toEqual(committed);
    expect(parsed.browser_specific_settings.gecko.strict_min_version).toBe("153.0"); // the minimum stays
  });

  it("refuses a manifest without a highest version to remove", () => {
    expect(() => withoutMaxVersion('{ "a": 1 }')).toThrow();
  });
});
