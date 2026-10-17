/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The header button's indicator: with notes, Thunderbird's own badge shows their number;
// with only plain highlights, a red dot is painted into the icon (the badge API has no
// number-less style); with neither, the plain icon. While sync isn't working (D35), the whole
// post-it turns red and unhappy (icons/icon-sad.svg): a corner mark was too easy to miss.

const RED = "#e03131";

const icons = new Map<string, Promise<HTMLImageElement>>();

function loadIcon(path: string): Promise<HTMLImageElement> {
  let icon = icons.get(path);
  if (!icon) {
    icon = new Promise((resolve, reject) => {
      const img = new Image(32, 32);
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("icon did not load"));
      img.src = messenger.runtime.getURL(path);
    });
    icons.set(path, icon);
  }
  return icon;
}

function withDot(img: HTMLImageElement, size: number): ImageData {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, size, size);
  const s = size / 32;
  ctx.fillStyle = RED;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(25 * s, 7 * s, 6 * s, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/** Sets the button's indicator in one tab; `warn`: sync isn't working (D35). */
export async function setCounters(tabId: number, notes: number, highlights: number, warn = false): Promise<void> {
  const action = messenger.messageDisplayAction;
  await action.setBadgeText({ tabId, text: notes ? String(notes) : "" });
  if (notes) await action.setBadgeBackgroundColor({ tabId, color: RED });
  const path = warn ? "icons/icon-sad.svg" : "icons/icon.svg";
  if (!notes && highlights) {
    const img = await loadIcon(path);
    await action.setIcon({ tabId, imageData: { 16: withDot(img, 16), 32: withDot(img, 32) } });
  } else {
    await action.setIcon({ tabId, path });
  }
}
