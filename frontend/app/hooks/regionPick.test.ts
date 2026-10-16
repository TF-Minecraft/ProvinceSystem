import { describe, expect, it } from "vitest";

import { resolveRegionAtPickPixel } from "./regionPick";
import { pickSurfaceFromImageData, type PickSurface } from "../lib/map/pickSurface";
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
