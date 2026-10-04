import { describe, expect, it } from "vitest";

import { resolveRegionAtPickPixel } from "./regionPick";
import { pickSurfaceFromImageData, type PickSurface } from "../lib/map/pickSurface";
import type { RegionRecord } from "../components/map/types";

function mockSurface(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => [number, number, number, number]
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
    const surface = mockSurface(4, 4, (x, y) =>
      x === 1 && y === 2 ? [10, 20, 30, 255] : [0, 0, 0, 0]
    );
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
      regionData
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
      regionData
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
      regionData
    );
    expect(picked).toBeNull();
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
      regionData
    );
    expect(picked).toBeNull();
  });
});
