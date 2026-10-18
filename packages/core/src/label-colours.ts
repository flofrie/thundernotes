/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Label colours (D40): chosen per label, the same on all devices (synced in the settings
 * carrier, settings.ts). Kept apart from it so the display script can use them without the
 * carrier code (and the YAML it pulls in).
 */

import { colourOf, darker, rgba, type ColourName } from "./colours.js";

export interface LabelColour {
  /** A palette colour, or null: no colour (chosen, so it overrides an older colour elsewhere). */
  colour: ColourName | null;
  updated: string;
}

/** By label, lower case, without "#". */
export type LabelColours = Record<string, LabelColour>;

/** Both devices' choices: per label the newer one (on equal times the first). */
export function mergeLabelColours(a: LabelColours, b: LabelColours): LabelColours {
  const out: LabelColours = { ...a };
  for (const [label, choice] of Object.entries(b)) {
    const mine = out[label];
    if (!mine || choice.updated > mine.updated) out[label] = choice;
  }
  return out;
}

/** The same choices (order doesn't matter), for telling whether the server is up to date. */
export function sameLabelColours(a: LabelColours, b: LabelColours): boolean {
  const key = (c: LabelColours) => JSON.stringify(Object.entries(c).sort(([x], [y]) => x.localeCompare(y)));
  return key(a) === key(b);
}

/**
 * CSS for coloured labels: a tint of the colour and a border in a darker shade, the text as
 * it is (readable on the light tint, also on a coloured card). Applies to the chips in notes
 * (`.tn-label`), the editor (`.cm-tn-label`) and the task view (`.label-chip`), all of which
 * carry `data-label`.
 */
/** `scope`: a selector the rules apply within (a task row of one account, D42); none: everywhere. */
export function labelColourCss(colours: LabelColours, scope = ""): string {
  const rules: string[] = [];
  for (const [label, { colour }] of Object.entries(colours)) {
    if (!colour) continue;
    const c = colourOf(colour);
    const sel = `[data-label="${label.replace(/["\\]/g, "\\$&")}"]`;
    rules.push(
      // One class more than the chips' own rules (the editor's theme comes later in the cascade).
      [`.tn-chip.tn-label${sel}`, `.cm-tn-chip.cm-tn-label${sel}`, `.label-chip.label-chip${sel}`].map((s) => (scope ? `${scope} ${s}` : s)).join(", ") +
        ` { background: ${rgba(c, 0.3)}; border-color: ${darker(c)}; }`
    );
  }
  return rules.join("\n");
}

