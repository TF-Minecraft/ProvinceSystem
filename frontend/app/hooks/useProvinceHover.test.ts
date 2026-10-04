import { describe, expect, it } from "vitest";

import {
  indexStoredProvinceData,
  storedTradeShares,
} from "./useProvinceHover";

describe("storedTradeShares", () => {
  it("normalises a stored day's raw per-guild trade into ratios", () => {
    expect({ ...storedTradeShares({ Lantan: { trade: 0.73, production: 0 } }) })
      .toEqual({ Lantan: 1 });
  });

  it("splits proportionally across guilds and ignores production", () => {
    const shares = storedTradeShares({
      A: { trade: 3, production: 100 },
      B: { trade: 1, production: 0 },
    });
    expect(shares.A).toBeCloseTo(0.75);
    expect(shares.B).toBeCloseTo(0.25);
  });

  it("returns an empty map for empty, missing or non-object trade", () => {
    for (const input of [{}, null, undefined, [], "x", 4]) {
      expect(Object.keys(storedTradeShares(input))).toEqual([]);
    }
  });

  it("drops guilds whose trade is not a positive finite number", () => {
    const shares = storedTradeShares({
      good: { trade: 2 },
      zero: { trade: 0 },
      negative: { trade: -5 },
      text: { trade: "9" },
      nan: { trade: Number.NaN },
      missing: {},
    });
    expect(Object.keys(shares)).toEqual(["good"]);
    expect(shares.good).toBe(1);
  });

  it("has no prototype, so a guild named __proto__ is an own key", () => {
    // Object-literal `__proto__` sets the prototype rather than a key, so the
    // hostile input is built the way it actually arrives: parsed JSON.
    const shares = storedTradeShares(
      JSON.parse('{"__proto__": {"trade": 1}}')
    );
    expect(Object.getPrototypeOf(shares)).toBeNull();
    expect(Object.keys(shares)).toEqual(["__proto__"]);
  });
});

describe("indexStoredProvinceData", () => {
  it("indexes the stored list by province id", () => {
    const byId = indexStoredProvinceData([
      { id: 1, prosperity: 0, trade: { Lantan: { trade: 0.73 } } },
      { id: 2, prosperity: 4.5, trade: {} },
    ]);
    expect(Object.keys(byId)).toEqual(["1", "2"]);
    expect(byId[1]!.trade_shares).toEqual({ Lantan: 1 });
    expect(byId[2]!.prosperity).toBe(4.5);
    expect(byId[2]!.trade_shares).toEqual({});
  });

  it("returns an empty index for anything that is not an array", () => {
    for (const input of [null, undefined, {}, "x", 7]) {
      expect(Object.keys(indexStoredProvinceData(input))).toEqual([]);
    }
  });

  it("skips rows with a missing or non-integer id", () => {
    const byId = indexStoredProvinceData([
      null,
      "nope",
      [],
      { prosperity: 1 },
      { id: "3" },
      { id: 1.5 },
      { id: 9, prosperity: 1 },
    ]);
    expect(Object.keys(byId)).toEqual(["9"]);
  });

  it("defaults a non-numeric prosperity to 0", () => {
    const byId = indexStoredProvinceData([{ id: 1, prosperity: "high" }]);
    expect(byId[1]!.prosperity).toBe(0);
  });

  it("has no prototype", () => {
    expect(Object.getPrototypeOf(indexStoredProvinceData([]))).toBeNull();
  });
});
