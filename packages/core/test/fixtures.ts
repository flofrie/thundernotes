/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The highlight spike's test emails (spikes/highlight-anchor/testmails.js) and
// approximations of how Thunderbird shows them in each body view. The view
// approximations follow what the spike observed (spike README, run 2):
// Simple HTML drops styles (hidden text shows); Plain Text prints bullets as `*`,
// <b> as *bold*, <em>/<i> as /italic/, links as `text <url>`.

export const plainA = `Hello Florian,

This is a plain-text test message for the highlight spike. Its lines are
hard-wrapped at about seventy characters, so a sentence that spans a line
break must still anchor after the view changes.

Visit https://example.com/some/path?x=1 for details. Umlauts: Grüße aus
München, Straße, Öl.

- first list item
- second list item with *emphasis* and _underline_

The word anchor appears twice: anchor here, and anchor there.

On 14.10.2026 Someone wrote:
> Quoted line one of the earlier message.
> Quoted line two, with a > sign inside.
>> Doubly quoted line.

--
Signature line`;

export const htmlB = `<html><body>
<p>Hello Florian,</p>
<p>This is an <b>HTML-only</b> test message. A word split by markup: Hig<b>hl</b>ight<i>ing</i>.
Non-breaking&nbsp;spaces&nbsp;here.</p>
<ul><li>first list item</li><li>second list item with <em>emphasis</em></li></ul>
<table border="1"><tr><td>Cell one</td><td>Cell two</td></tr><tr><td>Cell three</td><td>Cell four</td></tr></table>
<p>Link: <a href="https://example.com/some/path?x=1">example link text</a>. Umlauts: Grüße aus München.</p>
<p>The word anchor appears twice: anchor here, and anchor there.</p>
<blockquote type="cite"><p>Quoted paragraph from an earlier message.</p></blockquote>
<div style="display:none">Hidden preheader text that should not count.</div>
<p>Soft&shy;hyphen and zero&#8203;width test.</p>
</body></html>`;

/** Simple HTML: the sanitiser drops style attributes, so hidden text shows. */
export const htmlBSimple = htmlB.replace(' style="display:none"', "");

/** Plain Text view of B (Thunderbird's HTML-to-text conversion, approximated). */
export const plainBView = `Hello Florian,

This is an *HTML-only* test message. A word split by markup: Hig*hl*ight/ing/.
Non-breaking spaces here.

  * first list item
  * second list item with /emphasis/

Cell one\tCell two
Cell three\tCell four

Link: example link text <https://example.com/some/path?x=1>. Umlauts: Grüße
aus München.

The word anchor appears twice: anchor here, and anchor there.

> Quoted paragraph from an earlier message.

Hidden preheader text that should not count.

Soft­hyphen and zero​width test.`;

export const htmlD = `<html><head><style>
.pre { display:none; max-height:0; overflow:hidden; } td { font-family: Arial; }
</style></head><body>
<span class="pre">Preheader: this week's top stories, hidden in the inbox preview.</span>
<table width="100%"><tr><td align="center">
  <table width="600"><tr><td>
    <img src="https://example.invalid/logo.png" alt="Example Weekly logo">
    <h1>Example Weekly</h1>
  </td></tr>
  <tr><td>
    <h2>Story one: anchoring in layout tables</h2>
    <p>Newsletters nest content in tables. This sentence sits three tables deep and should still anchor.</p>
    <a class="btn" href="https://example.com/read">Read more</a>
  </td></tr>
  <tr><td><table><tr>
    <td width="50%"><h3>Left column</h3><p>Text in the left column.</p></td>
    <td width="50%"><h3>Right column</h3><p>Text in the right column.</p></td>
  </tr></table></td></tr>
  <tr><td style="font-size:11px;color:#888">You receive this because you subscribed. <a href="https://example.com/unsub">Unsubscribe</a></td></tr>
  </table>
</td></tr></table>
</body></html>`;

/** Plain Text view of D, approximated: preheader shows, links get their URL. */
export const plainDView = `Preheader: this week's top stories, hidden in the inbox preview.

Example Weekly

Story one: anchoring in layout tables

Newsletters nest content in tables. This sentence sits three tables deep and
should still anchor.

Read more <https://example.com/read>

Left column

Text in the left column.

Right column

Text in the right column.

You receive this because you subscribed. Unsubscribe
<https://example.com/unsub>`;
