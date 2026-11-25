/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Plays a few pieces so the screenshot shows a game in progress.
(function () {
  const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k === " " ? "Space" : k, bubbles: true }));
  const up = (k) => document.dispatchEvent(new KeyboardEvent("keyup", { key: k, code: k === " " ? "Space" : k, bubbles: true }));
  const tap = (k) => { key(k); up(k); };
  // Per piece: rotations, then shifts (negative: left), then a hard drop.
  const plan = [[0,-4],[0,4],[1,-2],[0,1],[2,3],[0,-1],[1,-5],[0,2],[1,4],[0,-3],[2,0],[3,5],[0,-2]];
  let t = 400;
  setTimeout(() => tap(" "), t);
  for (const [rot, shift] of plan) {
    t += 260;
    setTimeout(() => {
      for (let i = 0; i < rot; i++) tap("ArrowUp");
      for (let i = 0; i < Math.abs(shift); i++) tap(shift < 0 ? "ArrowLeft" : "ArrowRight");
      tap(" ");
    }, t);
  }
  setTimeout(() => tap("ArrowLeft"), t + 900);
})();
