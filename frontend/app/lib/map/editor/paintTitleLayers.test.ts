import { describe, expect, it } from "vitest";

import type { TitleLayers } from "@/app/lib/titleProvinces";
import {
  resolveCountyProvinces,
  resolveDuchyProvinces,
  resolveKingdomProvinces,
} from "@/app/lib/titleProvinces";

import { buildProvincePixelIndex } from "./buildProvinceIndex";
import {
  diffCountyPaintSnapshot,
  extractCountyPaintSnapshot,
  isCountyPaintDiffEmpty,
} from "./editorPaintSnapshot";
import {
  fillProvincePixels,
  paintParentActiveLayerFull,
  paintPixelIndices,
  paintSelectionLayerFull,
  updateCountyActiveSubset,
  updateCountySelectionSubset,
} from "./paintTitleLayers";

function makeImageData(
  width: number,
  height: number
): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

const fixtureLayers: TitleLayers = {
  county: {
    COUNTY_1: { provinces: [1, 2] },
    COUNTY_2: { provinces: [3, 4] },
  },
  duchy: {
    DUCHY_1: { titles: ["COUNTY_1"] },
    DUCHY_2: { titles: ["COUNTY_2"] },
  },
  kingdom: {
    KINGDOM_1: { titles: ["DUCHY_1"] },
    KINGDOM_2: { titles: ["DUCHY_2"] },
  },
};

describe("buildProvincePixelIndex", () => {
  it("maps province ids to pixel offsets on a 2x2 fixture", () => {
    const provinceMap = new Int32Array([1, -1, 1, 2]);
    const pixelIndex = buildProvincePixelIndex(provinceMap);

    expect(Array.from(pixelIndex.get(1)!)).toEqual([0, 2]);
    expect(Array.from(pixelIndex.get(2)!)).toEqual([3]);
    expect(pixelIndex.has(-1)).toBe(false);
  });
});

describe("paintPixelIndices", () => {
  it("changes only target pixels", () => {
    const imageData = makeImageData(2, 2);
    const indices = Uint32Array.from([0, 2]);

    paintPixelIndices(imageData, indices, [160, 80, 200]);

    expect(imageData.data[0]).toBe(160);
    expect(imageData.data[1]).toBe(80);
    expect(imageData.data[2]).toBe(200);
    expect(imageData.data[4]).toBe(0);
    expect(imageData.data[8]).toBe(160);
    expect(imageData.data[12]).toBe(0);
  });
});

describe("paintTitleLayers", () => {
  it("fillProvincePixels sets expected pixel colour", () => {
    const provinceMap = new Int32Array([1, -1, 1, 2]);
    const imageData = makeImageData(2, 2);

    fillProvincePixels(imageData, provinceMap, [1], [160, 80, 200]);

    expect(imageData.data[0]).toBe(160);
    expect(imageData.data[1]).toBe(80);
    expect(imageData.data[2]).toBe(200);
    expect(imageData.data[4]).toBe(0);
    expect(imageData.data[5]).toBe(0);
    expect(imageData.data[6]).toBe(0);
  });

  it("fillProvincePixels layers active and selection colours", () => {
    const provinceMap = new Int32Array([1, 2, 1, 2]);
    const imageData = makeImageData(2, 2);

    fillProvincePixels(imageData, provinceMap, [1], [180, 80, 80]);
    fillProvincePixels(imageData, provinceMap, [2], [160, 80, 200]);

    expect(imageData.data[0]).toBe(180);
    expect(imageData.data[1]).toBe(80);
    expect(imageData.data[2]).toBe(80);

    expect(imageData.data[4]).toBe(160);
    expect(imageData.data[5]).toBe(80);
    expect(imageData.data[6]).toBe(200);
  });

  it("updateCountySelectionSubset matches full paint for changed county rgb", () => {
    const provinceMap = new Int32Array([1, 2, 1, 2]);
    const pixelIndex = buildProvincePixelIndex(provinceMap);
    const provinceToRgb: Record<number, string> = {
      1: "10,20,30",
      2: "40,50,60",
    };
    const provinceToCounty = new Map<number, string>([
      [1, "COUNTY_1"],
      [2, "COUNTY_1"],
    ]);

    const fullColors = { COUNTY_1: "180,80,80" };
    const fullImage = makeImageData(2, 2);
    paintSelectionLayerFull(
      fullImage,
      provinceMap,
      provinceToRgb,
      provinceToCounty,
      fullColors
    );

    const subsetImage = makeImageData(2, 2);
    updateCountySelectionSubset(
      subsetImage,
      pixelIndex,
      [1, 2],
      provinceToRgb,
      provinceToCounty,
      fullColors
    );

    expect(Array.from(subsetImage.data)).toEqual(Array.from(fullImage.data));
  });

  it("updateCountyActiveSubset paints only toggled province pixels", () => {
    const provinceMap = new Int32Array([1, 2, 1, 2]);
    const pixelIndex = buildProvincePixelIndex(provinceMap);
    const imageData = makeImageData(2, 2);

    updateCountyActiveSubset(imageData, pixelIndex, [1], "180,80,80", []);

    expect(imageData.data[0]).toBe(180);
    expect(imageData.data[4]).toBe(0);
    expect(imageData.data[8]).toBe(180);
    expect(imageData.data[12]).toBe(0);
  });

  it("paintParentActiveLayerFull paints member county provinces with duchy rgb", () => {
    const provinceMap = new Int32Array([1, 2, 3, 4]);
    const painted = makeImageData(2, 2);

    const countyDraft = {
      COUNTY_1: { rgb: "58,132,60", provinces: [1, 2] },
      COUNTY_2: { rgb: "40,123,42", provinces: [3] },
    };

    paintParentActiveLayerFull(
      painted,
      provinceMap,
      ["COUNTY_1"],
      "180,80,80",
      resolveCountyProvinces,
      { county: countyDraft }
    );

    expect(painted.data[0]).toBe(180);
    expect(painted.data[1]).toBe(80);
    expect(painted.data[2]).toBe(80);
    expect(painted.data[12]).toBe(0);
  });

  it("paintParentActiveLayerFull paints kingdom members via resolveDuchyProvinces", () => {
    const provinceMap = new Int32Array([1, 2, 3, 4]);
    const painted = makeImageData(2, 2);

    paintParentActiveLayerFull(
      painted,
      provinceMap,
      ["DUCHY_1"],
      "200,100,50",
      resolveDuchyProvinces,
      fixtureLayers
    );

    expect(painted.data[0]).toBe(200);
    expect(painted.data[1]).toBe(100);
    expect(painted.data[2]).toBe(50);
    expect(painted.data[4]).toBe(200);
    expect(painted.data[12]).toBe(0);
  });

  it("paintParentActiveLayerFull unions multiple kingdom members for empire", () => {
    const provinceMap = new Int32Array([1, 2, 3, 4]);
    const painted = makeImageData(2, 2);

    paintParentActiveLayerFull(
      painted,
      provinceMap,
      ["KINGDOM_1", "KINGDOM_2"],
      "90,60,120",
      resolveKingdomProvinces,
      fixtureLayers
    );

    expect(painted.data[0]).toBe(90);
    expect(painted.data[4]).toBe(90);
    expect(painted.data[8]).toBe(90);
    expect(painted.data[12]).toBe(90);
  });
});

describe("editorPaintSnapshot", () => {
  it("skips paint diff when only the name changes", () => {
    const draft = {
      COUNTY_1: { name: "Elvaris", rgb: "180,80,80", provinces: [1, 2] },
    };
    const prev = extractCountyPaintSnapshot(draft, "COUNTY_1");
    const next = extractCountyPaintSnapshot(
      {
        COUNTY_1: { name: "Elvaris Prime", rgb: "180,80,80", provinces: [1, 2] },
      },
      "COUNTY_1"
    );

    const diff = diffCountyPaintSnapshot(prev, next);
    expect(diff).not.toBeNull();
    expect(isCountyPaintDiffEmpty(diff!)).toBe(true);
  });
});
