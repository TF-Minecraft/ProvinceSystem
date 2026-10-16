import { describe, expect, it } from "vitest";

import {
  buildProvinceRegionIndex,
  buildTitleProvinceRegionIndex,
  resolveRegionAtPickPixel,
  resolveRegionAtProvincePoint,
} from "./regionPick";
import type { TitleLayers } from "../lib/titleProvinces";
import { pickSurfaceFromImageData, type PickSurface } from "../lib/map/pickSurface";
import { buildProvinceRunIndex, type ProvinceRunIndex } from "../lib/map/editor/buildProvinceIndex";
import type { RegionRecord } from "../components/map/types";

function mockSurface(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => [number, number, number, number],
): PickSurface {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(pixelAt(x, y), (y * width + x) * 4);
    }
  }
  return pickSurfaceFromImageData({ data, width, height });
}

const regionData: RegionRecord = {
  Vassal: { rgb: "10,20,30", name: "Vassal", overlord: "Overlord" },
  Overlord: { rgb: "40,50,60", name: "Overlord" },
};

describe("resolveRegionAtPickPixel", () => {
  it("maps a pick pixel to the resolved visible region", () => {
    const surface = mockSurface(4, 4, (x, y) => (x === 1 && y === 2 ? [10, 20, 30, 255] : [0, 0, 0, 0]));
    const rgbToId = { "10,20,30": "Vassal" };
    const picked = resolveRegionAtPickPixel(
      surface,
      1,
      2,
      rgbToId,
      (_mapType, _mapId, pickId) => ({
        regionId: pickId === "Vassal" ? "Overlord" : pickId,
        imagePath: "/hover.png",
        region: { name: "Overlord" },
      }),
      "nation",
      "main",
      regionData,
    );

    expect(picked).toEqual({
      pickId: "Vassal",
      regionId: "Overlord",
      region: { name: "Overlord" },
      imagePath: "/hover.png",
      overlay: undefined,
    });
  });

  it("returns null for an unknown rgb", () => {
    const surface = mockSurface(2, 2, () => [99, 88, 77, 255]);
    const picked = resolveRegionAtPickPixel(
      surface,
      0,
      0,
      { "10,20,30": "Vassal" },
      () => ({
        regionId: "Vassal",
        imagePath: null,
        region: { name: "Vassal" },
      }),
      "nation",
      "main",
      regionData,
    );
    expect(picked).toBeNull();
  });

  it("returns null when getHoverRegion finds no visible ancestor", () => {
    const surface = mockSurface(2, 2, () => [10, 20, 30, 255]);
    const picked = resolveRegionAtPickPixel(
      surface,
      0,
      0,
      { "10,20,30": "Vassal" },
      () => ({
        regionId: null,
        imagePath: null,
        region: null,
      }),
      "nation",
      "main",
      regionData,
    );
    expect(picked).toBeNull();
  });

  it("bridges a small water cutout inside a region", () => {
    // A transparent pond pixel inside Vassal: the exact pick misses, the
    // nearest land within the reach is still Vassal.
    const surface = mockSurface(9, 9, (x, y) => (x === 4 && y === 4 ? [0, 0, 0, 0] : [10, 20, 30, 255]));
    const picked = resolveRegionAtPickPixel(
      surface,
      4,
      4,
      { "10,20,30": "Vassal" },
      (_mapType, _mapId, pickId) => ({
        regionId: pickId,
        imagePath: null,
        region: { name: pickId },
      }),
      "nation",
      "main",
      regionData,
    );
    expect(picked?.pickId).toBe("Vassal");
  });

  it("bridges a water pixel that resolves to no region", () => {
    const surface = mockSurface(9, 9, (x, y) => (x === 4 && y === 4 ? [99, 88, 77, 255] : [10, 20, 30, 255]));
    const picked = resolveRegionAtPickPixel(
      surface,
      4,
      4,
      { "10,20,30": "Vassal", "99,88,77": "Water" },
      (_mapType, _mapId, pickId) =>
        pickId === "Water"
          ? { regionId: null, imagePath: null, region: null }
          : { regionId: pickId, imagePath: null, region: { name: pickId } },
      "nation",
      "main",
      regionData,
    );
    expect(picked?.pickId).toBe("Vassal");
  });

  it("picks nothing over open water beyond the reach of any region", () => {
    const surface = mockSurface(15, 15, (x, y) => (x === 0 && y === 0 ? [10, 20, 30, 255] : [0, 0, 0, 0]));
    const picked = resolveRegionAtPickPixel(
      surface,
      7,
      7,
      { "10,20,30": "Vassal" },
      (_mapType, _mapId, pickId) => ({
        regionId: pickId,
        imagePath: null,
        region: { name: pickId },
      }),
      "nation",
      "main",
      regionData,
    );
    expect(picked).toBeNull();
  });

  it("takes the nearest region when a cutout sits between two", () => {
    const surface = mockSurface(9, 9, (x, y) => {
      if (x === 5 && y === 4) return [10, 20, 30, 255]; // Vassal, 1 px away
      if (x === 4 && y === 2) return [40, 50, 60, 255]; // Overlord, 2 px away
      return [0, 0, 0, 0];
    });
    const picked = resolveRegionAtPickPixel(
      surface,
      4,
      4,
      { "10,20,30": "Vassal", "40,50,60": "Overlord" },
      (_mapType, _mapId, pickId) => ({
        regionId: pickId,
        imagePath: null,
        region: { name: pickId },
      }),
      "nation",
      "main",
      regionData,
    );
    expect(picked?.pickId).toBe("Vassal");
  });

  it("reaches as far as the pick surface's scale allows, and no further", () => {
    // One row is enough: the reach scales off the surface width alone.
    for (const [width, reach] of [
      [6400, 6],
      [3200, 3],
      [1600, 2],
    ] as const) {
      const atReach = mockSurface(width, 1, (x) => (x === 100 + reach ? [10, 20, 30, 255] : [0, 0, 0, 0]));
      const pastReach = mockSurface(width, 1, (x) => (x === 100 + reach + 1 ? [10, 20, 30, 255] : [0, 0, 0, 0]));
      const pick = (surface: PickSurface) =>
        resolveRegionAtPickPixel(
          surface,
          100,
          0,
          { "10,20,30": "Vassal" },
          (_mapType, _mapId, pickId) => ({
            regionId: pickId,
            imagePath: null,
            region: { name: pickId },
          }),
          "nation",
          "main",
          regionData,
        );
      expect(pick(atReach)?.pickId).toBe("Vassal");
      expect(pick(pastReach)).toBeNull();
    }
  });

  it("returns null for out-of-bounds pixels", () => {
    const surface = mockSurface(2, 2, () => [10, 20, 30, 255]);
    const picked = resolveRegionAtPickPixel(
      surface,
      5,
      5,
      { "10,20,30": "Vassal" },
      () => ({
        regionId: "Vassal",
        imagePath: null,
        region: { name: "Vassal" },
      }),
      "nation",
      "main",
      regionData,
    );
    expect(picked).toBeNull();
  });
});

/** A run index over a province-id grid given row by row (0 = no province). */
function mockRunIndex(rows: number[][]): ProvinceRunIndex {
  const height = rows.length;
  const width = rows[0]!.length;
  const lengths: number[] = [];
  const ids: number[] = [];
  for (const row of rows) {
    let current = row[0]!;
    let length = 1;
    for (let x = 1; x < row.length; x++) {
      if (row[x] === current) {
        length += 1;
      } else {
        lengths.push(length);
        ids.push(current);
        current = row[x]!;
        length = 1;
      }
    }
    lengths.push(length);
    ids.push(current);
  }
  return buildProvinceRunIndex(width, height, Uint32Array.from(lengths), Uint16Array.from(ids));
}

const identityHover = (_mapType: string, _mapId: string, pickId: string) => ({
  regionId: pickId,
  imagePath: null,
  region: { name: pickId },
});

describe("buildProvinceRegionIndex", () => {
  it("assigns holdings, then lets occupation win regardless of record order", () => {
    const data: RegionRecord = {
      Occupier: { rgb: "9,9,9", name: "Occupier", occupied_held: [7] },
      Owner: { rgb: "1,2,3", name: "Owner", provinces: [7, 8] },
    };
    const index = buildProvinceRegionIndex(data);
    expect(index.get(7)).toBe("Occupier");
    expect(index.get(8)).toBe("Owner");
  });

  it("drops mask-discarded provinces (trade's water and sea)", () => {
    const data: RegionRecord = {
      Guild: { rgb: "1,2,3", name: "Guild", provinces: [1, 2, 3] },
    };
    const mask = new Uint8Array(4);
    mask[2] = 1;
    const index = buildProvinceRegionIndex(data, mask);
    expect(index.get(1)).toBe("Guild");
    expect(index.get(2)).toBeUndefined();
    expect(index.get(3)).toBe("Guild");
    // No mask (nation) keeps water holdings.
    expect(buildProvinceRegionIndex(data).get(2)).toBe("Guild");
  });

  it("ignores non-positive and non-integer province ids", () => {
    const data: RegionRecord = {
      Odd: { rgb: "1,2,3", name: "Odd", provinces: [0, -1, 1.5, 4] },
    };
    const index = buildProvinceRegionIndex(data);
    expect([...index.entries()]).toEqual([[4, "Odd"]]);
  });
});

describe("resolveRegionAtProvincePoint", () => {
  it("picks a black realm by province id, with no colour involved", () => {
    const data: RegionRecord = {
      BlackRealm: { rgb: "0,0,0", name: "BlackRealm", provinces: [7] },
    };
    const runs = mockRunIndex([[7, 7, 0]]);
    const picked = resolveRegionAtProvincePoint(
      runs,
      1,
      0,
      buildProvinceRegionIndex(data),
      identityHover,
      "nation",
      "main",
      data,
    );
    expect(picked?.pickId).toBe("BlackRealm");
  });

  it("distinguishes two regions that share one rgb", () => {
    const data: RegionRecord = {
      First: { rgb: "5,5,5", name: "First", provinces: [1] },
      Second: { rgb: "5,5,5", name: "Second", provinces: [2] },
    };
    const runs = mockRunIndex([[1, 2]]);
    const index = buildProvinceRegionIndex(data);
    expect(resolveRegionAtProvincePoint(runs, 0, 0, index, identityHover, "nation", "main", data)?.pickId).toBe(
      "First",
    );
    expect(resolveRegionAtProvincePoint(runs, 1, 0, index, identityHover, "nation", "main", data)?.pickId).toBe(
      "Second",
    );
  });

  it("bridges a small unheld gap but not open ground beyond the reach", () => {
    const data: RegionRecord = {
      Holder: { rgb: "1,2,3", name: "Holder", provinces: [3] },
    };
    const runs = mockRunIndex([[3, 0, 0, 0, 0, 0, 0, 0, 0]]);
    const index = buildProvinceRegionIndex(data);
    // Small surfaces get the minimum reach of 2 (see water-cutout reach).
    expect(resolveRegionAtProvincePoint(runs, 2, 0, index, identityHover, "nation", "main", data)?.pickId).toBe(
      "Holder",
    );
    expect(resolveRegionAtProvincePoint(runs, 8, 0, index, identityHover, "nation", "main", data)).toBeNull();
    expect(resolveRegionAtProvincePoint(runs, 40, 0, index, identityHover, "nation", "main", data)).toBeNull();
  });

  it("falls through an invisible holder to the nearest visible region", () => {
    const data: RegionRecord = {
      Hidden: { rgb: "1,1,1", name: "Hidden", provinces: [1] },
      Visible: { rgb: "2,2,2", name: "Visible", provinces: [2] },
    };
    const runs = mockRunIndex([[1, 2]]);
    const picked = resolveRegionAtProvincePoint(
      runs,
      0,
      0,
      buildProvinceRegionIndex(data),
      (_mapType, _mapId, pickId) =>
        pickId === "Hidden"
          ? { regionId: null, imagePath: null, region: null }
          : { regionId: pickId, imagePath: null, region: { name: pickId } },
      "nation",
      "main",
      data,
    );
    expect(picked?.pickId).toBe("Visible");
  });

  it("title tiers follow the painter's chain: county -> duchy -> kingdom -> empire", () => {
    const layers: TitleLayers = {
      county: {
        CountyA: { provinces: [1, 2] },
        CountyB: { provinces: [3] },
        Orphan: { provinces: [4] },
      },
      duchy: {
        DuchyA: { titles: ["CountyA", "CountyB"], provinces: [99] },
        DuchyLonely: { titles: ["Orphan"] },
      },
      kingdom: {
        KingdomA: { titles: ["DuchyA"] },
      },
      empire: {
        EmpireA: { titles: ["KingdomA"] },
      },
    };
    const empireData: RegionRecord = { EmpireA: { rgb: "1,1,1", name: "EmpireA" } };
    const empire = buildTitleProvinceRegionIndex("empire", empireData, layers);
    expect(empire?.get(1)).toBe("EmpireA");
    expect(empire?.get(3)).toBe("EmpireA");
    // Orphan's chain stops at a kingdom-less duchy: never reaches the empire.
    expect(empire?.get(4)).toBeUndefined();
    // Direct provinces on an upper tier are not painted by the backend.
    expect(empire?.get(99)).toBeUndefined();

    const duchyData: RegionRecord = {
      DuchyA: { rgb: "2,2,2", name: "DuchyA" },
      DuchyLonely: { rgb: "3,3,3", name: "DuchyLonely" },
    };
    const duchy = buildTitleProvinceRegionIndex("duchy", duchyData, layers);
    expect(duchy?.get(2)).toBe("DuchyA");
    expect(duchy?.get(4)).toBe("DuchyLonely");

    const county = buildTitleProvinceRegionIndex(
      "county",
      { CountyA: { rgb: "4,4,4", name: "CountyA", provinces: [1, 2] } },
      null,
    );
    expect(county?.get(1)).toBe("CountyA");
  });

  it("title membership withholds while a lower tier has not loaded", () => {
    const data: RegionRecord = { DuchyA: { rgb: "2,2,2", name: "DuchyA" } };
    expect(buildTitleProvinceRegionIndex("duchy", data, null)).toBeNull();
    expect(buildTitleProvinceRegionIndex("duchy", data, { county: {} })).toBeNull();
    expect(buildTitleProvinceRegionIndex("kingdom", data, { county: {}, duchy: {} })).toBeNull();
    expect(buildTitleProvinceRegionIndex("kingdom", data, { county: {}, kingdom: {} })).toBeNull();
    expect(buildTitleProvinceRegionIndex("empire", data, { county: {}, duchy: {}, kingdom: {} })).toBeNull();
    expect(buildTitleProvinceRegionIndex("empire", data, { county: {}, kingdom: {}, empire: {} })).toBeNull();
    expect(buildTitleProvinceRegionIndex("kingdom", data, { county: {}, duchy: {}, kingdom: {} })?.size).toBe(0);
  });

  it("duplicate title ownership follows the painter's traversal order", () => {
    // Province 1 is claimed by both counties; each county has its own duchy,
    // listed opposite the county order. The painter resolves the county's
    // duchy first, then paints counties in order, so CountyB's duchy wins.
    const duchyLayers: TitleLayers = {
      county: {
        CountyA: { provinces: [1] },
        CountyB: { provinces: [1] },
      },
      duchy: {
        DuchyB: { titles: ["CountyB"] },
        DuchyA: { titles: ["CountyA"] },
      },
    };
    const duchyData: RegionRecord = {
      DuchyB: { rgb: "5,5,5", name: "DuchyB" },
      DuchyA: { rgb: "6,6,6", name: "DuchyA" },
    };
    expect(buildTitleProvinceRegionIndex("duchy", duchyData, duchyLayers)?.get(1)).toBe("DuchyB");

    // One county claimed by two duchies in different kingdoms, listed
    // opposite the duchy order: the later duchy's kingdom paints last.
    const kingdomLayers: TitleLayers = {
      county: { CountyC: { provinces: [2] } },
      duchy: {
        DuchyC1: { titles: ["CountyC"] },
        DuchyC2: { titles: ["CountyC"] },
      },
      kingdom: {
        KingdomC2: { titles: ["DuchyC2"] },
        KingdomC1: { titles: ["DuchyC1"] },
      },
    };
    const kingdomData: RegionRecord = {
      KingdomC2: { rgb: "7,7,7", name: "KingdomC2" },
      KingdomC1: { rgb: "8,8,8", name: "KingdomC1" },
    };
    expect(buildTitleProvinceRegionIndex("kingdom", kingdomData, kingdomLayers)?.get(2)).toBe("KingdomC2");
  });

  it("an unparented branch erases an earlier claim at kingdom and empire level", () => {
    // The painter walks every duchy, painting the black sentinel for ones no
    // kingdom lists; a later orphan duchy re-claiming the county erases it.
    const layers: TitleLayers = {
      county: { CountyD: { provinces: [3] } },
      duchy: {
        DuchyHeld: { titles: ["CountyD"] },
        DuchyOrphan: { titles: ["CountyD"] },
      },
      kingdom: { KingdomD: { titles: ["DuchyHeld"] } },
    };
    const kingdomData: RegionRecord = { KingdomD: { rgb: "9,9,9", name: "KingdomD" } };
    expect(buildTitleProvinceRegionIndex("kingdom", kingdomData, layers)?.get(3)).toBeUndefined();

    // Same at empire level: a kingdom no empire lists, walking after a held
    // kingdom that claims the same duchy, erases the empire's paint.
    const empireLayers: TitleLayers = {
      county: { CountyE: { provinces: [4] } },
      duchy: { DuchyE: { titles: ["CountyE"] } },
      kingdom: {
        KingdomHeld: { titles: ["DuchyE"] },
        KingdomOrphan: { titles: ["DuchyE"] },
      },
      empire: { EmpireE: { titles: ["KingdomHeld"] } },
    };
    const empireData: RegionRecord = { EmpireE: { rgb: "10,10,10", name: "EmpireE" } };
    expect(buildTitleProvinceRegionIndex("empire", empireData, empireLayers)?.get(4)).toBeUndefined();

    // With the orphan first, the parented branch's later paint stands.
    const flipped: TitleLayers = {
      ...layers,
      duchy: {
        DuchyOrphan: { titles: ["CountyD"] },
        DuchyHeld: { titles: ["CountyD"] },
      },
    };
    expect(buildTitleProvinceRegionIndex("kingdom", kingdomData, flipped)?.get(3)).toBe("KingdomD");
  });

  it("an occupier wins the point over the legal owner", () => {
    const data: RegionRecord = {
      Owner: { rgb: "1,2,3", name: "Owner", provinces: [7] },
      Occupier: { rgb: "9,9,9", name: "Occupier", occupied_held: [7] },
    };
    const runs = mockRunIndex([[7]]);
    const picked = resolveRegionAtProvincePoint(
      runs,
      0,
      0,
      buildProvinceRegionIndex(data),
      identityHover,
      "nation",
      "main",
      data,
    );
    expect(picked?.pickId).toBe("Occupier");
  });
});
