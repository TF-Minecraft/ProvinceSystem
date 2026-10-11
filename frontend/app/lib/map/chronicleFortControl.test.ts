import { describe, expect, it } from "vitest";

import { expandChronicleBorderMask } from "./chronicleBorderMask";
import {
  CHRONICLE_ZOC_HATCH_RGBA,
  chronicleZocHatchMetrics,
  computeChronicleZocMask,
  fortZocProvinceIds,
} from "./chronicleFortControl";
import type { ProvinceIdGrid } from "./chroniclePaint";
import type { MapMarkersResponse } from "../../components/map/types";

const markers = {
  map_id: "main",
  exported_at: null,
  settlements: [],
  installations: [],
  forts: [{ id: "a", zoc_provinces: [1, 2] }, { id: "b", zoc_provinces: [2, 3] }, { id: "c" }],
} as unknown as MapMarkersResponse;

/**
 * Four rows of one province each, so the hatch metrics rather than the province
 * shapes decide which pixels are set.
 *
 *   1 1 1 1
 *   2 2 2 2
 *   3 3 3 3
 *   0 0 0 0
 */
const grid: ProvinceIdGrid = {
  width: 4,
  height: 4,
  ids: new Uint16Array([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 0, 0, 0, 0]),
};

function setBits(bits: Uint8Array, pixelCount: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pixelCount; i++) {
    if ((bits[i >> 3]! >>> (i & 7)) & 1) out.push(i);
  }
  return out;
}

describe("fortZocProvinceIds", () => {
  it("unions every fort's zone, without repeating a shared province", () => {
    expect(fortZocProvinceIds(markers).sort()).toEqual([1, 2, 3]);
  });

  it("treats a day with no fort rows as no zones", () => {
    expect(fortZocProvinceIds(null)).toEqual([]);
    expect(fortZocProvinceIds({ map_id: "main" } as unknown as MapMarkersResponse)).toEqual([]);
  });

  it("survives malformed fort payloads", () => {
    // `?? []` would still let an object reach `for...of` and blank the page:
    // there is no error boundary under `app/`.
    const malformed = {
      forts: { id: "a" },
    } as unknown as MapMarkersResponse;
    expect(fortZocProvinceIds(malformed)).toEqual([]);

    const badIds = {
      forts: [
        { id: "a", zoc_provinces: "1,2" },
        { id: "b", zoc_provinces: [0, -3, 1.5, 7] },
      ],
    } as unknown as MapMarkersResponse;
    // Ocean (0), negatives and fractions are junk; only the real id survives.
    expect(fortZocProvinceIds(badIds)).toEqual([7]);
  });

  it("drops an id no grid pixel could ever name", () => {
    const absurd = {
      forts: [{ id: "a", zoc_provinces: [2_000_000_000] }],
    } as unknown as MapMarkersResponse;
    expect(fortZocProvinceIds(absurd)).toEqual([]);
  });
});

describe("chronicleZocHatchMetrics", () => {
  it("scales zocgen's 80/32 tile to the grid it is drawn on", () => {
    expect(chronicleZocHatchMetrics(6400)).toEqual({ period: 80, line: 32 });
    expect(chronicleZocHatchMetrics(1600)).toEqual({ period: 20, line: 8 });
  });

  it("never lets the stripes collapse to nothing", () => {
    // A period of 0 divides by zero and a line of 0 draws no hatch at all.
    const tiny = chronicleZocHatchMetrics(4);
    expect(tiny.period).toBeGreaterThan(0);
    expect(tiny.line).toBeGreaterThan(0);
  });
});

describe("computeChronicleZocMask", () => {
  it("hatches only the provinces under a zone", () => {
    const mask = computeChronicleZocMask(grid, [1, 3])!;
    // At this grid width the tile scales below one pixel and the hatch is
    // solid, so the set bits are exactly the two provinces' rows.
    expect(setBits(mask.bits, 16)).toEqual([0, 1, 2, 3, 8, 9, 10, 11]);
  });

  it("leaves the stripes' gaps clear at a realistic grid width", () => {
    const width = 800;
    const wide: ProvinceIdGrid = {
      width,
      height: 1,
      ids: new Uint16Array(width).fill(1),
    };
    const mask = computeChronicleZocMask(wide, [1])!;
    const { period, line } = chronicleZocHatchMetrics(width);
    expect(period).toBe(10);
    expect(line).toBe(4);
    expect(setBits(mask.bits, width)).toEqual(
      Array.from({ length: width }, (_, x) => x).filter((x) => x % period < line),
    );
  });

  it("returns null when the day has no zones to draw", () => {
    expect(computeChronicleZocMask(grid, [])).toBeNull();
    // A zone over provinces no pixel of this grid names draws nothing either.
    expect(computeChronicleZocMask(grid, [99])).toBeNull();
  });

  it("expands into zocgen's hatch colour", () => {
    const mask = computeChronicleZocMask(grid, [1])!;
    const output = new Uint8ClampedArray(16 * 4);
    expandChronicleBorderMask(mask, output, { ink: CHRONICLE_ZOC_HATCH_RGBA });
    expect(Array.from(output.slice(0, 4))).toEqual([210, 35, 45, 210]);
    // Province 2's row is outside every zone.
    expect(Array.from(output.slice(16, 20))).toEqual([0, 0, 0, 0]);
  });

  it("rejects a grid whose header disagrees with its ids", () => {
    expect(() => computeChronicleZocMask({ width: 4, height: 4, ids: new Uint16Array(3) }, [1])).toThrow();
  });
});
