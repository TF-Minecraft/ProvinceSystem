import { describe, expect, it } from "vitest";

import { buildProsperityColorLut } from "./chronicleProsperity";
import { buildTradeLeagueColorLut } from "./chronicleTradeLeagues";
import {
  chronicleDiscardedProvinceMask,
  isChronicleDiscardedTerrain,
  omitDiscardedProvinces,
} from "./chronicleWater";

describe("isChronicleDiscardedTerrain", () => {
  it("matches the terrains the live generators skip, in any case", () => {
    expect(isChronicleDiscardedTerrain("water")).toBe(true);
    expect(isChronicleDiscardedTerrain(" Sea ")).toBe(true);
    expect(isChronicleDiscardedTerrain("plains")).toBe(false);
    expect(isChronicleDiscardedTerrain(null)).toBe(false);
  });
});

describe("chronicleDiscardedProvinceMask", () => {
  it("marks water and sea ids and ignores every other field", () => {
    const mask = chronicleDiscardedProvinceMask({
      1: { terrain: "plains", prosperity: 40 },
      2: { terrain: "water", prosperity: 12 },
      4: { terrain: "SEA", trade: { Lantan: { trade: 1 } } },
      5: { terrain: "mountain" },
    });
    expect(mask).not.toBeNull();
    expect(mask![1]).toBe(0);
    expect(mask![2]).toBe(1);
    expect(mask![3]).toBe(0);
    expect(mask![4]).toBe(1);
    expect(mask!.length).toBe(5);
  });

  it("returns an empty mask when the record names no water", () => {
    const mask = chronicleDiscardedProvinceMask({ 3: { terrain: "hills" } });
    expect(mask).toEqual(new Uint8Array(0));
  });

  it("refuses a payload that is not a province record", () => {
    expect(chronicleDiscardedProvinceMask(null)).toBeNull();
    expect(chronicleDiscardedProvinceMask([{ id: 1, terrain: "water" }])).toBeNull();
    expect(chronicleDiscardedProvinceMask("water")).toBeNull();
  });

  it("skips an id the paint pass could never reach", () => {
    const mask = chronicleDiscardedProvinceMask({
      1: { terrain: "water" },
      70000: { terrain: "sea" },
      "-2": { terrain: "water" },
    });
    expect(mask).toEqual(Uint8Array.of(0, 1));
  });
});

describe("omitDiscardedProvinces", () => {
  const mask = chronicleDiscardedProvinceMask({
    1: { terrain: "plains" },
    2: { terrain: "water" },
    3: { terrain: "sea" },
  })!;

  it("drops water and sea from a prosperity heat map and keeps a land floor", () => {
    const lut = buildProsperityColorLut([
      { id: 1, prosperity: 0 },
      { id: 2, prosperity: 40 },
      { id: 3, prosperity: 8 },
    ]);
    const painted = omitDiscardedProvinces(lut, mask);
    expect(painted[1]).toBe(lut[1]);
    expect(painted[1]).not.toBe(0);
    expect(painted[2]).toBe(0);
    expect(painted[3]).toBe(0);
    // The source table is what the day file said. The mask must not rewrite it.
    expect(lut[2]).not.toBe(0);
  });

  it("drops water and sea from league territory", () => {
    const lut = buildTradeLeagueColorLut({
      league: { rgb: "10,20,30", provinces: [1, 2, 3] },
    });
    const painted = omitDiscardedProvinces(lut, mask);
    expect(painted[1]).toBe(lut[1]);
    expect(painted[2]).toBe(0);
    expect(painted[3]).toBe(0);
  });

  it("returns the same table when nothing is discarded", () => {
    const lut = buildProsperityColorLut([{ id: 1, prosperity: 4 }]);
    expect(omitDiscardedProvinces(lut, new Uint8Array(0))).toBe(lut);
    expect(omitDiscardedProvinces(lut, null)).toBe(lut);
  });
});
