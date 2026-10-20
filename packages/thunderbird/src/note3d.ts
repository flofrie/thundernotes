/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The settings page's header: the ThunderNotes post-it in 3D (plain WebGL, no library). A sheet
// with some thickness and its corner folded over, lit from the upper left. It sways a little,
// leans towards the mouse pointer, blinks now and then, and flips over when clicked. A right-click
// pokes it instead of opening the page's menu: briefly angry (red, frowning, a jolt). Still with
// "reduce motion" (the colour and the face change all the same); without WebGL the flat icon stays.

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

/** A poke's anger: growing for RISE_MS, held until HOLD_MS, gone by ANGRY_MS. */
const RISE_MS = 450;
const HOLD_MS = 1100;
const ANGRY_MS = 1900;

/** Eased 0…1 (slow at both ends). */
const ease = (x: number) => x * x * (3 - 2 * x);

/** How angry the note is (0…1) `ms` after a poke: growing, held, then calming down, all eased. */
export function angerAt(ms: number): number {
  if (ms < 0 || ms >= ANGRY_MS) return 0;
  if (ms < RISE_MS) return ease(ms / RISE_MS);
  if (ms < HOLD_MS) return 1;
  return 1 - ease((ms - HOLD_MS) / (ANGRY_MS - HOLD_MS));
}

/**
 * The poke time for a poke `since` ms after the last one, at `now`: from calm, now; while the
 * anger grows or holds, unchanged; while it fades, back into growing at the anger it has, so it
 * never jumps.
 */
export function repoke(since: number, now: number): number {
  if (since >= ANGRY_MS || since < 0) return now;
  if (since < HOLD_MS) return now - since;
  const anger = angerAt(since);
  let ms = 0;
  while (ms < RISE_MS && angerAt(ms) < anger) ms += 5;
  return now - ms;
}

/** `a` to `b` by `t`, per colour channel ("#rrggbb"). */
function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)).join(",")})`;
}

/** The sheet's colours, from yellow to angry red. */
const YELLOW = "#ffd43b";
const RED = "#ff5a4e";

/**
 * The face as in icons/icon.svg (eyes, smile) on yellow; `open` 0…1 for blinking, `anger` 0…1:
 * the sheet turns red, the smile becomes a frown, the brows come down.
 */
function drawFace(ctx: CanvasRenderingContext2D, size: number, open: number, anger = 0): void {
  // The icon's sheet runs from 3.5 to 28.5: its coordinates scaled to the texture.
  const k = size / 25;
  const at = (v: number) => (v - 3.5) * k;
  ctx.fillStyle = mix(YELLOW, RED, anger);
  ctx.fillRect(0, 0, size, size);
  // A faint paper grain towards the top, where the sheet would come off the pad.
  const glow = ctx.createLinearGradient(0, 0, 0, size);
  glow.addColorStop(0, "#fff3a860");
  glow.addColorStop(0.35, "#ffffff00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  const ink = mix("#5c4300", "#4a0d0a", anger);
  ctx.fillStyle = ink;
  for (const x of [11.5, 20.5]) {
    ctx.beginPath();
    ctx.ellipse(at(x), at(12.5), 2 * k, Math.max(0.25, 2 * open) * k, 0, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.4 * k;
  ctx.lineCap = "round";
  // The mouth: a smile (control point below the corners) turning into a frown (above them).
  const corner = 17.5 + 2.5 * anger;
  ctx.beginPath();
  ctx.moveTo(at(9.5), at(corner));
  ctx.quadraticCurveTo(at(16), at(24 - 10.5 * anger), at(22.5), at(corner));
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
  uniform sampler2D face; uniform float shadowAlpha; uniform float anger;
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
 * leaving the icon, where WebGL isn't available.
 */
export function mountNote3d(img: HTMLElement, size = 64): boolean {
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
  let drawn = { open: -1, anger: -1 };
  const face = (open: number, anger: number) => {
    if (!faceCtx || (Math.abs(open - drawn.open) < 0.05 && Math.abs(anger - drawn.anger) < 0.02)) return;
    drawn = { open, anger };
    drawFace(faceCtx, 256, open, anger);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, faceCanvas);
  };
  face(1, 0);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniformMatrix4fv(uniform("projection"), false, perspective(0.62, 1, 0.1, 20));
  const modelAt = uniform("model");
  const shadowScaleAt = uniform("shadowScale");
  const shadowAlphaAt = uniform("shadowAlpha");
  const angerUniform = uniform("anger");

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
  let running = false;
  const kick = () => {
    if (running) return;
    running = true;
    requestAnimationFrame(draw);
  };
  canvas.addEventListener("click", () => {
    flipFrom = performance.now();
    kick();
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
      pokedAt = repoke(now - pokedAt, now);
      kick();
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
    // Blinking: every few seconds, quickly (not while angry: it glares).
    const phase = t % 4.2;
    face(moving && !anger && phase < 0.16 ? Math.abs(phase - 0.08) / 0.08 : 1, anger);
    gl!.uniform1f(angerUniform, anger);

    const rise = bob + hop;
    gl!.uniformMatrix4fv(modelAt, false, transform(-0.12 + (moving ? lean.x : 0), sway + (moving ? lean.y : 0) + flip, -0.06 + (moving ? Math.sin(t * 0.9) * 0.04 : 0) + shake, 0, 0.1 + rise, -DISTANCE - recoil));
    gl!.uniform1f(shadowScaleAt, 1 - rise * 0.5);
    gl!.uniform1f(shadowAlphaAt, 0.28 - rise * 0.3);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    gl!.drawArrays(gl!.TRIANGLES, 0, mesh.length / STRIDE);
    // Still ("reduce motion"): drawn only while a flip or a poke lasts (the user's own request).
    if (moving || f < 1 || since < ANGRY_MS) requestAnimationFrame(draw);
    else running = false;
  };
  kick();
  return true;
}
