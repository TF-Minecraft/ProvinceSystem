import { describe, expect, it } from "vitest";

import type { RailNetwork, RailStop } from "./rail";
import { buildSchematic, octilinear, projectBounds, roundedPath, GRID, type Pt } from "./railSchematic";

const stop = (name: string, track: string, along: number, at: [number, number], kind = "settlement"): RailStop => ({
  name,
  kind,
  faction_id: null,
  settlement: at,
  track,
  line: track === "branch" ? 1 : 0,
  along,
  at,
  distance: 0,
});

// A main line bending north, with a branch off it and a cluster of stops at its west end.
const NETWORK: RailNetwork = {
  status: "ok",
  world: "TFMC_Map",
  updated_at: null,
  unreadable_files: 0,
  lines: [
    { id: 0, name: "West – North", length: 3000, tracks: ["main"] },
    { id: 1, name: "South line", length: 800, tracks: ["branch"] },
  ],
  tracks: [
    {
      id: "main",
      line: 0,
      length: 3000,
      loop: false,
      points: [[0, 1000], [1000, 1000], [1700, 900], [2000, 0]],
      broken: [{ from: 500, to: 520, points: [[500, 1000], [520, 1000]] }],
      damaged: [],
    },
    { id: "branch", line: 1, length: 800, loop: false, points: [[1000, 1000], [1100, 1800]], broken: [], damaged: [] },
  ],
  junctions: [{ id: "j", stem: "main", branch: "branch", at: [1000, 1001], thrown: false }],
  stops: [
    stop("West", "main", 0, [0, 1000], "faction_capital"),
    stop("West Halt", "main", 40 + 150, [190, 1000]),
    stop("West Park", "main", 260, [260, 1000]),
    stop("Bend", "main", 1700, [1690, 905]),
    stop("North", "main", 2930, [1980, 60]),
    stop("South", "branch", 800, [1100, 1800]),
  ],
};

const isOctilinear = ([ax, ay]: Pt, [bx, by]: Pt) => {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6;
};

describe("octilinear", () => {
  it("keeps straight and diagonal runs as they are", () => {
    expect(octilinear([0, 0], [50, 0], null)).toEqual([[0, 0], [50, 0]]);
    expect(octilinear([0, 0], [50, 50], null)).toEqual([[0, 0], [50, 50]]);
  });

  it("bends once, on the side nearer the real track", () => {
    expect(octilinear([0, 0], [100, 25], [12, 12])).toEqual([[0, 0], [25, 25], [100, 25]]);
    expect(octilinear([0, 0], [100, 25], [80, 2])).toEqual([[0, 0], [75, 0], [100, 25]]);
  });
});

describe("buildSchematic", () => {
  const schematic = buildSchematic(NETWORK);

  it("draws every run of track at 0, 45 or 90 degrees", () => {
    for (const track of schematic.tracks) {
      for (let i = 1; i < track.path.length; i++) expect(isOctilinear(track.path[i - 1], track.path[i])).toBe(true);
    }
  });

  it("puts each stop on its track, on the grid, and no two in one place", () => {
    const seen = new Set<string>();
    for (const spot of schematic.stops) {
      const track = schematic.tracks.find((t) => t.id === NETWORK.stops[spot.index].track)!;
      expect(track.path.some(([x, y]) => x === spot.at[0] && y === spot.at[1])).toBe(true);
      expect(spot.at[0] % GRID).toBe(0);
      expect(spot.at[1] % GRID).toBe(0);
      seen.add(spot.at.join(","));
    }
    expect(seen.size).toBe(NETWORK.stops.length);
  });

  it("keeps the stops in their order east to west and north to south", () => {
    const at = (name: string) => schematic.stops.find((s) => NETWORK.stops[s.index].name === name)!.at;
    expect(at("West")[0]).toBeLessThan(at("West Halt")[0]);
    expect(at("West Halt")[0]).toBeLessThan(at("West Park")[0]);
    expect(at("West Park")[0]).toBeLessThan(at("Bend")[0]);
    expect(at("North")[1]).toBeLessThan(at("Bend")[1]);
    expect(at("Bend")[1]).toBeLessThan(at("South")[1]);
  });

  it("gives a crowded cluster of stops room", () => {
    const at = (name: string) => schematic.stops.find((s) => NETWORK.stops[s.index].name === name)!.at;
    // 70 blocks apart on a 2,000-block network: on scale they would be about 35 units apart.
    expect(at("West Park")[0] - at("West Halt")[0]).toBeGreaterThanOrEqual(GRID * 2);
  });

  it("ends a line at a stop near its end, and joins the branch at the junction", () => {
    const north = schematic.stops.find((s) => NETWORK.stops[s.index].name === "North")!;
    const main = schematic.tracks.find((t) => t.id === "main")!;
    const branch = schematic.tracks.find((t) => t.id === "branch")!;
    expect(north.terminus).toBe(true);
    expect(main.path.at(-1)).toEqual(north.at);
    expect(main.path).toContainEqual(branch.path[0]);
    // Every end has a stop, so no bare end bars.
    expect(schematic.ends).toEqual([]);
  });

  it("finds broken track on the diagram", () => {
    expect(schematic.stretches).toHaveLength(1);
    expect(schematic.stretches[0]).toMatchObject({ kind: "broken", line: 0 });
    expect(schematic.stretches[0].path.length).toBeGreaterThanOrEqual(2);
  });

  it("frames a box in the world as a box on the diagram", () => {
    const box = projectBounds(schematic, { x: 0, y: 900, w: 300, h: 200 });
    expect(box.w).toBeGreaterThanOrEqual(GRID * 14);
    const west = schematic.project([0, 1000]);
    expect(west[0]).toBeGreaterThanOrEqual(box.x);
    expect(west[0]).toBeLessThanOrEqual(box.x + box.w);
  });

  it("copes with no track at all", () => {
    const empty = buildSchematic({ ...NETWORK, tracks: [], stops: [], junctions: [] });
    expect(empty.tracks).toEqual([]);
    expect(empty.width).toBeGreaterThan(0);
  });
});

describe("roundedPath", () => {
  it("rounds corners and keeps straight points straight", () => {
    expect(roundedPath([[0, 0], [50, 0], [100, 0]], 10)).toBe("M0 0L50 0L100 0");
    expect(roundedPath([[0, 0], [100, 0], [100, 100]], 10)).toBe("M0 0L90 0Q100 0 100 10L100 100");
  });
});
