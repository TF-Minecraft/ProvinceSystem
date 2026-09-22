import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolveDuchyProvinces,
  resolveTitleProvinces,
  type TitleEntity,
  type TitleLayers,
} from "./titleProvinces";

const fixtureLayers: TitleLayers = {
  county: {
    COUNTY_1: { provinces: [1, 2, 3] },
    COUNTY_2: { provinces: [4, 5] },
    COUNTY_LEAF: { provinces: [100, 101] },
    COUNTY_X: { provinces: [200] },
  },
  duchy: {
    DUCHY_1: { titles: ["COUNTY_1", "COUNTY_2"] },
    INCOMPLETE: { provinces: [99], titles: ["COUNTY_X"] },
  },
  kingdom: {
    KINGDOM_1: { titles: ["DUCHY_1"] },
    DIRECT_COUNTY: { titles: ["COUNTY_LEAF"] },
  },
  empire: {
    EMPIRE_1: { titles: ["KINGDOM_1"] },
  },
  trade: {
    guild_a: { provinces: [10, 20] },
  },
};

describe("resolveTitleProvinces", () => {
  it("returns county provinces directly", () => {
    expect(resolveTitleProvinces("COUNTY_1", "county", fixtureLayers)).toEqual([
      1, 2, 3,
    ]);
  });

  it("rolls up duchy through counties", () => {
    expect(resolveTitleProvinces("DUCHY_1", "duchy", fixtureLayers)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("rolls up kingdom through duchy", () => {
    expect(resolveTitleProvinces("KINGDOM_1", "kingdom", fixtureLayers)).toEqual(
      [1, 2, 3, 4, 5]
    );
  });

  it("rolls up empire through kingdom with no duplicates", () => {
    expect(resolveTitleProvinces("EMPIRE_1", "empire", fixtureLayers)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("falls through kingdom child to county when not in duchy layer", () => {
    expect(
      resolveTitleProvinces("DIRECT_COUNTY", "kingdom", fixtureLayers)
    ).toEqual([100, 101]);
  });

  it("unions direct provinces and nested titles on incomplete holders", () => {
    expect(resolveDuchyProvinces("INCOMPLETE", fixtureLayers)).toEqual([
      99, 200,
    ]);
  });

  it("returns trade guild provinces", () => {
    expect(resolveTitleProvinces("guild_a", "trade", fixtureLayers)).toEqual([
      10, 20,
    ]);
  });
});

describe("KINGDOM_1 spot-check (main defines)", () => {
  const definesDir = join(
    __dirname,
    "..",
    "..",
    "..",
    "backend",
    "src",
    "defines",
    "main"
  );

  function loadJson<T>(file: string): T {
    return JSON.parse(
      readFileSync(join(definesDir, file), "utf-8")
    ) as T;
  }

  it("matches union of COUNTY_1 through COUNTY_15 provinces", () => {
    const county = loadJson<Record<string, TitleEntity>>("county.json");
    const duchy = loadJson<Record<string, TitleEntity>>("duchy.json");
    const kingdom = loadJson<Record<string, TitleEntity>>("kingdom.json");

    const layers: TitleLayers = { county, duchy, kingdom };

    const expected = [
      "COUNTY_1",
      "COUNTY_2",
      "COUNTY_3",
      "COUNTY_4",
      "COUNTY_5",
      "COUNTY_6",
      "COUNTY_7",
      "COUNTY_8",
      "COUNTY_9",
      "COUNTY_10",
      "COUNTY_11",
      "COUNTY_12",
      "COUNTY_13",
      "COUNTY_14",
      "COUNTY_15",
    ].flatMap((id) => county[id]?.provinces ?? []);

    const result = resolveTitleProvinces("KINGDOM_1", "kingdom", layers);
    expect(result.sort((a, b) => a - b)).toEqual(
      [...new Set(expected)].sort((a, b) => a - b)
    );
  });
});
