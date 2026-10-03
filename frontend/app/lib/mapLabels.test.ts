import { describe, expect, it } from "vitest";

import {
  LABEL_GLYPH_WIDTH_EM,
  LABEL_PATH_OVERSHOOT_RATIO,
  MIN_PIXEL_AREA,
  MIN_PROVINCES,
  cleanRegionName,
  componentPixelArea,
  computeNationLabels,
  computeRegionLabelGeometry,
  computeVisibleNationLabels,
  filterRegionLabelsForMapObjects,
  computeVisibleRegionLabels,
  connectedComponents,
  directHoldingProvinces,
  estimatedLabelWidthPx,
  extendLabelEndpoints,
  fontSizeForLabel,
  fullRealmProvinces,
  graphDiameterEndpoints,
  isDrilledSuzerainView,
  isNationLabelVisible,
  labelAngleDeg,
  labelArcPathD,
  labelPathCenterOffset,
  labelsForProvinces,
  labelControlProvinces,
  orientLabelEndpoints,
  pixelDiameterEndpoints,
  provincesForNationLabel,
  segmentPixelLength,
  LABEL_MIN_SCREEN_PX,
  labelScreenFontSize,
  shouldShowLabelAtScreenSize,
  LABEL_MAX_SCREEN_PX,
  type LabelMapObject,
  type ProvinceCentroids,
  type ProvinceNeighbors,
} from "./mapLabels";
import type { ProvinceLabelGrid } from "./labelBlobGeometry";
import type { TitleLayers } from "./titleProvinces";

const chainNeighbors: ProvinceNeighbors = {
  "1": [2],
  "2": [1, 3],
  "3": [2],
};

const chainCentroids: ProvinceCentroids = {
  "1": { x: 0, y: 0, pixel_count: 6000 },
  "2": { x: 100, y: 0, pixel_count: 6000 },
  "3": { x: 200, y: 0, pixel_count: 6000 },
};

describe("connectedComponents", () => {
  it("splits disconnected province sets", () => {
    const neighbors: ProvinceNeighbors = {
      "1": [2, 3],
      "2": [1, 3],
      "3": [1, 2],
      "10": [11, 12],
      "11": [10, 12],
      "12": [10, 11],
    };

    const components = connectedComponents([1, 2, 3, 10, 11, 12], neighbors);
    expect(components).toHaveLength(2);
    expect(components.map((c) => [...c].sort())).toEqual([
      [1, 2, 3],
      [10, 11, 12],
    ]);
  });

  it("merges components when label neighbors bridge a water gap", () => {
    const strictNeighbors: ProvinceNeighbors = {
      "1": [2, 3],
      "2": [1, 3],
      "3": [1, 2],
      "10": [11, 12],
      "11": [10, 12],
      "12": [10, 11],
    };
    const labelNeighbors: ProvinceNeighbors = {
      ...strictNeighbors,
      "3": [1, 2, 12],
      "12": [10, 11, 3],
    };

    const components = connectedComponents(
      [1, 2, 3, 10, 11, 12],
      labelNeighbors
    );
    expect(components).toHaveLength(1);
    expect(components[0].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 10, 11, 12,
    ]);
  });
});

describe("graphDiameterEndpoints", () => {
  it("returns chain ends for a linear graph", () => {
    expect(graphDiameterEndpoints([1, 2, 3], chainNeighbors)).toEqual([1, 3]);
  });

  it("returns the same province for a singleton component", () => {
    expect(graphDiameterEndpoints([5], {})).toEqual([5, 5]);
  });
});

describe("pixelDiameterEndpoints", () => {
  it("picks geometric extremes on an L-shaped blob, not graph-hop shortcuts", () => {
    const neighbors: ProvinceNeighbors = {
      "1": [2],
      "2": [1, 3, 4],
      "3": [2],
      "4": [2],
    };
    const centroids: ProvinceCentroids = {
      "1": { x: 0, y: 0, pixel_count: 6000 },
      "2": { x: 100, y: 0, pixel_count: 6000 },
      "3": { x: 100, y: 100, pixel_count: 6000 },
      "4": { x: 200, y: 0, pixel_count: 6000 },
    };

    expect(graphDiameterEndpoints([1, 2, 3, 4], neighbors)).toEqual([1, 3]);
    expect(pixelDiameterEndpoints([1, 2, 3, 4], centroids)).toEqual([1, 4]);
  });
});

describe("labelPathCenterOffset", () => {
  it("shifts arched text toward the chord on a horizontal axis", () => {
    const fontSize = 40;
    const { dx, dy } = labelPathCenterOffset(0, 100, 200, 100, fontSize);
    expect(dx).toBeCloseTo(0);
    expect(dy).toBeGreaterThan(0);
    expect(dy).toBeCloseTo(200 * 0.08 * 0.5 + fontSize * 0.38);
  });
});

describe("labelArcPathD", () => {
  it("bows upward on a horizontal chord", () => {
    const path = labelArcPathD(0, 100, 200, 100);
    expect(path).toMatch(/^M 0 100 Q [\d.]+ [\d.]+ 200 100$/);
    const controlY = Number(path.split(" ")[5]);
    expect(controlY).toBeLessThan(100);
  });

  it("reverses endpoints when the chord would read upside down", () => {
    const path = labelArcPathD(200, 50, 0, 50);
    expect(path.startsWith("M 0 50")).toBe(true);
    expect(path.endsWith("200 50")).toBe(true);
  });
});

describe("extendLabelEndpoints", () => {
  it("grows the chord about its midpoint without turning it", () => {
    const extended = extendLabelEndpoints(0, 100, 200, 100, 0.3);

    expect(extended).toEqual({ x1: -30, y1: 100, x2: 230, y2: 100 });
    // Midpoint and direction are what `cx`/`cy`/`angleDeg` are read from.
    expect((extended.x1 + extended.x2) / 2).toBe(100);
    expect((extended.y1 + extended.y2) / 2).toBe(100);
  });

  it("grows a diagonal chord along its own axis", () => {
    const extended = extendLabelEndpoints(0, 0, 60, 80, 0.5);

    expect(labelAngleDeg(extended.x1, extended.y1, extended.x2, extended.y2))
      .toBeCloseTo(labelAngleDeg(0, 0, 60, 80), 5);
    expect(
      segmentPixelLength(extended.x1, extended.y1, extended.x2, extended.y2)
    ).toBeCloseTo(100 * 1.5, 5);
  });

  it("leaves a degenerate chord and a zero ratio alone", () => {
    expect(extendLabelEndpoints(5, 5, 5, 5, 0.3)).toEqual({
      x1: 5,
      y1: 5,
      x2: 5,
      y2: 5,
    });
    expect(extendLabelEndpoints(0, 0, 10, 0, 0)).toEqual({
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 0,
    });
  });
});

describe("orientLabelEndpoints", () => {
  it("swaps when the raw angle points left", () => {
    expect(orientLabelEndpoints(100, 0, 0, 0)).toEqual({
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 0,
    });
  });
});

describe("fontSizeForLabel", () => {
  it("scales fontSize from segment length and character count", () => {
    expect(fontSizeForLabel(600, "Nimbus")).toBe(
      Math.round(600 / (6 * LABEL_GLYPH_WIDTH_EM))
    );
    expect(fontSizeForLabel(200, "Test")).toBe(
      Math.round(200 / (4 * LABEL_GLYPH_WIDTH_EM))
    );
  });

  it("estimates rendered width near segment length", () => {
    const fontSize = fontSizeForLabel(500, "Grand Drakhanate");
    expect(estimatedLabelWidthPx(fontSize, "Grand Drakhanate")).toBeCloseTo(
      500,
      -1
    );
  });

  it("uses one unit for empty names", () => {
    expect(fontSizeForLabel(80, "   ")).toBe(
      Math.round(80 / LABEL_GLYPH_WIDTH_EM)
    );
  });
});

describe("componentPixelArea", () => {
  it("sums pixel_count across provinces", () => {
    expect(componentPixelArea([1, 2], chainCentroids)).toBe(12000);
  });
});

describe("shouldShowLabelAtScreenSize", () => {
  it("computes screen font size from map size and display scale", () => {
    expect(labelScreenFontSize(40, 0.5)).toBe(20);
  });

  it("shows labels at or above the minimum screen size", () => {
    const displayScale = 0.5;
    const minFont = LABEL_MIN_SCREEN_PX / displayScale;
    expect(shouldShowLabelAtScreenSize(minFont, displayScale)).toBe(true);
    expect(shouldShowLabelAtScreenSize(minFont + 1, displayScale)).toBe(true);
    expect(
      shouldShowLabelAtScreenSize(minFont - 1, displayScale)
    ).toBe(false);
  });

  it("keeps large labels visible when zoomed in", () => {
    const displayScale = 1;
    expect(shouldShowLabelAtScreenSize(80, displayScale)).toBe(true);
    expect(shouldShowLabelAtScreenSize(24, displayScale)).toBe(true);
  });

  it("hides labels once they would fill the screen", () => {
    expect(shouldShowLabelAtScreenSize(LABEL_MAX_SCREEN_PX, 1)).toBe(true);
    expect(shouldShowLabelAtScreenSize(LABEL_MAX_SCREEN_PX + 1, 1)).toBe(false);
    expect(shouldShowLabelAtScreenSize(80, 2)).toBe(false);
  });

  it("hides labels when display scale is zero", () => {
    expect(shouldShowLabelAtScreenSize(24, 0)).toBe(false);
  });
});

describe("labelAngleDeg", () => {
  it("returns ~0 for horizontal segments", () => {
    expect(labelAngleDeg(0, 0, 100, 0)).toBeCloseTo(0, 5);
  });

  it("returns ~90 for upward vertical segments", () => {
    expect(labelAngleDeg(0, 100, 0, 0)).toBeCloseTo(90, 5);
  });
});

describe("computeNationLabels", () => {
  it("places one label along a three-province chain", () => {
    const labels = computeNationLabels(
      { TestNation: { name: "Test", provinces: [1, 2, 3] } },
      chainNeighbors,
      chainCentroids,
      { minPixelArea: 10000 }
    );

    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      nationId: "TestNation",
      componentIndex: 0,
      text: "Test",
      x1: 0,
      y1: 0,
      x2: 200,
      y2: 0,
      cx: 100,
      cy: 0,
      segmentPx: 200,
      fontSize: fontSizeForLabel(200, "Test"),
    });
    expect(labels[0].angleDeg).toBeCloseTo(0, 5);
    expect(labels[0].pathD).toContain("Q");
  });

  it("sets the name along a baseline longer than the chord it measured", () => {
    // Regression: text sized to exactly the chord overran it, and SVG drops
    // glyphs falling off a textPath rather than shrinking them, so short
    // all-caps names lost their first letter (`COUNTY_45` as `OUNTY_45`).
    const labels = computeNationLabels(
      { TestNation: { name: "COUNTY_45", provinces: [1, 2, 3] } },
      chainNeighbors,
      chainCentroids,
      { minPixelArea: 10000 }
    );

    expect(labels).toHaveLength(1);
    const label = labels[0];

    const [startX, startY, endX, endY] = [
      Number(label.pathD.split(" ")[1]),
      Number(label.pathD.split(" ")[2]),
      Number(label.pathD.split(" ")[6]),
      Number(label.pathD.split(" ")[7]),
    ];
    expect(segmentPixelLength(startX, startY, endX, endY)).toBeCloseTo(
      200 * (1 + LABEL_PATH_OVERSHOOT_RATIO),
      5
    );
    expect(
      segmentPixelLength(startX, startY, endX, endY)
    ).toBeGreaterThan(estimatedLabelWidthPx(label.fontSize, label.text));

    // Sizing and placement still describe the real chord: hover scaling and the
    // GIF export's flat re-layout read these, not `pathD`.
    expect(label.segmentPx).toBe(200);
    expect(label.fontSize).toBe(fontSizeForLabel(200, "COUNTY_45"));
    expect(label.cx).toBe(100);
    expect(label.cy).toBe(0);
    expect(label.x1).toBe(0);
    expect(label.x2).toBe(200);
  });

  it("emits two labels for two large disconnected components", () => {
    const neighbors: ProvinceNeighbors = {
      "1": [2, 3],
      "2": [1, 3],
      "3": [1, 2],
      "10": [11, 12],
      "11": [10, 12],
      "12": [10, 11],
    };
    const centroids: ProvinceCentroids = {
      "1": { x: 0, y: 0, pixel_count: 6000 },
      "2": { x: 10, y: 0, pixel_count: 6000 },
      "3": { x: 20, y: 0, pixel_count: 6000 },
      "10": { x: 100, y: 100, pixel_count: 6000 },
      "11": { x: 110, y: 100, pixel_count: 6000 },
      "12": { x: 120, y: 100, pixel_count: 6000 },
    };

    const labels = computeNationLabels(
      { ExclaveNation: { name: "Exclave", provinces: [1, 2, 3, 10, 11, 12] } },
      neighbors,
      centroids,
      { minPixelArea: 10000 }
    );

    expect(labels).toHaveLength(2);
    expect(labels[0].componentIndex).toBe(0);
    expect(labels[1].componentIndex).toBe(1);
    expect(labels.every((l) => l.text === "Exclave")).toBe(true);
  });

  it("labels two-province blobs when above minPixelArea", () => {
    const labels = computeNationLabels(
      { Tiny: { name: "Tiny", provinces: [1, 2] } },
      { "1": [2], "2": [1] },
      {
        "1": { x: 0, y: 0, pixel_count: 8000 },
        "2": { x: 10, y: 0, pixel_count: 8000 },
      }
    );

    expect(labels).toHaveLength(1);
    expect(MIN_PROVINCES).toBe(1);
    expect(labels[0].segmentPx).toBeGreaterThan(0);
  });

  it("labels single-province blob via radial fallback when grid is available", () => {
    const grid: ProvinceLabelGrid = {
      mapWidth: 70,
      mapHeight: 30,
      gridWidth: 7,
      gridHeight: 3,
      cells: new Uint16Array([
        0, 1, 1, 1, 1, 1, 0,
        0, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0,
      ]),
      scaleX: 10,
      scaleY: 10,
    };

    const labels = labelsForProvinces(
      "Island",
      "Island",
      [1],
      {},
      { "1": { x: 35, y: 15, pixel_count: 20000 } },
      "full",
      { grid, minPixelArea: 10000 }
    );

    expect(labels).toHaveLength(1);
    expect(labels[0].segmentPx).toBeGreaterThan(0);
  });

  it("skips components below minPixelArea threshold", () => {
    const labels = computeNationLabels(
      { Small: { name: "Small", provinces: [1, 2, 3] } },
      chainNeighbors,
      {
        "1": { x: 0, y: 0, pixel_count: 1000 },
        "2": { x: 10, y: 0, pixel_count: 1000 },
        "3": { x: 20, y: 0, pixel_count: 1000 },
      },
      { minPixelArea: MIN_PIXEL_AREA }
    );

    expect(labels).toHaveLength(0);
  });

  it("skips nations without a name", () => {
    const labels = computeNationLabels(
      { NoName: { provinces: [1, 2, 3] } },
      chainNeighbors,
      chainCentroids,
      { minPixelArea: 10000 }
    );

    expect(labels).toHaveLength(0);
  });

  it("ignores provinces missing centroids", () => {
    const labels = computeNationLabels(
      { Partial: { name: "Partial", provinces: [1, 2, 3, 99] } },
      chainNeighbors,
      chainCentroids,
      { minPixelArea: 10000 }
    );

    expect(labels).toHaveLength(1);
    expect(graphDiameterEndpoints([1, 2, 3], chainNeighbors)).toEqual([1, 3]);
  });

  it("assigns larger fontSize to wider blobs", () => {
    const neighbors: ProvinceNeighbors = {
      "1": [2],
      "2": [1, 3],
      "3": [2],
      "10": [11],
      "11": [10, 12],
      "12": [11],
    };
    const centroids: ProvinceCentroids = {
      "1": { x: 0, y: 0, pixel_count: 6000 },
      "2": { x: 50, y: 0, pixel_count: 6000 },
      "3": { x: 100, y: 0, pixel_count: 6000 },
      "10": { x: 0, y: 0, pixel_count: 6000 },
      "11": { x: 300, y: 0, pixel_count: 6000 },
      "12": { x: 600, y: 0, pixel_count: 6000 },
    };

    const labels = labelsForProvinces(
      "Sized",
      "Sized",
      [1, 2, 3, 10, 11, 12],
      neighbors,
      centroids,
      "full",
      { minPixelArea: 10000 }
    );

    expect(labels).toHaveLength(2);
    const smallBlob = labels.find((label) => label.componentIndex === 0);
    const largeBlob = labels.find((label) => label.componentIndex === 1);
    expect(smallBlob?.segmentPx).toBe(100);
    expect(largeBlob?.segmentPx).toBe(600);
    expect(largeBlob!.fontSize).toBeGreaterThan(smallBlob!.fontSize);
  });

  it("uses labelNeighbors for component grouping when provided", () => {
    const strictNeighbors: ProvinceNeighbors = {
      "1": [2, 3],
      "2": [1, 3],
      "3": [1, 2],
      "10": [11, 12],
      "11": [10, 12],
      "12": [10, 11],
    };
    const labelNeighbors: ProvinceNeighbors = {
      ...strictNeighbors,
      "3": [1, 2, 12],
      "12": [10, 11, 3],
    };
    const centroids: ProvinceCentroids = {
      "1": { x: 0, y: 0, pixel_count: 6000 },
      "2": { x: 50, y: 0, pixel_count: 6000 },
      "3": { x: 100, y: 0, pixel_count: 6000 },
      "10": { x: 500, y: 0, pixel_count: 6000 },
      "11": { x: 550, y: 0, pixel_count: 6000 },
      "12": { x: 600, y: 0, pixel_count: 6000 },
    };

    const labels = labelsForProvinces(
      "Bridged",
      "Bridged",
      [1, 2, 3, 10, 11, 12],
      strictNeighbors,
      centroids,
      "full",
      { minPixelArea: 10000, labelNeighbors }
    );

    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe("Bridged");
  });
});

const empireNeighbors: ProvinceNeighbors = {
  "1": [2],
  "2": [1, 3],
  "3": [2],
  "4": [5],
  "5": [4, 6],
  "6": [5],
  "7": [8],
  "8": [7],
  "10": [11],
  "11": [10, 12],
  "12": [11],
};

const empireCentroids: ProvinceCentroids = {
  "1": { x: 0, y: 0, pixel_count: 6000 },
  "2": { x: 100, y: 0, pixel_count: 6000 },
  "3": { x: 200, y: 0, pixel_count: 6000 },
  "4": { x: 300, y: 0, pixel_count: 6000 },
  "5": { x: 400, y: 0, pixel_count: 6000 },
  "6": { x: 500, y: 0, pixel_count: 6000 },
  "7": { x: 300, y: 200, pixel_count: 6000 },
  "8": { x: 400, y: 200, pixel_count: 6000 },
  "10": { x: 0, y: 100, pixel_count: 6000 },
  "11": { x: 100, y: 100, pixel_count: 6000 },
  "12": { x: 200, y: 100, pixel_count: 6000 },
};

const empireRegionData = {
  imperium: {
    name: "Grand Drakhanate",
    provinces: [1, 2, 3],
    subjects: ["vassalA"],
  },
  vassalA: {
    name: "Verdant City",
    provinces: [4, 5, 6],
    subjects: ["vassalB"],
  },
  vassalB: {
    name: "Nested Isle",
    provinces: [7, 8],
  },
  independent: {
    name: "Nimbus",
    provinces: [10, 11, 12],
  },
};

const overviewMapObjects: LabelMapObject[] = [
  { id: "imperium", visible: true },
  { id: "imperium_nested", visible: false },
  { id: "vassalA", visible: false },
  { id: "independent", visible: true },
];

const drilledMapObjects: LabelMapObject[] = [
  { id: "imperium", visible: false },
  { id: "imperium_nested", visible: true },
  { id: "vassalA", visible: true },
  { id: "independent", visible: true },
];

describe("label visibility helpers", () => {
  it("detects visible nations from main or nested overlays", () => {
    expect(isNationLabelVisible("imperium", overviewMapObjects)).toBe(true);
    expect(isNationLabelVisible("vassalA", overviewMapObjects)).toBe(false);
    expect(isNationLabelVisible("imperium", drilledMapObjects)).toBe(true);
    expect(isNationLabelVisible("vassalA", drilledMapObjects)).toBe(true);
  });

  it("detects drilled suzerain nested view", () => {
    expect(isDrilledSuzerainView("imperium", overviewMapObjects)).toBe(false);
    expect(isDrilledSuzerainView("imperium", drilledMapObjects)).toBe(true);
    expect(isDrilledSuzerainView("vassalA", drilledMapObjects)).toBe(false);
  });

  it("returns direct holdings without subject provinces", () => {
    expect(directHoldingProvinces("imperium", empireRegionData)).toEqual([
      1, 2, 3,
    ]);
  });

  it("unions direct holdings with recursive subject provinces for full realm", () => {
    expect(fullRealmProvinces("imperium", empireRegionData)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(fullRealmProvinces("independent", empireRegionData)).toEqual([
      10, 11, 12,
    ]);
  });

  it("resolves full provinces at overview and direct provinces when drilled", () => {
    expect(
      provincesForNationLabel("imperium", empireRegionData, overviewMapObjects)
    ).toEqual({
      provinces: [1, 2, 3, 4, 5, 6, 7, 8],
      scope: "full",
    });
    expect(
      provincesForNationLabel("imperium", empireRegionData, drilledMapObjects)
    ).toEqual({
      provinces: [1, 2, 3],
      scope: "direct",
    });
    expect(
      provincesForNationLabel("vassalA", empireRegionData, overviewMapObjects)
    ).toBeNull();
  });

  it("moves occupied provinces from de jure owner to occupier for labels", () => {
    const occupiedData = {
      loyalists: {
        name: "Lantan",
        provinces: [1, 2, 3],
      },
      rebels: {
        name: "Lantan Rebels",
        provinces: [10, 11, 12],
        occupied_held: [3],
      },
    };
    const overview: LabelMapObject[] = [
      { id: "loyalists", visible: true },
      { id: "rebels", visible: true },
    ];
    expect(labelControlProvinces("loyalists", occupiedData, [1, 2, 3])).toEqual([
      1, 2,
    ]);
    expect(labelControlProvinces("rebels", occupiedData, [10, 11, 12])).toEqual([
      10, 11, 12, 3,
    ]);
    expect(provincesForNationLabel("loyalists", occupiedData, overview)).toEqual({
      provinces: [1, 2],
      scope: "full",
    });
    expect(provincesForNationLabel("rebels", occupiedData, overview)).toEqual({
      provinces: [10, 11, 12, 3],
      scope: "full",
    });
  });
});

describe("computeVisibleNationLabels", () => {
  it("labels visible independent nations and skips hidden vassals at overview", () => {
    const labels = computeVisibleNationLabels(
      empireRegionData,
      empireNeighbors,
      empireCentroids,
      overviewMapObjects,
      { minPixelArea: 10000 }
    );

    const nationIds = labels.map((label) => label.nationId);
    expect(nationIds).toContain("imperium");
    expect(nationIds).toContain("independent");
    expect(nationIds).not.toContain("vassalA");

    const empireLabels = labels.filter((label) => label.nationId === "imperium");
    expect(empireLabels).toHaveLength(3);
    expect(empireLabels.every((label) => label.scope === "full")).toBe(true);
    expect(empireLabels.every((label) => label.text === "Grand Drakhanate")).toBe(
      true
    );

    const directBlob = empireLabels.find((label) => label.x2 === 200 && label.x1 === 0);
    const vassalBlob = empireLabels.find((label) => label.x2 === 500);
    const nestedBlob = empireLabels.find(
      (label) => label.x1 === 300 && label.x2 === 400
    );
    expect(directBlob?.segmentPx).toBe(200);
    expect(vassalBlob?.segmentPx).toBe(200);
    expect(nestedBlob?.segmentPx).toBe(100);
    expect(vassalBlob?.fontSize).toBe(
      fontSizeForLabel(200, "Grand Drakhanate")
    );

    const nimbusLabel = labels.find((label) => label.nationId === "independent");
    expect(nimbusLabel!.fontSize).toBe(fontSizeForLabel(200, "Nimbus"));
  });

  it("labels visible subjects and uses direct holdings for drilled suzerain", () => {
    const labels = computeVisibleNationLabels(
      empireRegionData,
      empireNeighbors,
      empireCentroids,
      drilledMapObjects,
      { minPixelArea: 10000 }
    );

    const nationIds = labels.map((label) => label.nationId);
    expect(nationIds).toContain("imperium");
    expect(nationIds).toContain("vassalA");
    expect(nationIds).toContain("independent");

    const empireLabel = labels.find((label) => label.nationId === "imperium");
    expect(empireLabel?.scope).toBe("direct");
    expect(empireLabel?.x2).toBe(200);

    const vassalLabel = labels.find((label) => label.nationId === "vassalA");
    expect(vassalLabel?.scope).toBe("full");
    expect(vassalLabel?.x2).toBe(500);
  });

  it("returns no labels when nothing is visible", () => {
    const hiddenObjects: LabelMapObject[] = [
      { id: "imperium", visible: false },
      { id: "imperium_nested", visible: false },
      { id: "vassalA", visible: false },
      { id: "independent", visible: false },
    ];

    expect(
      computeVisibleNationLabels(
        empireRegionData,
        empireNeighbors,
        empireCentroids,
        hiddenObjects,
        { minPixelArea: 10000 }
      )
    ).toEqual([]);
  });
});

describe("region label geometry cache", () => {
  const nationOptions = { minPixelArea: 10000 };

  it("filter matches computeVisibleRegionLabels at overview", () => {
    const geometry = computeRegionLabelGeometry(
      "nation",
      empireRegionData,
      null,
      empireNeighbors,
      empireCentroids,
      nationOptions
    );
    const filtered = filterRegionLabelsForMapObjects(
      geometry,
      "nation",
      overviewMapObjects
    );
    const direct = computeVisibleRegionLabels(
      "nation",
      empireRegionData,
      null,
      empireNeighbors,
      empireCentroids,
      overviewMapObjects,
      nationOptions
    );

    expect(filtered).toEqual(direct);
  });

  it("filter matches computeVisibleRegionLabels when drilled", () => {
    const geometry = computeRegionLabelGeometry(
      "nation",
      empireRegionData,
      null,
      empireNeighbors,
      empireCentroids,
      nationOptions
    );
    const filtered = filterRegionLabelsForMapObjects(
      geometry,
      "nation",
      drilledMapObjects
    );
    const direct = computeVisibleRegionLabels(
      "nation",
      empireRegionData,
      null,
      empireNeighbors,
      empireCentroids,
      drilledMapObjects,
      nationOptions
    );

    expect(filtered).toEqual(direct);
  });

  it("reuses geometry when only mapObjects visibility changes", () => {
    const geometry = computeRegionLabelGeometry(
      "nation",
      empireRegionData,
      null,
      empireNeighbors,
      empireCentroids,
      nationOptions
    );
    const overview = filterRegionLabelsForMapObjects(
      geometry,
      "nation",
      overviewMapObjects
    );
    const drilled = filterRegionLabelsForMapObjects(
      geometry,
      "nation",
      drilledMapObjects
    );

    expect(overview).not.toEqual(drilled);
    expect(
      overview.some((label) => label.nationId === "imperium" && label.scope === "full")
    ).toBe(true);
    expect(
      drilled.some(
        (label) => label.nationId === "imperium" && label.scope === "direct"
      )
    ).toBe(true);
  });
});

describe("cleanRegionName", () => {
  it("strips Minecraft colour codes", () => {
    expect(cleanRegionName("§x§a§3§a§1§8§4Revenor")).toBe("Revenor");
    expect(cleanRegionName("§cOld §lName")).toBe("Old Name");
  });
});

const titleLabelLayers: TitleLayers = {
  county: {
    COUNTY_1: { provinces: [1, 2, 3] },
    COUNTY_2: { provinces: [4, 5] },
    COUNTY_A: { provinces: [1, 2, 3] },
    COUNTY_B: { provinces: [10, 11, 12] },
  },
  duchy: {
    DUCHY_1: { titles: ["COUNTY_1", "COUNTY_2"] },
    DUCHY_EX: { titles: ["COUNTY_A", "COUNTY_B"] },
  },
  kingdom: {
    KINGDOM_1: { titles: ["DUCHY_1"] },
    KINGDOM_EXCLAVE: { titles: ["DUCHY_EX"] },
  },
};

const titleRegionData = {
  COUNTY_1: { name: "Elvaris", rgb: "180,80,80", provinces: [1, 2, 3] },
  KINGDOM_1: { name: "Revenor", rgb: "140,69,56" },
  KINGDOM_EXCLAVE: { name: "Exclave Realm", rgb: "10,20,30" },
};

const exclaveNeighbors: ProvinceNeighbors = {
  "1": [2, 3],
  "2": [1, 3],
  "3": [1, 2],
  "10": [11, 12],
  "11": [10, 12],
  "12": [10, 11],
};

const exclaveCentroids: ProvinceCentroids = {
  "1": { x: 0, y: 0, pixel_count: 6000 },
  "2": { x: 50, y: 0, pixel_count: 6000 },
  "3": { x: 100, y: 0, pixel_count: 6000 },
  "10": { x: 500, y: 0, pixel_count: 6000 },
  "11": { x: 550, y: 0, pixel_count: 6000 },
  "12": { x: 600, y: 0, pixel_count: 6000 },
};

describe("computeVisibleRegionLabels", () => {
  it("labels county mode from county provinces", () => {
    const labels = computeVisibleRegionLabels(
      "county",
      titleRegionData,
      titleLabelLayers,
      chainNeighbors,
      chainCentroids,
      [],
      { minPixelArea: 1000, minProvinces: 3 }
    );

    expect(labels).toHaveLength(1);
    expect(labels[0].nationId).toBe("COUNTY_1");
    expect(labels[0].text).toBe("Elvaris");
  });

  it("labels county mode without title layers", () => {
    const labels = computeVisibleRegionLabels(
      "county",
      titleRegionData,
      null,
      chainNeighbors,
      chainCentroids,
      [],
      { minPixelArea: 1000, minProvinces: 3 }
    );

    expect(labels).toHaveLength(1);
    expect(labels[0].nationId).toBe("COUNTY_1");
  });

  it("labels kingdom mode via duchy rollup", () => {
    const labels = computeVisibleRegionLabels(
      "kingdom",
      titleRegionData,
      titleLabelLayers,
      chainNeighbors,
      chainCentroids,
      [],
      { minPixelArea: 1000, minProvinces: 3 }
    );

    const revenor = labels.find((label) => label.nationId === "KINGDOM_1");
    expect(revenor).toBeDefined();
    expect(revenor!.text).toBe("Revenor");
  });

  it("creates separate labels per connected component for exclaves", () => {
    const labels = computeVisibleRegionLabels(
      "kingdom",
      titleRegionData,
      titleLabelLayers,
      exclaveNeighbors,
      exclaveCentroids,
      [],
      { minPixelArea: 1000, minProvinces: 3 }
    );

    const exclaveLabels = labels.filter(
      (label) => label.nationId === "KINGDOM_EXCLAVE"
    );
    expect(exclaveLabels).toHaveLength(2);
    expect(exclaveLabels.every((label) => label.text === "Exclave Realm")).toBe(
      true
    );
  });

  it("labels trade guild from provinces list", () => {
    const tradeLayers: TitleLayers = {
      county: {},
      trade: {
        guild_a: { provinces: [1, 2, 3] },
        guild_empty: { provinces: [] },
      },
    };
    const tradeRegionData = {
      guild_a: {
        name: "Merchants League",
        rgb: "152,77,234",
        size: 3,
        provinces: [1, 2, 3],
      },
      guild_empty: {
        name: "Empty Guild",
        rgb: "0,0,0",
        size: 0,
        provinces: [],
      },
    };

    const labels = computeVisibleRegionLabels(
      "trade",
      tradeRegionData,
      tradeLayers,
      chainNeighbors,
      chainCentroids,
      [],
      { minPixelArea: 1000, minProvinces: 3 }
    );

    expect(labels).toHaveLength(1);
    expect(labels[0].nationId).toBe("guild_a");
    expect(labels[0].text).toBe("Merchants League");
  });

  it("creates separate labels per connected component for trade exclaves", () => {
    const tradeLayers: TitleLayers = {
      county: {},
      trade: {
        guild_exclave: { provinces: [1, 2, 3, 10, 11, 12] },
      },
    };
    const tradeRegionData = {
      guild_exclave: {
        name: "Exclave Guild",
        rgb: "10,20,30",
        size: 6,
        provinces: [1, 2, 3, 10, 11, 12],
      },
    };

    const labels = computeVisibleRegionLabels(
      "trade",
      tradeRegionData,
      tradeLayers,
      exclaveNeighbors,
      exclaveCentroids,
      [],
      { minPixelArea: 1000, minProvinces: 3 }
    );

    const exclaveLabels = labels.filter(
      (label) => label.nationId === "guild_exclave"
    );
    expect(exclaveLabels).toHaveLength(2);
    expect(exclaveLabels.every((label) => label.text === "Exclave Guild")).toBe(
      true
    );
  });
});
