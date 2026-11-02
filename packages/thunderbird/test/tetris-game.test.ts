/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Tetris's rules (tetris-game.ts, D49).

import { describe, expect, it } from "vitest";
import { HEIGHT, HIDDEN, KINDS, WIDTH, bag, cellsOf, dropped, fits, gravityMs, hardDrop, holdPiece, lock, move, newGame, rotate, tick, type Game, type Kind } from "../src/tetris-game.js";

/** A repeatable "random" (a simple LCG), so games are the same every run. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}
const bottom = HEIGHT + HIDDEN - 1;
/** A game whose current piece is `kind`, the field empty. */
function withPiece(kind: Kind): Game {
  const g = newGame(seeded());
  g.piece = { kind, rotation: 0, x: 3, y: 5 };
  return g;
}
const filled = (g: Game) => g.field.flat().filter((c) => c !== null).length;

describe("pieces", () => {
  it("draws every piece once per bag of seven", () => {
    const random = seeded(7);
    for (let i = 0; i < 5; i++) expect([...bag(random)].sort()).toEqual([...KINDS].sort());
  });

  it("has four cells in every rotation, and comes back after four turns", () => {
    for (const kind of KINDS) {
      for (let r = 0; r < 4; r++) expect(new Set(cellsOf(kind, r).map(([x, y]) => `${x},${y}`)).size).toBe(4);
      expect(cellsOf(kind, 4)).toEqual(cellsOf(kind, 0));
    }
  });
});

describe("moving and rotating", () => {
  it("stops at the walls and the floor", () => {
    const g = withPiece("O");
    while (move(g, -1, 0));
    expect(g.piece.x).toBe(0);
    while (move(g, 1, 0));
    expect(g.piece.x).toBe(WIDTH - 2);
    expect(dropped(g).y).toBe(bottom - 1); // the O is two rows high
  });

  it("rotates against a wall by kicking off it (SRS)", () => {
    const g = withPiece("T");
    g.piece.rotation = 1; // pointing right, flat against the left wall
    while (move(g, -1, 0));
    expect(rotate(g, 1)).toBe(true); // would stick out: kicked back in
    expect(fits(g.field, g.piece)).toBe(true);
    expect(g.piece.x).toBeGreaterThanOrEqual(0);
  });

  it("doesn't rotate where no kick fits", () => {
    const g = withPiece("I");
    // A one-cell-wide pit: walls of blocks either side of the upright I.
    g.piece = { kind: "I", rotation: 1, x: 2, y: 10 };
    for (let y = 0; y < HEIGHT + HIDDEN; y++) for (const x of [0, 1, 2, 3, 5, 6, 7, 8, 9]) g.field[y]![x] = "Z";
    expect(fits(g.field, g.piece)).toBe(true);
    expect(rotate(g, 1)).toBe(false);
    expect(g.piece.rotation).toBe(1);
  });
});

describe("lines and score", () => {
  it("clears full rows, scores by how many at once and the level, and moves the rest down", () => {
    const g = withPiece("I");
    // Four rows full but for the last column; one block above them.
    for (let y = bottom - 3; y <= bottom; y++) for (let x = 0; x < WIDTH - 1; x++) g.field[y]![x] = "L";
    g.field[bottom - 4]![0] = "J";
    g.piece = { kind: "I", rotation: 1, x: WIDTH - 3, y: 0 }; // upright in the last column
    hardDrop(g);
    expect(g.lines).toBe(4);
    expect(g.score).toBeGreaterThanOrEqual(800); // a tetris at level 1, plus the drop
    expect(g.field[bottom]![0]).toBe("J"); // the block above fell to the floor
    expect(filled(g)).toBe(1);
  });

  it("goes up a level every 10 lines, and falls faster", () => {
    const g = withPiece("I");
    g.lines = 9;
    for (let x = 0; x < WIDTH - 4; x++) g.field[bottom]![x] = "S";
    g.piece = { kind: "I", rotation: 0, x: WIDTH - 4, y: bottom - 1 };
    lock(g);
    expect(g.lines).toBe(10);
    expect(g.level).toBe(2);
    expect(gravityMs(2)).toBeLessThan(gravityMs(1));
    expect(gravityMs(30)).toBeGreaterThan(0);
  });

  it("gives two points per row of a hard drop", () => {
    const g = withPiece("O");
    const rows = dropped(g).y - g.piece.y;
    hardDrop(g);
    expect(g.score).toBe(2 * rows);
  });
});

describe("hold and the end", () => {
  it("holds a piece once per piece, swapping it with the held one", () => {
    const g = withPiece("T");
    const next = g.queue[0];
    expect(holdPiece(g)).toBe(true);
    expect(g.hold).toBe("T");
    expect(g.piece.kind).toBe(next);
    expect(holdPiece(g)).toBe(false); // not twice for the same piece
    hardDrop(g);
    expect(holdPiece(g)).toBe(true);
    expect(g.piece.kind).toBe("T"); // the held one back
  });

  it("ends when a new piece has no room", () => {
    const g = newGame(seeded(3));
    for (let i = 0; i < 200 && !g.over; i++) hardDrop(g); // pieces pile up in the middle
    expect(g.over).toBe(true);
    expect(tick(g)).toBe(false); // nothing moves any more
  });
});
