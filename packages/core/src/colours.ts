/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Highlight colours (D29): a palette of named colours, stored by name. Each has a base
 * colour and an opacity (highlights stay slightly see-through). Text contrast follows the
 * WCAG contrast ratio: black or white, whichever contrasts more with the effective colour;
 * the strong colours (orange, red, purple, grey) always take white text, which reads better there.
 */

export const COLOUR_NAMES = ["yellow", "green", "blue", "pink", "orange", "red", "purple", "grey"] as const;
export type ColourName = (typeof COLOUR_NAMES)[number];
export const DEFAULT_COLOUR: ColourName = "yellow";

export interface Colour {
  name: ColourName;
  label: string;
  hex: string;
  /** Opacity of the highlight: light colours lower, strong ones higher. */
  alpha: number;
  /** Always white text: chosen by eye, where WCAG 2's ratio favours black (D29). */
  whiteText?: true;
}

// Light, like sticky notes: yellow close to a classic Post-it (#feff9c); the others shifted
// lighter by the same factor. By the WCAG ratio black text would win on every colour, but on the
// strong ones white reads better (WCAG 2 is known to favour black on mid tones), so they say so.
export const COLOURS: Record<ColourName, Colour> = {
  yellow: { name: "yellow", label: "Yellow", hex: "#fff04a", alpha: 0.6 },
  green: { name: "green", label: "Green", hex: "#69db7c", alpha: 0.32 },
  blue: { name: "blue", label: "Blue", hex: "#74c0fc", alpha: 0.32 },
  pink: { name: "pink", label: "Pink", hex: "#f783ac", alpha: 0.32 },
  orange: { name: "orange", label: "Orange", hex: "#f76707", alpha: 0.61, whiteText: true },
  red: { name: "red", label: "Red", hex: "#b72323", alpha: 0.61, whiteText: true },
  purple: { name: "purple", label: "Purple", hex: "#6741d9", alpha: 0.61, whiteText: true },
  grey: { name: "grey", label: "Grey", hex: "#495057", alpha: 0.61, whiteText: true },
};

/** The palette colour for a stored name; unknown or missing names fall back to yellow. */
export function colourOf(name: string | undefined | null): Colour {
  return COLOURS[(name ?? "") as ColourName] ?? COLOURS[DEFAULT_COLOUR];
}

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** The colour as seen over a background (opacity blended), as #rrggbb. */
export function effective(colour: Colour, background = "#ffffff", alpha = colour.alpha): string {
  const [r, g, b] = rgb(colour.hex);
  const [R, G, B] = rgb(background);
  return toHex([r * alpha + R * (1 - alpha), g * alpha + G * (1 - alpha), b * alpha + B * (1 - alpha)]);
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** White for the strong colours; else black or white text, whichever contrasts more with the colour over `background`. */
export function textOn(colour: Colour, background = "#ffffff", alpha = colour.alpha): "#000000" | "#ffffff" {
  if (colour.whiteText) return "#ffffff";
  const bg = effective(colour, background, alpha);
  return contrast(bg, "#000000") >= contrast(bg, "#ffffff") ? "#000000" : "#ffffff";
}

/** CSS rgba() of the colour at its (or a given) opacity. */
export function rgba(colour: Colour, alpha = colour.alpha): string {
  const [r, g, b] = rgb(colour.hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A darker shade for frames and borders. */
export function darker(colour: Colour, amount = 0.3): string {
  return effective({ ...colour, hex: "#000000" }, colour.hex, amount);
}
