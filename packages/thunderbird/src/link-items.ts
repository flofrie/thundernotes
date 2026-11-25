/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The entries for a link in a highlight's right-click menu: open it and copy it (as Thunderbird's
// own menu offers on a link, which ours replaces on highlights).

import type { MenuItem } from "./edit-menu.js";

/** "Open …" and "Copy …" for `href`; an email address is copied without "mailto:". */
export function linkItems(href: string, open: (url: string) => void, copy: (text: string) => void): MenuItem[] {
  if (!href) return [];
  if (/^mid:/i.test(href)) {
    return [
      { label: "Open email", run: () => open(href) },
      { label: "Copy link to email", run: () => copy(href) },
    ];
  }
  const mailto = /^mailto:([^?]*)/i.exec(href);
  if (mailto) {
    let address = mailto[1]!;
    try {
      address = decodeURIComponent(address);
    } catch {
      // kept as written
    }
    return [
      { label: "Open link", run: () => open(href) },
      { label: "Copy email address", run: () => copy(address) },
    ];
  }
  return [
    { label: "Open link", run: () => open(href) },
    { label: "Copy link", run: () => copy(href) },
  ];
}
