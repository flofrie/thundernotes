/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { deletedState } from "../src/deleted.js";

const inFolder = (...specialUse: string[]) => ({ folder: { specialUse } });

describe("deleted emails are ignored (D43)", () => {
  it("is deleted when every copy in the account is in the Trash", () => {
    expect(deletedState([inFolder("trash")])).toBe("trash");
    expect(deletedState([inFolder("trash"), inFolder("trash")])).toBe("trash");
  });
  it("isn't while a copy is anywhere else (the Sent copy, the inbox)", () => {
    expect(deletedState([inFolder("trash"), inFolder("sent")])).toBeNull();
    expect(deletedState([inFolder()])).toBeNull();
  });
  it("takes no copy found as deleted only right after a deletion for good; otherwise as missing (shown, marked)", () => {
    expect(deletedState([])).toBe("missing");
    expect(deletedState([], true)).toBe("deleted");
  });
});
