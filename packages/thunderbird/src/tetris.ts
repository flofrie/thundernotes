/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Tetris (an experiment, D49): the page. Draws the game (tetris-game.ts has the rules) with the
// pieces as little post-its in ThunderNotes' colours, reads the keys (with the usual delayed
// auto-repeat for moving and soft drop), gives a piece half a second on the ground before it
// locks, and keeps the best score on this computer.

import { COLOURS, darker, colourOf, rgba } from "@thundernotes/core";
import { HEIGHT, HIDDEN, WIDTH, cellsOf, dropped, gravityMs, hardDrop, holdPiece, lock, move, newGame, rotate, softDrop, tick, type Game, type Kind } from "./tetris-game.js";

const CELL = 28;
/** Piece colours: ThunderNotes' palette (D29). */
const PALETTE: Record<Kind, keyof typeof COLOURS> = { I: "blue", O: "yellow", T: "purple", S: "green", Z: "red", J: "pink", L: "orange" };
/** Time on the ground before a piece locks, and how often a move may restart it. */
const LOCK_MS = 500;
const LOCK_RESETS = 15;
/** Holding a key: the first repeat after DAS, then every ARR (ms). */
const DAS = 160;
const ARR = 45;
const SOFT_MS = 35;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dpr = Math.min(window.devicePixelRatio || 1, 3);

/** A canvas at the screen's pixel density, drawn in CSS pixels. */
function context(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}
const field = context($<HTMLCanvasElement>("field"), WIDTH * CELL, HEIGHT * CELL);
const holdCtx = context($<HTMLCanvasElement>("hold"), 130, 90);
const nextCtx = context($<HTMLCanvasElement>("next"), 130, 250);

/** One block: a little post-it, its bottom right corner folded. */
function block(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, kind: Kind, alpha = 1): void {
  const colour = colourOf(PALETTE[kind]);
  const pad = Math.max(1, size * 0.06);
  const s = size - 2 * pad;
  const fold = s * 0.28;
  const [left, top] = [x + pad, y + pad];
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(left + 3, top);
  ctx.lineTo(left + s - 3, top);
  ctx.quadraticCurveTo(left + s, top, left + s, top + 3);
  ctx.lineTo(left + s, top + s - fold);
  ctx.lineTo(left + s - fold, top + s);
  ctx.lineTo(left + 3, top + s);
  ctx.quadraticCurveTo(left, top + s, left, top + s - 3);
  ctx.lineTo(left, top + 3);
  ctx.quadraticCurveTo(left, top, left + 3, top);
  ctx.fillStyle = rgba(colour, 1);
  ctx.fill();
  ctx.strokeStyle = darker(colour);
  ctx.lineWidth = 1;
  ctx.stroke();
  // The fold and a light along the top.
  ctx.beginPath();
  ctx.moveTo(left + s, top + s - fold);
  ctx.lineTo(left + s - fold, top + s - fold);
  ctx.lineTo(left + s - fold, top + s);
  ctx.closePath();
  ctx.fillStyle = darker(colour);
  ctx.fill();
  ctx.fillStyle = "#ffffff40";
  ctx.fillRect(left + 2, top + 1.5, s - 4, Math.max(1.5, s * 0.12));
  ctx.globalAlpha = 1;
}

/** A piece in a side box (hold, next), centred in `w` × `h` at (x, y). */
function preview(ctx: CanvasRenderingContext2D, kind: Kind, x: number, y: number, w: number, h: number, alpha = 1): void {
  const size = 22;
  const cells = cellsOf(kind, 0);
  const xs = cells.map(([cx]) => cx);
  const ys = cells.map(([, cy]) => cy);
  const cw = (Math.max(...xs) - Math.min(...xs) + 1) * size;
  const ch = (Math.max(...ys) - Math.min(...ys) + 1) * size;
  for (const [cx, cy] of cells) block(ctx, x + (w - cw) / 2 + (cx - Math.min(...xs)) * size, y + (h - ch) / 2 + (cy - Math.min(...ys)) * size, size, kind, alpha);
}

let game: Game = newGame();
let state: "ready" | "playing" | "paused" | "over" = "ready";
let best = 0;
try {
  best = Number(localStorage.getItem("thundernotes-tetris-best") ?? 0) || 0;
} catch {
  // not stored: fine
}
/** The rows just cleared light up for a moment. */
let flash: { rows: number[]; until: number } = { rows: [], until: 0 };

function draw(now: number): void {
  const css = getComputedStyle(document.documentElement);
  field.clearRect(0, 0, WIDTH * CELL, HEIGHT * CELL);
  field.strokeStyle = css.getPropertyValue("--grid");
  for (let x = 1; x < WIDTH; x++) (field.beginPath(), field.moveTo(x * CELL, 0), field.lineTo(x * CELL, HEIGHT * CELL), field.stroke());
  for (let y = 1; y < HEIGHT; y++) (field.beginPath(), field.moveTo(0, y * CELL), field.lineTo(WIDTH * CELL, y * CELL), field.stroke());
  game.field.forEach((row, y) => row.forEach((kind, x) => kind && y >= HIDDEN && block(field, x * CELL, (y - HIDDEN) * CELL, CELL, kind)));
  if (state !== "over") {
    const ghost = dropped(game);
    for (const [cx, cy] of cellsOf(ghost.kind, ghost.rotation)) if (ghost.y + cy >= HIDDEN) block(field, (ghost.x + cx) * CELL, (ghost.y + cy - HIDDEN) * CELL, CELL, ghost.kind, 0.22);
    for (const [cx, cy] of cellsOf(game.piece.kind, game.piece.rotation)) if (game.piece.y + cy >= HIDDEN) block(field, (game.piece.x + cx) * CELL, (game.piece.y + cy - HIDDEN) * CELL, CELL, game.piece.kind);
  }
  if (now < flash.until) {
    field.fillStyle = `rgba(255,255,255,${(0.75 * (flash.until - now)) / 180})`;
    for (const y of flash.rows) field.fillRect(0, (y - HIDDEN) * CELL, WIDTH * CELL, CELL);
  }
  holdCtx.clearRect(0, 0, 130, 90);
  if (game.hold) preview(holdCtx, game.hold, 0, 0, 130, 90, game.held ? 0.35 : 1);
  nextCtx.clearRect(0, 0, 130, 250);
  game.queue.slice(0, 3).forEach((kind, i) => preview(nextCtx, kind, 0, i * 82, 130, 82, 1 - i * 0.18));
  $("score").textContent = game.score.toLocaleString();
  $("lines").textContent = String(game.lines);
  $("level").textContent = String(game.level);
  $("best").textContent = Math.max(best, game.score).toLocaleString();
}

function show(title: string, message: string): void {
  $("title").textContent = title;
  $("message").innerHTML = message; // fixed texts only
  $("overlay").hidden = false;
}

function start(): void {
  game = newGame();
  state = "playing";
  $("overlay").hidden = true;
  fallAt = performance.now() + gravityMs(1);
  groundSince = null;
  resets = 0;
}

function pause(on: boolean): void {
  if (on && state === "playing") {
    state = "paused";
    show("Paused", "Press <kbd>P</kbd> or <kbd>Space</kbd> to go on");
  } else if (!on && state === "paused") {
    state = "playing";
    $("overlay").hidden = true;
    fallAt = performance.now() + gravityMs(game.level);
  }
}

function over(): void {
  state = "over";
  const record = game.score > best;
  if (record) {
    best = game.score;
    try {
      localStorage.setItem("thundernotes-tetris-best", String(best));
    } catch {
      // not stored: fine
    }
  }
  show(record ? "New best!" : "Game over", `${game.score.toLocaleString()} points · ${game.lines} lines<br>Press <kbd>Space</kbd> to play again`);
}

/** After a piece locked: the flash for cleared rows, and the end. */
function afterLock(now: number): void {
  if (game.cleared.length) flash = { rows: game.cleared, until: now + 180 };
  groundSince = null;
  resets = 0;
  if (game.over) over();
}

// Gravity and lock delay.
let fallAt = 0;
let groundSince: number | null = null;
let resets = 0;
const onGround = () => dropped(game).y === game.piece.y;

/** After a move or rotation: on the ground, the lock waits again (a limited number of times). */
function moved(): void {
  if (groundSince !== null && resets < LOCK_RESETS) {
    groundSince = performance.now();
    resets++;
  }
}

// Keys held down: delayed auto-repeat, as Tetris games do (the system's own repeat is ignored).
const held = new Map<string, { next: number; repeats: boolean }>();
const ACTIONS: Record<string, () => void> = {
  left: () => move(game, -1, 0) && moved(),
  right: () => move(game, 1, 0) && moved(),
  down: () => {
    if (softDrop(game)) fallAt = performance.now() + gravityMs(game.level);
  },
};
const KEY_ACTION: Record<string, string> = { ArrowLeft: "left", ArrowRight: "right", ArrowDown: "down" };

document.addEventListener("keydown", (e) => {
  const key = e.key;
  if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " "].includes(key)) e.preventDefault();
  if (e.repeat) return;
  if (state === "ready" || state === "over") {
    if (key === " " || key === "Enter") start();
    return;
  }
  if (key === "p" || key === "P" || key === "Escape") return pause(state === "playing");
  if (state === "paused") {
    if (key === " ") pause(false);
    return;
  }
  if (key === "r" || key === "R") return start();
  const action = KEY_ACTION[key];
  if (action) {
    ACTIONS[action]!();
    held.set(action, { next: performance.now() + (action === "down" ? SOFT_MS : DAS), repeats: true });
    // The other direction wins while both are held.
    if (action === "left") held.delete("right");
    if (action === "right") held.delete("left");
    return;
  }
  if (key === "ArrowUp" || key === "x" || key === "X") rotate(game, 1) && moved();
  else if (key === "z" || key === "Z" || key === "Control") rotate(game, -1) && moved();
  else if (key === " ") {
    hardDrop(game);
    afterLock(performance.now());
    fallAt = performance.now() + gravityMs(game.level);
  } else if (key === "c" || key === "C" || key === "Shift") {
    if (holdPiece(game)) {
      groundSince = null;
      resets = 0;
      fallAt = performance.now() + gravityMs(game.level);
    }
  }
});
document.addEventListener("keyup", (e) => {
  const action = KEY_ACTION[e.key];
  if (action) held.delete(action);
});
// Leaving the tab pauses (no game lost while reading mail).
document.addEventListener("visibilitychange", () => document.hidden && pause(true));
window.addEventListener("blur", () => {
  held.clear();
  pause(true);
});

function frame(now: number): void {
  if (state === "playing") {
    for (const [action, h] of held) {
      while (now >= h.next) {
        ACTIONS[action]!();
        h.next += action === "down" ? SOFT_MS : ARR;
      }
    }
    if (onGround()) {
      groundSince ??= now;
      if (now - groundSince >= LOCK_MS) {
        lock(game);
        afterLock(now);
        fallAt = now + gravityMs(game.level);
      }
    } else {
      groundSince = null;
      if (now >= fallAt) {
        tick(game);
        fallAt = now + gravityMs(game.level);
      }
    }
  }
  draw(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Asked whether this tab is open, to bring it to the front instead of opening another.
messenger.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type !== "tetrisTab") return undefined;
  return messenger.tabs.getCurrent().then((tab) => (tab?.id !== undefined ? { tabId: tab.id, windowId: tab.windowId } : undefined));
});
