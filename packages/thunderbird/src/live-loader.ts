/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Loads the live-preview editor (D28) on first use. A plain extension file can't be imported
// from a message display script; dist/live-editor.js is listed in web_accessible_resources
// (spike spikes/lazy-editor: ~40 ms for ~300 KB).

import type * as LiveModule from "./live/editor.js";

export type Live = typeof LiveModule;

let loading: Promise<Live> | null = null;

export function loadLiveEditor(): Promise<Live> {
  if (!loading) {
    const url = browser.runtime.getURL("dist/live-editor.js");
    loading = (import(url) as Promise<Live>).catch((e) => {
      loading = null; // try again next time
      throw e;
    });
  }
  return loading;
}
