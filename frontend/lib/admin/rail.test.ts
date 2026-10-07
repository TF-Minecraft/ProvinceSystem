import { describe, expect, it } from "vitest";

import { blocks, boundsOfPoints, lineColour, terminals, type RailNetwork } from "./rail";

const network = (over: Partial<RailNetwork> = {}): RailNetwork => ({
  status: "ok",
  world: "TFMC_Map",
  updated_at: null,
  unreadable_files: 0,
  lines: [],
  tracks: [],
  junctions: [],
  stops: [],
  ...over,
});

describe("terminals", () => {
  it("bars each track end except where a junction joins it", () => {
    const ends = terminals(
      network({
        tracks: [
          { id: "a", line: 0, length: 20, loop: false, points: [[0, 0], [10, 0], [20, 0]], broken: [], damaged: [] },
          { id: "b", line: 0, length: 5, loop: false, points: [[10, 0], [10, 5]], broken: [], damaged: [] },
          { id: "c", line: 1, length: 9, loop: true, points: [[50, 50], [55, 50], [50, 50]], broken: [], damaged: [] },
        ],
        junctions: [{ id: "j", stem: "a", branch: "b", at: [10, 1], thrown: false }],
      })
    );
    expect(ends).toEqual([
      { at: [0, 0], towards: [10, 0], line: 0 },
      { at: [20, 0], towards: [10, 0], line: 0 },
      { at: [10, 5], towards: [10, 0], line: 0 },
    ]);
  });
});

describe("boundsOfPoints", () => {
  it("pads a small box out to the minimum, around its centre", () => {
    expect(boundsOfPoints([[10, 10], [20, 30]], 100)).toEqual({ x: -35, y: -30, w: 100, h: 100 });
    expect(boundsOfPoints([[0, 0], [300, 10]])).toEqual({ x: 0, y: 0, w: 300, h: 10 });
    expect(boundsOfPoints([])).toBeNull();
  });
});

describe("lineColour and blocks", () => {
  it("gives the first lines the rail map's red and green, and unnamed lines grey", () => {
    expect(lineColour({ id: 0, name: "A – B", length: 1, tracks: [] })).toBe("#e8473b");
    expect(lineColour({ id: 1, name: "C line", length: 1, tracks: [] })).toBe("#3fae5a");
    expect(lineColour({ id: 2, name: "Unnamed line", length: 1, tracks: [] })).toBe("#b9b6aa");
  });

  it("counts blocks", () => {
    expect(blocks(1)).toBe("1 block");
    expect(blocks(5313.4)).toBe("5,313 blocks");
  });
});
