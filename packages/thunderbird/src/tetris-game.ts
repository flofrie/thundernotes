/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Tetris (an experiment, D49): the rules, apart from drawing and keys (tetris.ts), so they can be
// tested. A 10 × 20 field (plus 2 hidden rows on top), the seven pieces drawn from shuffled bags of
// seven, rotation with the standard wall kicks (SRS), hold, a ghost, soft and hard drop, levels
// every 10 lines, the usual scores.

export const WIDTH = 10;
export const HEIGHT = 20;
/** Rows above the field where pieces appear. */
export const HIDDEN = 2;

export type Kind = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
export const KINDS: Kind[] = ["I", "O", "T", "S", "Z", "J", "L"];

/** Each piece's cells in its spawn rotation, as [x, y] in a box (y down). */
const SHAPES: Record<Kind, { size: number; cells: [number, number][] }> = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

/** A piece's cells (relative to its box) in rotation 0–3, clockwise. */
export function cellsOf(kind: Kind, rotation: number): [number, number][] {
  const { size, cells } = SHAPES[kind];
  let out = cells;
  for (let r = 0; r < ((rotation % 4) + 4) % 4; r++) out = out.map(([x, y]) => [size - 1 - y, x] as [number, number]);
  return out;
}

// SRS wall kicks, (x, y up) as published; y is flipped below (our y goes down).
const KICKS_JLSTZ: Record<string, [number, number][]> = {
  "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICKS_I: Record<string, [number, number][]> = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

export interface Piece {
  kind: Kind;
  rotation: number;
  /** The box's top left, in field cells (y from the top of the hidden rows). */
  x: number;
  y: number;
}

/** The field: rows from the top (hidden rows first), each cell a kind or null. */
export type Field = (Kind | null)[][];

export interface Game {
  field: Field;
  piece: Piece;
  /** The pieces to come (at least 3 shown). */
  queue: Kind[];
  hold: Kind | null;
  /** Hold may be used once per piece. */
  held: boolean;
  score: number;
  lines: number;
  level: number;
  over: boolean;
  /** The rows just cleared (for a flash), until the next piece locks. */
  cleared: number[];
  random: () => number;
}

const emptyRow = () => Array<Kind | null>(WIDTH).fill(null);

/** A shuffled bag of the seven pieces (Fisher–Yates). */
export function bag(random: () => number): Kind[] {
  const out = [...KINDS];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A piece as it appears: centred, in the hidden rows' lower part. */
function spawn(kind: Kind): Piece {
  const size = SHAPES[kind].size;
  return { kind, rotation: 0, x: Math.floor((WIDTH - size) / 2), y: kind === "I" ? HIDDEN - 2 : HIDDEN - 1 };
}

export function newGame(random: () => number = Math.random): Game {
  const queue = [...bag(random), ...bag(random)];
  const game: Game = {
    field: Array.from({ length: HEIGHT + HIDDEN }, emptyRow),
    piece: spawn(queue.shift()!),
    queue,
    hold: null,
    held: false,
    score: 0,
    lines: 0,
    level: 1,
    over: false,
    cleared: [],
    random,
  };
  return game;
}

/** Whether a piece fits: inside the field (the top may be left), on empty cells. */
export function fits(field: Field, p: Piece): boolean {
  return cellsOf(p.kind, p.rotation).every(([cx, cy]) => {
    const x = p.x + cx;
    const y = p.y + cy;
    return x >= 0 && x < WIDTH && y < HEIGHT + HIDDEN && (y < 0 || field[y]![x] === null);
  });
}

/** Moves the piece by (dx, dy) if it fits there. */
export function move(g: Game, dx: number, dy: number): boolean {
  if (g.over) return false;
  const next = { ...g.piece, x: g.piece.x + dx, y: g.piece.y + dy };
  if (!fits(g.field, next)) return false;
  g.piece = next;
  return true;
}

/** Rotates the piece (1 clockwise, -1 back), trying the wall kicks in order. */
export function rotate(g: Game, dir: 1 | -1): boolean {
  if (g.over || g.piece.kind === "O") return false;
  const from = g.piece.rotation;
  const to = (from + dir + 4) % 4;
  const kicks = (g.piece.kind === "I" ? KICKS_I : KICKS_JLSTZ)[`${from}>${to}`]!;
  for (const [kx, ky] of kicks) {
    const next = { ...g.piece, rotation: to, x: g.piece.x + kx, y: g.piece.y - ky };
    if (fits(g.field, next)) {
      g.piece = next;
      return true;
    }
  }
  return false;
}

/** Where the piece would land (the ghost). */
export function dropped(g: Game): Piece {
  let p = g.piece;
  while (fits(g.field, { ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 };
  return p;
}

/** Points for lines cleared at once, times the level. */
const LINE_POINTS = [0, 100, 300, 500, 800];

/** Fixes the piece in the field, clears full rows, scores, and brings the next piece. */
export function lock(g: Game): void {
  if (g.over) return;
  let above = true;
  for (const [cx, cy] of cellsOf(g.piece.kind, g.piece.rotation)) {
    const y = g.piece.y + cy;
    if (y >= 0) g.field[y]![g.piece.x + cx] = g.piece.kind;
    if (y >= HIDDEN) above = false;
  }
  const full = g.field.map((row, y) => (row.every((c) => c !== null) ? y : -1)).filter((y) => y >= 0);
  g.cleared = full;
  if (full.length) {
    g.field = [...full.map(emptyRow), ...g.field.filter((_, y) => !full.includes(y))];
    g.score += LINE_POINTS[full.length]! * g.level;
    g.lines += full.length;
    g.level = Math.floor(g.lines / 10) + 1;
  }
  // Locked entirely above the field: the game is over (lock out).
  if (above) {
    g.over = true;
    return;
  }
  next(g);
}

function next(g: Game): void {
  if (g.queue.length < 7) g.queue.push(...bag(g.random));
  g.piece = spawn(g.queue.shift()!);
  g.held = false;
  // No room for the new piece: the game is over (block out).
  if (!fits(g.field, g.piece)) g.over = true;
}

/** One step down by gravity, or locks when it can't. True if it locked. */
export function tick(g: Game): boolean {
  if (g.over) return false;
  if (move(g, 0, 1)) return false;
  lock(g);
  return true;
}

/** Soft drop: one row down, a point for it. */
export function softDrop(g: Game): boolean {
  if (!move(g, 0, 1)) return false;
  g.score += 1;
  return true;
}

/** Hard drop: straight down and lock, two points per row. */
export function hardDrop(g: Game): void {
  if (g.over) return;
  const land = dropped(g);
  g.score += 2 * (land.y - g.piece.y);
  g.piece = land;
  lock(g);
}

/** Swaps the piece with the held one (or the next), once per piece. */
export function holdPiece(g: Game): boolean {
  if (g.over || g.held) return false;
  const kind = g.piece.kind;
  if (g.hold) g.piece = spawn(g.hold);
  else next(g);
  g.hold = kind;
  g.held = true;
  return true;
}

/** Milliseconds per row at a level (the guideline curve, quicker from level 1 to 15). */
export function gravityMs(level: number): number {
  const l = Math.min(level, 20);
  return Math.max(16, Math.pow(0.8 - (l - 1) * 0.007, l - 1) * 1000);
}
