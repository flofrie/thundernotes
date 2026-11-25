/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Pins "today" to the day the sample notes were written for, so groups like Overdue and
// Next 7 days come out the same whenever the screenshots are taken. The clock still runs.
(function () {
  const RealDate = Date;
  const shift = new RealDate("2026-11-13T10:00:00").getTime() - RealDate.now();
  class PinnedDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(RealDate.now() + shift); }
    static now() { return RealDate.now() + shift; }
  }
  window.Date = PinnedDate;
})();
