import { describe, expect, it } from "vitest";

import { buildNationColorLut, type NationOwnership } from "./chroniclePaint";
import { CHRONICLE_TRADE_LEAGUE_ALPHA, buildTradeLeagueColorLut } from "./chronicleTradeLeagues";

/** The served `trade.json` shape, which is `nation.json`'s shape. */
const leagues: NationOwnership = {
  Lantan: { rgb: "51,200,210", provinces: [1, 25] },
  Lantel_Shipping: { rgb: "107,90,230", provinces: [695] },
};

const unpack = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

describe("buildTradeLeagueColorLut", () => {
  it("paints each league's provinces in its own colour", () => {
    const lut = buildTradeLeagueColorLut(leagues);
    expect(unpack(lut[1]!).slice(0, 3)).toEqual([51, 200, 210]);
    expect(unpack(lut[25]!).slice(0, 3)).toEqual([51, 200, 210]);
    expect(unpack(lut[695]!).slice(0, 3)).toEqual([107, 90, 230]);
  });

  it("paints partially so the nation fill under it is not erased", () => {
    // Opaque, a league would make the nation fill appear to lose land on the
    // day the league was founded, which is a lie about the map.
    const lut = buildTradeLeagueColorLut(leagues);
    expect(unpack(lut[1]!)[3]).toBe(CHRONICLE_TRADE_LEAGUE_ALPHA);
    expect(unpack(lut[695]!)[3]).toBe(CHRONICLE_TRADE_LEAGUE_ALPHA);
  });

  it("leaves unclaimed provinces transparent", () => {
    const lut = buildTradeLeagueColorLut(leagues);
    expect(lut[2]).toBe(0);
    expect(lut[694]).toBe(0);
  });

  it("differs from the nation builder only in the alpha byte", () => {
    // The whole reason this module has no parser of its own: the shape is
    // identical, so a second copy of the clamping would be a second place for
    // the province-id ceiling to drift.
    const nationLut = buildNationColorLut(leagues);
    const leagueLut = buildTradeLeagueColorLut(leagues);
    expect(leagueLut.length).toBe(nationLut.length);
    for (let id = 0; id < nationLut.length; id++) {
      expect(leagueLut[id]! >>> 8).toBe(nationLut[id]! >>> 8);
    }
  });

  it("treats a day with no stored trade file as a day with no leagues", () => {
    expect(buildTradeLeagueColorLut(null)).toHaveLength(0);
  });

  it("paints nothing for a league with no colour or no land", () => {
    const lut = buildTradeLeagueColorLut({
      colourless: { provinces: [4] },
      landless: { rgb: "1,2,3", provinces: [] },
    } as NationOwnership);
    expect(lut[4]).toBe(0);
  });
});
