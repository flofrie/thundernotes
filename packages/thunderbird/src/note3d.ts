/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The settings page's header: the ThunderNotes post-it in 3D (plain WebGL, no library). A sheet
// with some thickness and its corner folded over, lit from the upper left. It sways a little,
// leans towards the mouse pointer, blinks now and then, and flips over when clicked. A right-click
// pokes it instead of opening the page's menu: briefly angry (red, frowning, a jolt). A
// double-click makes it envious for a moment (green, a sideways glance, a crooked mouth).
// Poked again and again while still angry, it cracks and bursts into little post-it blocks: the
// way into the hidden Tetris (an Easter egg, D49). Still with "reduce motion" (the colour and the
// face change all the same, no blocks fly); without WebGL the flat icon stays.

import { colourOf, darker, rgba } from "@thundernotes/core";

// ---- geometry ---------------------------------------------------------------------------------

/** The sheet spans -1…1; the corner cut off at the bottom right (as in icons/icon.svg: 7 of 25). */
const CUT = 0.56;
const HALF_THICK = 0.035;
/** How far the corner is folded over: 180° would lie flat on the sheet; a little less stands up. */
const FOLD_ANGLE = (150 * Math.PI) / 180;

type Vec3 = [number, number, number];

/** The sheet's outline, counter-clockwise from the top left (convex: a fan triangulates it). */
export const OUTLINE: [number, number][] = [
  [-1, 1],
  [-1, -1],
  [1 - CUT, -1],
  [1, -1 + CUT],
  [1, 1],
];

/** Rotates `p` about the line through `a` and `b` by `angle` (Rodrigues' formula). */
export function rotateAbout(p: Vec3, a: Vec3, b: Vec3, angle: number): Vec3 {
  const k = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(k[0]!, k[1]!, k[2]!);
  const [kx, ky, kz] = [k[0]! / len, k[1]! / len, k[2]! / len];
  const v = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = kx * v[0]! + ky * v[1]! + kz * v[2]!;
  const cross = [ky * v[2]! - kz * v[1]!, kz * v[0]! - kx * v[2]!, kx * v[1]! - ky * v[0]!];
  return [
    a[0] + v[0]! * cos + cross[0]! * sin + kx * dot * (1 - cos),
    a[1] + v[1]! * cos + cross[1]! * sin + ky * dot * (1 - cos),
    a[2] + v[2]! * cos + cross[2]! * sin + kz * dot * (1 - cos),
  ];
}

/** The folded corner: the cut-off triangle turned over the cut, standing a little off the sheet. */
export function foldedCorner(): [Vec3, Vec3, Vec3] {
  const a: Vec3 = [1, -1 + CUT, HALF_THICK];
  const b: Vec3 = [1 - CUT, -1, HALF_THICK];
  // Turned towards the viewer (+z): about the cut from a to b, the corner comes up over the sheet.
  return [a, b, rotateAbout([1, -1, HALF_THICK], a, b, FOLD_ANGLE)];
}

/** Vertex data: position (3), normal (3), texture coordinate (2), material (1). */
const STRIDE = 9;
const FRONT = 0;
const BACK = 1;
const FOLD = 2;
const EDGE = 3;
const SHADOW = 4;

function normalOf(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const len = Math.hypot(...n) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/** All triangles of the note and its shadow, as interleaved vertex data. */
export function buildMesh(): Float32Array {
  const out: number[] = [];
  const uv = (x: number, y: number) => [(x + 1) / 2, (1 - y) / 2];
  const tri = (a: Vec3, b: Vec3, c: Vec3, material: number, n = normalOf(a, b, c)) => {
    for (const p of [a, b, c]) out.push(...p, ...n, ...uv(p[0], p[1]), material);
  };
  const ring = OUTLINE.map(([x, y]) => [x, y] as const);
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    tri([0, 0, HALF_THICK], [x1, y1, HALF_THICK], [x2, y2, HALF_THICK], FRONT, [0, 0, 1]);
    tri([0, 0, -HALF_THICK], [x2, y2, -HALF_THICK], [x1, y1, -HALF_THICK], BACK, [0, 0, -1]);
    // The edge: outward, from the outline's direction (counter-clockwise: outward is to the right).
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n: Vec3 = [(y2 - y1) / len, -(x2 - x1) / len, 0];
    tri([x1, y1, HALF_THICK], [x1, y1, -HALF_THICK], [x2, y2, -HALF_THICK], EDGE, n);
    tri([x1, y1, HALF_THICK], [x2, y2, -HALF_THICK], [x2, y2, HALF_THICK], EDGE, n);
  }
  const [a, b, c] = foldedCorner();
  const lift = (p: Vec3): Vec3 => [p[0], p[1], p[2] + 0.004]; // never fighting the sheet for depth
  tri(lift(b), lift(a), lift(c), FOLD);
  // A soft shadow below, facing the viewer (a level one would be seen edge-on): its texture
  // coordinates run -1…1 for a round fade.
  const s = 1.15;
  const y = -1.42;
  const h = 0.16;
  const corners: Vec3[] = [[-s, y - h, -0.4], [s, y - h, -0.4], [s, y + h, -0.4], [-s, y + h, -0.4]];
  const shadow = (p: Vec3, i: number) => out.push(...p, 0, 1, 0, i === 0 || i === 3 ? -1 : 1, i < 2 ? -1 : 1, SHADOW);
  [0, 1, 2, 0, 2, 3].forEach((i) => shadow(corners[i]!, i));
  return new Float32Array(out);
}

// ---- matrices (column-major, as WebGL takes them) ----------------------------------------------

type Mat4 = Float32Array;

function multiply(a: Mat4, b: Mat4): Mat4 {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      m[c * 4 + r] = s;
    }
  return m;
}

function perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fov / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function transform(rx: number, ry: number, rz: number, tx: number, ty: number, tz: number): Mat4 {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  // R = Ry · Rx · Rz, then translated.
  return new Float32Array([
    cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz, 0,
    -cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz, 0,
    sy * cx, -sx, cy * cx, 0,
    tx, ty, tz, 1,
  ]);
}

// ---- the face ----------------------------------------------------------------------------------

/** A mood's course: growing for `rise` ms, held until `hold`, gone by `end`. */
interface Mood {
  rise: number;
  hold: number;
  end: number;
}
/** A poke's anger. */
const ANGER: Mood = { rise: 450, hold: 1100, end: 1900 };
const RISE_MS = ANGER.rise;
const ANGRY_MS = ANGER.end;
/** A double-click's envy: a little slower, and longer (it sulks). */
const ENVY: Mood = { rise: 600, hold: 2200, end: 3000 };

/** Eased 0…1 (slow at both ends). */
const ease = (x: number) => x * x * (3 - 2 * x);

/** How strong a mood is (0…1) `ms` after it was set off: growing, held, then fading, all eased. */
function moodAt(mood: Mood, ms: number): number {
  if (ms < 0 || ms >= mood.end) return 0;
  if (ms < mood.rise) return ease(ms / mood.rise);
  if (ms < mood.hold) return 1;
  return 1 - ease((ms - mood.hold) / (mood.end - mood.hold));
}

/** How angry the note is (0…1) `ms` after a poke. */
export const angerAt = (ms: number) => moodAt(ANGER, ms);
/** How envious the note is (0…1) `ms` after a double-click. */
export const envyAt = (ms: number) => moodAt(ENVY, ms);

/**
 * When a mood set off again `since` ms after the last time, at `now`, counts as set off: from
 * calm, now; while it grows or holds, unchanged; while it fades, back into growing at the
 * strength it has, so it never jumps.
 */
function setOff(mood: Mood, since: number, now: number): number {
  if (since >= mood.end || since < 0) return now;
  if (since < mood.hold) return now - since;
  const strength = moodAt(mood, since);
  let ms = 0;
  while (ms < mood.rise && moodAt(mood, ms) < strength) ms += 5;
  return now - ms;
}

/** A poke `since` ms after the last one (setOff for anger). */
export const repoke = (since: number, now: number) => setOff(ANGER, since, now);
/** A double-click `since` ms after the last one (setOff for envy). */
export const reenvy = (since: number, now: number) => setOff(ENVY, since, now);

/** How long a click waits for a second one before it flips the note (a double-click: envy). */
export const DOUBLE_CLICK_MS = 300;

/**
 * Tells clicks from double-clicks: a click acts after `wait` ms unless a double-click came
 * (which the browser sends after the two clicks it is made of): then only the double-click acts.
 */
export function sortClicks(
  onClick: () => void,
  onDouble: () => void,
  wait = DOUBLE_CLICK_MS,
  timers: { set: (f: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (f, ms) => setTimeout(f, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): { click(): void; dblclick(): void } {
  let pending: unknown;
  return {
    click() {
      if (pending !== undefined) return; // the second click of a double-click
      pending = timers.set(() => {
        pending = undefined;
        onClick();
      }, wait);
    },
    dblclick() {
      if (pending !== undefined) timers.clear(pending);
      pending = undefined;
      onDouble();
    },
  };
}

/** `a` to `b` by `t`, per colour channel ("#rrggbb"). */
function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)).join(",")})`;
}

/** An "rgb(r,g,b)" (as mix gives) to "#rrggbb" `b` by `t`. */
function mixRgb(a: string, b: string, t: number): string {
  const [r, g, bl] = (a.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
  const hex = `#${[r, g, bl].map((v) => v!.toString(16).padStart(2, "0")).join("")}`;
  return mix(hex, b, t);
}

/** The sheet's colours, from yellow to angry red or envious green. */
const YELLOW = "#ffd43b";
const RED = "#ff5a4e";
const GREEN = "#a6d66e";

/** `a` to `b` by `t`. */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The face as in icons/icon.svg (eyes, smile) on yellow; `open` 0…1 for blinking, `anger` 0…1:
 * the sheet turns red, the smile becomes a frown, the brows come down; `envy` 0…1: it turns
 * green, the eyes glance sideways under lowered lids, the mouth goes small and crooked.
 */
function drawFace(ctx: CanvasRenderingContext2D, size: number, open: number, anger = 0, envy = 0, crack = 0): void {
  // The icon's sheet runs from 3.5 to 28.5: its coordinates scaled to the texture.
  const k = size / 25;
  const at = (v: number) => (v - 3.5) * k;
  const sheet = mix(YELLOW, RED, anger);
  ctx.fillStyle = envy ? mixRgb(sheet, GREEN, envy) : sheet;
  ctx.fillRect(0, 0, size, size);
  // A faint paper grain towards the top, where the sheet would come off the pad.
  const glow = ctx.createLinearGradient(0, 0, 0, size);
  glow.addColorStop(0, "#fff3a860");
  glow.addColorStop(0.35, "#ffffff00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  const angry = mix("#5c4300", "#4a0d0a", anger);
  const ink = envy ? mixRgb(angry, "#2d4a10", envy) : angry;
  ctx.fillStyle = ink;
  // Envy: the eyes look aside (to the left, as the head turns away to the right) and narrow.
  const aside = -1.3 * envy;
  const height = Math.max(0.25, 2 * open * (1 - 0.45 * envy));
  for (const x of [11.5, 20.5]) {
    ctx.beginPath();
    ctx.ellipse(at(x + aside), at(12.5 + 0.3 * envy), 2 * k, height * k, 0, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  if (envy > 0.05) {
    // Lowered lids: a flat line over each eye.
    ctx.lineWidth = 1.3 * k;
    ctx.globalAlpha = Math.min(1, envy * 1.5);
    ctx.beginPath();
    for (const x of [11.5, 20.5]) {
      ctx.moveTo(at(x - 2.6), at(11.4));
      ctx.lineTo(at(x + 2.6), at(11.0));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 2.4 * k;
  // The mouth: a smile (control point below the corners) turning into a frown (above them);
  // envious, a small crooked line pulled to one side.
  const corner = 17.5 + 2.5 * anger;
  const control = 24 - 10.5 * anger;
  ctx.beginPath();
  ctx.moveTo(at(lerp(9.5, 12, envy)), at(lerp(corner, 19.3, envy)));
  ctx.quadraticCurveTo(at(lerp(16, 16.5, envy)), at(lerp(control, 18.6, envy)), at(lerp(22.5, 19.8, envy)), at(lerp(corner, 17.8, envy)));
  ctx.stroke();
  if (anger > 0.05) {
    // Brows slanting down towards the middle.
    ctx.lineWidth = 1.8 * k;
    ctx.globalAlpha = Math.min(1, anger * 1.5);
    ctx.beginPath();
    ctx.moveTo(at(8.8), at(8.4));
    ctx.lineTo(at(13.6), at(10.2));
    ctx.moveTo(at(23.2), at(8.4));
    ctx.lineTo(at(18.4), at(10.2));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (crack > 0) {
    // Cracks spreading from the middle as it is about to burst.
    ctx.strokeStyle = "#3a0806";
    ctx.lineWidth = 0.9 * k;
    ctx.lineJoin = "round";
    for (const line of CRACKS) {
      ctx.beginPath();
      const n = Math.max(2, Math.ceil(line.length * crack));
      line.slice(0, n).forEach(([x, y], i) => (i ? ctx.lineTo(at(x), at(y)) : ctx.moveTo(at(x), at(y))));
      ctx.stroke();
    }
  }
}

/** The cracks' zigzags, in the icon's coordinates, from the middle outwards. */
const CRACKS: [number, number][][] = [
  [[16, 15], [13.5, 13], [14.5, 10.5], [11, 8], [10, 4]],
  [[16, 15], [18.5, 16.5], [21, 15], [24, 17.5], [28, 16]],
  [[16, 15], [15, 18.5], [17, 21], [14.5, 24], [15.5, 28]],
  [[16, 15], [19, 12], [21.5, 12.5], [23, 9], [26.5, 6]],
  [[16, 15], [12, 16], [9, 19.5], [5.5, 19], [4, 22]],
];

/** How cracked the face is (0…1) at `now`, cracking since `from` over `ms`; 0 when it isn't cracking. */
export function crackAt(now: number, from: number, ms: number): number {
  if (!Number.isFinite(from)) return 0;
  return Math.min(1, Math.max(0, (now - from) / ms));
}

/** Pokes in a row while still angry that make it burst (the Easter egg, D49). */
export const BURST_POKES = 5;

/** The pokes in a row after one more: counting on while it is still angry, from one when calm. */
export function pokeStreak(streak: number, stillAngry: boolean): number {
  return stillAngry ? streak + 1 : 1;
}

/** One block of the burst: where it starts (page px), how it flies (px/s), turns (rad/s), its colour. */
export interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  turn: number;
  spin: number;
  size: number;
  colour: string;
}

/** The burst's blocks: a grid over the note (`rect`), flying out from its middle and up, in the pieces' colours. */
export function burstShards(rect: { left: number; top: number; width: number; height: number }, random: () => number = Math.random): Shard[] {
  const colours = ["blue", "yellow", "purple", "green", "red", "pink", "orange"] as const;
  const per = 6;
  const size = Math.max(6, Math.round(rect.width / per));
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const out: Shard[] = [];
  for (let i = 0; i < per; i++)
    for (let j = 0; j < per; j++) {
      const x = rect.left + (i + 0.5) * (rect.width / per);
      const y = rect.top + (j + 0.5) * (rect.height / per);
      const speed = 260 + random() * 420;
      const angle = Math.atan2(y - cy, x - cx) + (random() - 0.5) * 0.9;
      // Out from the middle, and all pop up first (the downward push weakened), then fall.
      out.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.6 - 420 - random() * 260, turn: random() * Math.PI, spin: (random() - 0.5) * 14, size, colour: colours[Math.floor(random() * colours.length)]! });
    }
  return out;
}

/** How long the blocks fly before they are gone. */
const BURST_MS = 1400;

/** The blocks flying over the page from where the note was, then `done`. */
function burst(rect: DOMRect, done: () => void): void {
  const fly = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  fly.width = window.innerWidth * dpr;
  fly.height = window.innerHeight * dpr;
  fly.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;";
  document.body.append(fly);
  const ctx = fly.getContext("2d");
  if (!ctx) return (fly.remove(), done());
  ctx.scale(dpr, dpr);
  const shards = burstShards(rect);
  const start = performance.now();
  let last = start;
  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const age = now - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalAlpha = age > BURST_MS - 400 ? Math.max(0, (BURST_MS - age) / 400) : 1;
    for (const s of shards) {
      s.vy += 1900 * dt; // gravity
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.turn += s.spin * dt;
      const colour = colourOf(s.colour);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.turn);
      const h = s.size / 2;
      // A little post-it: its corner folded.
      ctx.beginPath();
      ctx.moveTo(-h, -h);
      ctx.lineTo(h, -h);
      ctx.lineTo(h, h * 0.4);
      ctx.lineTo(h * 0.4, h);
      ctx.lineTo(-h, h);
      ctx.closePath();
      ctx.fillStyle = rgba(colour, 1);
      ctx.fill();
      ctx.strokeStyle = darker(colour);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    if (age < BURST_MS) requestAnimationFrame(step);
    else (fly.remove(), done());
  };
  requestAnimationFrame(step);
}

// ---- rendering ---------------------------------------------------------------------------------

/** How far the note is from the eye. */
const DISTANCE = 4.6;

const VERTEX = `
  #define DISTANCE ${DISTANCE.toFixed(2)}
  attribute vec3 position; attribute vec3 normal; attribute vec2 uv; attribute float material;
  uniform mat4 model; uniform mat4 projection; uniform float shadowScale;
  varying vec3 vNormal; varying vec2 vUv; varying float vMaterial; varying vec3 vView;
  void main() {
    vec3 p = position;
    if (material > 3.5) p.x *= shadowScale; // the shadow: smaller as the note rises
    vec4 world = model * vec4(p, 1.0);
    if (material > 3.5) world = vec4(p.x, p.y, p.z - DISTANCE, 1.0); // the shadow doesn't turn with it
    vNormal = mat3(model) * normal; vUv = uv; vMaterial = material; vView = -world.xyz;
    gl_Position = projection * world;
  }`;

const FRAGMENT = `
  precision mediump float;
  uniform sampler2D face; uniform float shadowAlpha; uniform float anger; uniform float envy;
  varying vec3 vNormal; varying vec2 vUv; varying float vMaterial; varying vec3 vView;
  void main() {
    if (vMaterial > 3.5) {
      float d = length(vUv);
      gl_FragColor = vec4(0.0, 0.0, 0.0, shadowAlpha * smoothstep(1.0, 0.0, d));
      return;
    }
    vec3 n = normalize(vNormal);
    vec3 view = normalize(vView);
    if (dot(n, view) < 0.0) n = -n; // seen from behind: lit as its other side
    vec3 base = vMaterial < 0.5 ? texture2D(face, vUv).rgb
              : vMaterial < 1.5 ? vec3(0.98, 0.86, 0.40)
              : vMaterial < 2.5 ? vec3(1.0, 0.80, 0.16)
              : vec3(0.88, 0.69, 0.14);
    if (vMaterial > 0.5) base = mix(base, base * vec3(1.0, 0.42, 0.36) + vec3(0.06, 0.0, 0.0), anger);
    if (vMaterial > 0.5) base = mix(base, base * vec3(0.66, 1.0, 0.58) + vec3(0.0, 0.03, 0.0), envy);
    // From the front, a little above: turned left or right it looks alike.
    vec3 light = normalize(vec3(0.0, 0.45, 1.0));
    float diffuse = max(dot(n, light), 0.0);
    float specular = pow(max(dot(n, normalize(light + view)), 0.0), 40.0) * 0.08;
    // Mostly ambient: the sheet keeps the icon's bright yellow, the light only models it.
    gl_FragColor = vec4(min(base * (0.78 + 0.26 * diffuse) + specular, 1.0), 1.0);
  }`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  return shader;
}

/** Turn towards the pointer at most this far (radians): sideways, and up or down. */
const LEAN_SIDE = 0.6;
const LEAN_UP = 0.45;

/**
 * How far to turn towards a pointer at (x, y): -1…1 each way, measured against the room on that
 * side of the note (it sits near the page's top left: against the whole window, the pointer was
 * nearly always to its right and below it, so it hardly ever turned left or up). Lit from the
 * front, so it looks alike turned either way.
 */
export function leanToward(x: number, y: number, centre: { x: number; y: number }, view: { width: number; height: number }): { x: number; y: number } {
  const side = (at: number, mid: number, size: number) => {
    const room = at < mid ? mid : size - mid;
    return room > 0 ? Math.max(-1, Math.min(1, (at - mid) / room)) : 0;
  };
  return { x: side(x, centre.x, view.width), y: side(y, centre.y, view.height) };
}

/** How long one flip takes, ms. */
const FLIP_MS = 900;

/**
 * Puts the 3D note in place of `img` (the flat icon), `size` CSS pixels square. Returns false,
 * leaving the icon, where WebGL isn't available. `onBurst`: called when it bursts (poked
 * BURST_POKES times in a row while angry), as its blocks fly.
 */
export function mountNote3d(img: HTMLElement, size = 64, onBurst?: () => void): boolean {
  const canvas = document.createElement("canvas");
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: false, alpha: true });
  } catch {
    gl = null;
  }
  if (!gl) return false;
  let program: WebGLProgram;
  try {
    program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  } catch {
    return false;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = canvas.height = Math.round(size * dpr);
  canvas.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;margin:-12px -4px -12px -10px;`;
  canvas.title = "ThunderNotes";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "ThunderNotes");
  img.replaceWith(canvas);

  gl.useProgram(program);
  const mesh = buildMesh();
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  const attribute = (name: string, count: number, offset: number) => {
    const at = gl!.getAttribLocation(program, name);
    gl!.enableVertexAttribArray(at);
    gl!.vertexAttribPointer(at, count, gl!.FLOAT, false, STRIDE * 4, offset * 4);
  };
  attribute("position", 3, 0);
  attribute("normal", 3, 3);
  attribute("uv", 2, 6);
  attribute("material", 1, 8);
  const uniform = (name: string) => gl!.getUniformLocation(program, name);

  // The face texture, redrawn when blinking.
  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = faceCanvas.height = 256;
  const faceCtx = faceCanvas.getContext("2d");
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let drawn = { open: -1, anger: -1, envy: -1, crack: -1 };
  const face = (open: number, anger: number, envy: number, crack = 0) => {
    if (!faceCtx || (Math.abs(open - drawn.open) < 0.05 && Math.abs(anger - drawn.anger) < 0.02 && Math.abs(envy - drawn.envy) < 0.02 && Math.abs(crack - drawn.crack) < 0.05)) return;
    drawn = { open, anger, envy, crack };
    drawFace(faceCtx, 256, open, anger, envy, crack);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, faceCanvas);
  };
  face(1, 0, 0);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniformMatrix4fv(uniform("projection"), false, perspective(0.62, 1, 0.1, 20));
  const modelAt = uniform("model");
  const shadowScaleAt = uniform("shadowScale");
  const shadowAlphaAt = uniform("shadowAlpha");
  const angerUniform = uniform("anger");
  const envyUniform = uniform("envy");

  // Leaning towards the pointer, eased.
  let lean = { x: 0, y: 0 };
  let target = { x: 0, y: 0 };
  window.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const toward = leanToward(e.clientX, e.clientY, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, { width: window.innerWidth, height: window.innerHeight });
    target = { x: toward.y * LEAN_UP, y: toward.x * LEAN_SIDE };
  });
  let flipFrom = -Infinity;
  let pokedAt = -Infinity;
  let enviedAt = -Infinity;
  // The Easter egg (D49): pokes in a row while angry; at BURST_POKES it cracks, then bursts.
  let streak = 0;
  let crackFrom = -Infinity;
  let bursting = false;
  const CRACK_MS = 350;
  let running = false;
  const kick = () => {
    if (running) return;
    running = true;
    requestAnimationFrame(draw);
  };
  // A click flips it, a double-click makes it envious; the click waits a moment to tell them apart.
  const clicks = sortClicks(
    () => {
      flipFrom = performance.now();
      kick();
    },
    () => {
      const now = performance.now();
      enviedAt = reenvy(now - enviedAt, now);
      kick();
    },
  );
  canvas.addEventListener("click", () => clicks.click());
  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault(); // no text selection around it
    clicks.dblclick();
  });
  // Right-click: a poke, not the page's long menu (nothing in it is about the note). Caught on
  // the way down (capture) and stopped there, so no other listener can bring the menu back.
  window.addEventListener(
    "contextmenu",
    (e) => {
      if (e.target !== canvas) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const now = performance.now();
      if (bursting) return;
      streak = pokeStreak(streak, angerAt(now - pokedAt) > 0);
      pokedAt = repoke(now - pokedAt, now);
      kick();
      if (streak >= BURST_POKES && onBurst) {
        bursting = true;
        crackFrom = now;
        setTimeout(() => {
          const back = () => {
            // Back, calm and whole, a moment later.
            streak = 0;
            crackFrom = -Infinity;
            pokedAt = -Infinity;
            canvas.style.visibility = "";
            bursting = false;
            kick();
          };
          if (still) {
            onBurst();
            setTimeout(back, 800);
            return;
          }
          const rect = canvas.getBoundingClientRect();
          canvas.style.visibility = "hidden";
          burst(rect, () => setTimeout(back, 600));
          setTimeout(onBurst, 450); // the game opens while the blocks fall
        }, CRACK_MS);
      }
    },
    true,
  );

  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const start = performance.now();
  const draw = (now: number) => {
    const t = (now - start) / 1000;
    const moving = !still;
    lean = { x: lean.x + (target.x - lean.x) * 0.08, y: lean.y + (target.y - lean.y) * 0.08 };
    const sway = moving ? Math.sin(t * 0.7) * 0.14 : 0;
    const bob = moving ? Math.sin(t * 1.3) * 0.06 : 0;
    // A flip: one turn about the vertical axis, easing in and out, with a little hop.
    const f = Math.min(1, Math.max(0, (now - flipFrom) / FLIP_MS));
    const flip = f < 1 ? (1 - Math.cos(f * Math.PI)) * Math.PI : 0;
    const hop = f < 1 ? Math.sin(f * Math.PI) * 0.25 : 0;
    // Poked: angry for a moment; it jerks back and shakes (not with "reduce motion").
    const since = now - pokedAt;
    const anger = angerAt(since);
    // A small jolt as the anger rises.
    const shake = moving && since < RISE_MS ? Math.sin(since / 30) * 0.06 * (1 - since / RISE_MS) : 0;
    const recoil = moving ? anger * 0.35 : 0;
    // Double-clicked: envious for a moment; it turns its head away, glancing back sideways.
    const envious = now - enviedAt;
    const envy = envyAt(envious);
    // Blinking: every few seconds, quickly (not while angry or envious: it glares, or sulks).
    const phase = t % 4.2;
    const crack = crackAt(now, crackFrom, CRACK_MS);
    face(moving && !anger && !envy && phase < 0.16 ? Math.abs(phase - 0.08) / 0.08 : 1, anger, envy, crack);
    gl!.uniform1f(angerUniform, anger);
    gl!.uniform1f(envyUniform, envy);
    const turnAway = moving ? envy * 0.5 : 0;

    const rise = bob + hop;
    gl!.uniformMatrix4fv(modelAt, false, transform(-0.12 + (moving ? lean.x : 0), sway + (moving ? lean.y : 0) + flip + turnAway, -0.06 + (moving ? Math.sin(t * 0.9) * 0.04 : 0) + shake, 0, 0.1 + rise, -DISTANCE - recoil));
    gl!.uniform1f(shadowScaleAt, 1 - rise * 0.5);
    gl!.uniform1f(shadowAlphaAt, 0.28 - rise * 0.3);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    gl!.drawArrays(gl!.TRIANGLES, 0, mesh.length / STRIDE);
    // Still ("reduce motion"): drawn only while a flip, a poke or envy lasts (the user's own request).
    if (moving || f < 1 || since < ANGRY_MS || envious < ENVY.end || bursting) requestAnimationFrame(draw);
    else running = false;
  };
  kick();
  return true;
}
