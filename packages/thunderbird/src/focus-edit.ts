/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Opening a note for editing from outside the email (the task view, the popup's "Note on this
 * email"). The editor only starts in a focused message pane, and Thunderbird gives the focus
 * elsewhere (the tab, or back from the closing popup). So: open the card, have the pane focused
 * (`focusPane`, an Experiment call through the background), then open it again, now in a
 * focused editor. `wait`: time for a closing popup to release the focus first.
 */
export function openForEditing(open: () => boolean, focusPane: () => Promise<unknown>, wait = 0): boolean {
  if (!open()) return false;
  const again = () => void focusPane().then(open, open);
  if (wait) setTimeout(again, wait);
  else again();
  return true;
}
