import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { EditorProvinceRow } from "@/lib/map/api";
import type { TitleLayers } from "@/app/lib/titleProvinces";

import {
  buildProvinceIndexFromGrid,
  deserializeProvinceIdGrid,
  buildProvinceIndexFromRuns,
  buildProvincePixelIndex,
  buildProvincePixelIndexFromRuns,
  buildProvinceRunIndex,
  deserializeProvinceIdRuns,
  forEachProvinceRun,
  getProvinceBBox,
  isProvinceRunIndex,
  provinceAt,
  provinceAtPixel,
  provinceIdsInRunIndex,
  provinceMapFromRuns,
  provincePixelCount,
  type ProvinceRunIndex,
} from "./buildProvinceIndex";
import {
  fillProvincePixels,
  paintActiveLayerFull,
  paintChildSelectionLayerFull,
  paintParentActiveLayerFull,
  paintSelectionLayerFull,
  updateChildSelectionSubset,
  updateCountyActiveSubset,
  updateCountySelectionSubset,
  updateParentActiveSubset,
} from "./paintTitleLayers";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

/**
 * Reference encoder: mirrors
 * backend/src/scripts/province_id_grid.py :: serialize_province_id_runs.
 * Written independently of the decoder so the tests exercise the real
 * byte layout rather than a decoder-shaped fiction.
 */
function encodeProvinceIdRuns(width: number, height: number, ids: Uint16Array): ArrayBuffer {
  const lengths: number[] = [];
  const runIds: number[] = [];

  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      const value = ids[y * width + x]!;
      let run = 1;
      while (x + run < width && ids[y * width + x + run]! === value) run++;
      lengths.push(run);
      runIds.push(value);
      x += run;
    }
  }

  const boxes = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pid = ids[y * width + x]!;
      if (pid === 0) continue;
      const box = boxes.get(pid);
      if (!box) {
        boxes.set(pid, { minX: x, minY: y, maxX: x, maxY: y });
      } else {
        box.minX = Math.min(box.minX, x);
        box.minY = Math.min(box.minY, y);
        box.maxX = Math.max(box.maxX, x);
        box.maxY = Math.max(box.maxY, y);
      }
    }
  }
  const sorted = [...boxes.keys()].sort((a, b) => a - b);

  const runCount = lengths.length;
  const total = 32 + runCount * 6 + sorted.length * 20;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);

  view.setUint8(0, 0x50); // P
  view.setUint8(1, 0x52); // R
  view.setUint8(2, 0x55); // U
  view.setUint8(3, 0x56); // V
  view.setUint32(4, 1, true);
  view.setInt32(8, width, true);
  view.setInt32(12, height, true);
  view.setUint32(16, runCount, true);
  view.setUint32(20, sorted.length, true);
  view.setUint32(24, 0, true);
  view.setUint32(28, 0, true);

  for (let i = 0; i < runCount; i++) {
    view.setUint32(32 + i * 4, lengths[i]!, true);
  }
  const idsStart = 32 + runCount * 4;
  for (let i = 0; i < runCount; i++) {
    view.setUint16(idsStart + i * 2, runIds[i]!, true);
  }

  let offset = idsStart + runCount * 2;
  for (const pid of sorted) {
    const box = boxes.get(pid)!;
    view.setUint32(offset, pid, true);
    view.setUint32(offset + 4, box.minX, true);
    view.setUint32(offset + 8, box.minY, true);
    view.setUint32(offset + 12, box.maxX, true);
    view.setUint32(offset + 16, box.maxY, true);
    offset += 20;
  }

  return buffer;
}

function runIndexFromIds(width: number, height: number, ids: Uint16Array): ProvinceRunIndex {
  const decoded = deserializeProvinceIdRuns(encodeProvinceIdRuns(width, height, ids));
  expect(decoded.width).toBe(width);
  expect(decoded.height).toBe(height);
  return buildProvinceRunIndex(decoded.width, decoded.height, decoded.runLengths, decoded.runIds, decoded.bbox);
}

function randomIds(width: number, height: number, provinceCount: number, seed: number): Uint16Array {
  const rand = mulberry32(seed);
  const ids = new Uint16Array(width * height);
  // Blobby rather than pure noise, so runs are long enough to be meaningful.
  const seeds: Array<[number, number, number]> = [];
  for (let p = 1; p <= provinceCount; p++) {
    seeds.push([Math.floor(rand() * width), Math.floor(rand() * height), p]);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = 0;
      let bestDist = Infinity;
      for (const [sx, sy, pid] of seeds) {
        const d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
        if (d < bestDist) {
          bestDist = d;
          best = pid;
        }
      }
      // Punch holes so id 0 (no province) is represented too.
      ids[y * width + x] = rand() < 0.12 ? 0 : best;
    }
  }
  return ids;
}

const CATALOG: EditorProvinceRow[] = [
  { id: 1, rgb: "10,20,30" },
  { id: 2, rgb: "40,50,60" },
  { id: 3, rgb: "70,80,90" },
  { id: 4, rgb: "100,110,120" },
  { id: 5, rgb: "130,140,150" },
  { id: 6, rgb: "160,170,180" },
];

const GRIDS: Array<{ name: string; w: number; h: number; ids: Uint16Array }> = [
  {
    name: "tiny hand-built",
    w: 4,
    h: 3,
    ids: new Uint16Array([1, 1, 2, 0, 0, 0, 2, 2, 3, 3, 3, 3]),
  },
  {
    name: "all zero",
    w: 5,
    h: 4,
    ids: new Uint16Array(20),
  },
  {
    name: "single province everywhere",
    w: 6,
    h: 5,
    ids: new Uint16Array(30).fill(4),
  },
  {
    name: "one pixel",
    w: 1,
    h: 1,
    ids: new Uint16Array([6]),
  },
  {
    name: "single row",
    w: 9,
    h: 1,
    ids: new Uint16Array([0, 1, 1, 1, 2, 2, 0, 3, 3]),
  },
  {
    name: "single column",
    w: 1,
    h: 7,
    ids: new Uint16Array([1, 1, 0, 2, 2, 2, 0]),
  },
  {
    name: "checkerboard (worst case, no runs)",
    w: 8,
    h: 8,
    ids: Uint16Array.from({ length: 64 }, (_v, i) => ((i + Math.floor(i / 8)) % 2 === 0 ? 1 : 2)),
  },
  { name: "random blobs A", w: 31, h: 23, ids: randomIds(31, 23, 6, 11) },
  { name: "random blobs B", w: 64, h: 48, ids: randomIds(64, 48, 6, 777) },
];

// ---------------------------------------------------------------------------
// index equivalence
// ---------------------------------------------------------------------------

describe("run index vs flat index equivalence", () => {
  for (const grid of GRIDS) {
    describe(grid.name, () => {
      const flat = buildProvinceIndexFromGrid(CATALOG, grid.w, grid.h, grid.ids);
      const runIndex = runIndexFromIds(grid.w, grid.h, grid.ids);
      const runs = buildProvinceIndexFromRuns(CATALOG, runIndex);

      it("produces an identical provinceMap", () => {
        expect(runs.provinceMap.length).toBe(flat.provinceMap.length);
        expect(Array.from(runs.provinceMap)).toEqual(Array.from(flat.provinceMap));
      });

      it("produces identical dimensions and rgb maps", () => {
        expect(runs.width).toBe(flat.width);
        expect(runs.height).toBe(flat.height);
        expect(runs.rgbToProvinceId).toEqual(flat.rgbToProvinceId);
        expect(runs.provinceToRgb).toEqual(flat.provinceToRgb);
      });

      it("provinceAt matches provinceMap for every pixel", () => {
        for (let y = 0; y < grid.h; y++) {
          for (let x = 0; x < grid.w; x++) {
            const expected = flat.provinceMap[y * grid.w + x]!;
            expect(provinceAt(runIndex, x, y)).toBe(expected);
            expect(provinceAtPixel(runIndex, y * grid.w + x)).toBe(expected);
          }
        }
      });

      it("provinceAt is bounds-safe like a miss", () => {
        expect(provinceAt(runIndex, -1, 0)).toBe(-1);
        expect(provinceAt(runIndex, 0, -1)).toBe(-1);
        expect(provinceAt(runIndex, grid.w, 0)).toBe(-1);
        expect(provinceAt(runIndex, 0, grid.h)).toBe(-1);
        expect(provinceAtPixel(runIndex, -1)).toBe(-1);
        expect(provinceAtPixel(runIndex, grid.w * grid.h)).toBe(-1);
      });

      it("yields the identical pixel index (same keys, same order, same pixels)", () => {
        const flatPixels = buildProvincePixelIndex(flat.provinceMap);
        const runPixels = buildProvincePixelIndexFromRuns(runIndex);

        expect([...runPixels.keys()]).toEqual([...flatPixels.keys()]);
        for (const [pid, pixels] of flatPixels) {
          expect(Array.from(runPixels.get(pid)!)).toEqual(Array.from(pixels));
        }
      });

      it("reports pixel counts matching the flat map", () => {
        const counts = new Map<number, number>();
        for (const pid of flat.provinceMap) {
          if (pid < 0) continue;
          counts.set(pid, (counts.get(pid) ?? 0) + 1);
        }
        expect(provinceIdsInRunIndex(runIndex).sort((a, b) => a - b)).toEqual([...counts.keys()].sort((a, b) => a - b));
        for (const [pid, count] of counts) {
          expect(provincePixelCount(runIndex, pid)).toBe(count);
        }
      });

      it("reports bounding boxes matching a brute-force scan", () => {
        for (const pid of provinceIdsInRunIndex(runIndex)) {
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -1;
          let maxY = -1;
          for (let y = 0; y < grid.h; y++) {
            for (let x = 0; x < grid.w; x++) {
              if (flat.provinceMap[y * grid.w + x] !== pid) continue;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
          expect(getProvinceBBox(runIndex, pid)).toEqual({
            minX,
            minY,
            maxX,
            maxY,
          });
        }
      });

      it("emits runs that never cross a row boundary", () => {
        for (let i = 0; i < runIndex.runStarts.length; i++) {
          const start = runIndex.runStarts[i]!;
          const end = start + runIndex.runLengths[i]! - 1;
          expect(Math.floor(start / grid.w)).toBe(Math.floor(end / grid.w));
        }
      });
    });
  }

  it("marks the run index so consumers can discriminate it", () => {
    const runIndex = runIndexFromIds(4, 3, GRIDS[0]!.ids);
    expect(isProvinceRunIndex(runIndex)).toBe(true);
    expect(isProvinceRunIndex(new Int32Array(4))).toBe(false);
    expect(isProvinceRunIndex(new Map())).toBe(false);
    expect(isProvinceRunIndex(null)).toBe(false);
  });

  it("attaches the run index to the built ProvinceIndex", () => {
    const runIndex = runIndexFromIds(4, 3, GRIDS[0]!.ids);
    expect(buildProvinceIndexFromRuns(CATALOG, runIndex).runs).toBe(runIndex);
    expect(buildProvinceIndexFromGrid(CATALOG, 4, 3, GRIDS[0]!.ids).runs).toBeUndefined();
  });

  it("visits province runs in ascending pixel order", () => {
    const runIndex = runIndexFromIds(64, 48, GRIDS[8]!.ids);
    for (const pid of provinceIdsInRunIndex(runIndex)) {
      let previousEnd = -1;
      forEachProvinceRun(runIndex, pid, (start, length) => {
        expect(start).toBeGreaterThan(previousEnd);
        expect(length).toBeGreaterThan(0);
        previousEnd = start + length - 1;
      });
    }
  });

  it("returns nothing for an unknown province", () => {
    const runIndex = runIndexFromIds(4, 3, GRIDS[0]!.ids);
    const seen: number[] = [];
    forEachProvinceRun(runIndex, 9999, (start) => seen.push(start));
    expect(seen).toEqual([]);
    expect(provincePixelCount(runIndex, 9999)).toBe(0);
    expect(getProvinceBBox(runIndex, 9999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decoder robustness (the fallback path depends on these throwing)
// ---------------------------------------------------------------------------

describe("deserializeProvinceIdRuns rejects bad input", () => {
  const valid = () => encodeProvinceIdRuns(4, 3, GRIDS[0]!.ids);

  it("rejects a short buffer", () => {
    expect(() => deserializeProvinceIdRuns(new ArrayBuffer(8))).toThrow();
  });

  it("rejects a bad magic", () => {
    const buffer = valid();
    new DataView(buffer).setUint8(0, 0x58);
    expect(() => deserializeProvinceIdRuns(buffer)).toThrow(/magic/);
  });

  it("rejects an unsupported version", () => {
    const buffer = valid();
    new DataView(buffer).setUint32(4, 99, true);
    expect(() => deserializeProvinceIdRuns(buffer)).toThrow(/version/);
  });

  it("rejects non-positive dimensions", () => {
    const buffer = valid();
    new DataView(buffer).setInt32(8, 0, true);
    expect(() => deserializeProvinceIdRuns(buffer)).toThrow(/dimensions/);
  });

  it("rejects a truncated payload", () => {
    const buffer = valid();
    expect(() => deserializeProvinceIdRuns(buffer.slice(0, buffer.byteLength - 4))).toThrow(/length/);
  });

  it("rejects a zero-length run", () => {
    const buffer = valid();
    new DataView(buffer).setUint32(32, 0, true);
    expect(() => deserializeProvinceIdRuns(buffer)).toThrow(/zero-length/);
  });

  it("rejects runs that do not cover the grid (stale artifact)", () => {
    const buffer = valid();
    new DataView(buffer).setUint32(32, 7, true);
    expect(() => deserializeProvinceIdRuns(buffer)).toThrow(/pixels/);
  });

  it("rejects mismatched run arrays at build time", () => {
    expect(() => buildProvinceRunIndex(2, 2, new Uint32Array([4]), new Uint16Array([1, 2]))).toThrow(/mismatch/);
  });

  it("rejects runs whose lengths do not fill the grid at build time", () => {
    expect(() => buildProvinceRunIndex(4, 4, new Uint32Array([3]), new Uint16Array([1]))).toThrow(/pixels/);
  });
});

// ---------------------------------------------------------------------------
// paint equivalence: flat source vs run source must produce identical bytes
// ---------------------------------------------------------------------------

type PaintCase = {
  name: string;
  run: (
    imageData: ImageData,
    geometry: Int32Array | ProvinceRunIndex,
    regions: ReturnType<typeof buildProvincePixelIndex> | ProvinceRunIndex,
  ) => void;
};

const PROVINCE_TO_COUNTY = new Map<number, string>([
  [1, "COUNTY_A"],
  [2, "COUNTY_A"],
  [3, "COUNTY_B"],
]);
const COUNTY_COLORS: Record<string, string> = {
  COUNTY_A: "200,10,10",
  COUNTY_B: "10,200,10",
};
const PROVINCE_TO_RGB: Record<number, string> = {
  1: "10,20,30",
  2: "40,50,60",
  3: "70,80,90",
  4: "100,110,120",
  5: "130,140,150",
  6: "160,170,180",
};

const CHILD_PROVINCES: Record<string, number[]> = {
  CHILD_A: [1, 4],
  CHILD_B: [2, 5],
  CHILD_C: [3, 6],
};
const resolveChild = (childId: string): number[] => CHILD_PROVINCES[childId] ?? [];
const EMPTY_LAYERS = {} as TitleLayers;

const PAINT_CASES: PaintCase[] = [
  {
    name: "fillProvincePixels",
    run: (imageData, geometry) => {
      fillProvincePixels(imageData, geometry, [1, 3, 5], [11, 22, 33]);
    },
  },
  {
    name: "fillProvincePixels with a Set and an absent id",
    run: (imageData, geometry) => {
      fillProvincePixels(imageData, geometry, new Set([2, 4, 9999]), [200, 100, 50]);
    },
  },
  {
    name: "paintSelectionLayerFull",
    run: (imageData, geometry) => {
      paintSelectionLayerFull(imageData, geometry, PROVINCE_TO_RGB, PROVINCE_TO_COUNTY, COUNTY_COLORS);
    },
  },
  {
    name: "paintSelectionLayerFull with no county assignment",
    run: (imageData, geometry) => {
      paintSelectionLayerFull(imageData, geometry, PROVINCE_TO_RGB, new Map(), {});
    },
  },
  {
    name: "paintSelectionLayerFull with unparseable colors",
    run: (imageData, geometry) => {
      paintSelectionLayerFull(imageData, geometry, { 1: "nope" }, new Map(), {});
    },
  },
  {
    name: "paintActiveLayerFull",
    run: (imageData, geometry) => {
      paintActiveLayerFull(imageData, geometry, [1, 2], "5,6,7", new Set([3, 4]));
    },
  },
  {
    name: "paintActiveLayerFull with no members",
    run: (imageData, geometry) => {
      paintActiveLayerFull(imageData, geometry, undefined, undefined, new Set());
    },
  },
  {
    name: "paintChildSelectionLayerFull",
    run: (imageData, geometry) => {
      paintChildSelectionLayerFull(
        imageData,
        geometry,
        {
          CHILD_A: { rgb: "1,2,3" } as never,
          CHILD_B: { rgb: "4,5,6" } as never,
        },
        resolveChild,
        EMPTY_LAYERS,
      );
    },
  },
  {
    name: "paintParentActiveLayerFull",
    run: (imageData, geometry) => {
      paintParentActiveLayerFull(imageData, geometry, ["CHILD_A", "CHILD_C"], "9,9,9", resolveChild, EMPTY_LAYERS);
    },
  },
  {
    name: "updateCountySelectionSubset",
    run: (imageData, _geometry, regions) => {
      updateCountySelectionSubset(
        imageData,
        regions,
        [1, 2, 3, 9999],
        PROVINCE_TO_RGB,
        PROVINCE_TO_COUNTY,
        COUNTY_COLORS,
      );
    },
  },
  {
    name: "updateCountyActiveSubset with clears",
    run: (imageData, _geometry, regions) => {
      updateCountyActiveSubset(imageData, regions, [1, 2], "7,7,7", [3, 4]);
    },
  },
  {
    name: "updateCountyActiveSubset with no active color",
    run: (imageData, _geometry, regions) => {
      updateCountyActiveSubset(imageData, regions, [1], undefined, [2, 3]);
    },
  },
  {
    name: "updateChildSelectionSubset",
    run: (imageData, _geometry, regions) => {
      updateChildSelectionSubset(
        imageData,
        regions,
        ["CHILD_A", "CHILD_B", "CHILD_MISSING"],
        { CHILD_A: "3,3,3", CHILD_B: "8,8,8" },
        resolveChild,
        EMPTY_LAYERS,
      );
    },
  },
  {
    name: "updateParentActiveSubset with clears",
    run: (imageData, _geometry, regions) => {
      updateParentActiveSubset(imageData, regions, ["CHILD_A"], "2,4,6", resolveChild, EMPTY_LAYERS, [
        "CHILD_B",
        "CHILD_C",
      ]);
    },
  },
];

describe("paint equivalence: run source matches flat source byte for byte", () => {
  for (const grid of GRIDS) {
    const flat = buildProvinceIndexFromGrid(CATALOG, grid.w, grid.h, grid.ids);
    const runIndex = runIndexFromIds(grid.w, grid.h, grid.ids);
    const pixelIndex = buildProvincePixelIndex(flat.provinceMap);

    for (const paintCase of PAINT_CASES) {
      it(`${grid.name}: ${paintCase.name}`, () => {
        const fromFlat = makeImageData(grid.w, grid.h);
        const fromRuns = makeImageData(grid.w, grid.h);

        paintCase.run(fromFlat, flat.provinceMap, pixelIndex);
        paintCase.run(fromRuns, runIndex, runIndex);

        expect(Array.from(fromRuns.data)).toEqual(Array.from(fromFlat.data));
      });

      it(`${grid.name}: ${paintCase.name} (over a pre-painted surface)`, () => {
        // Incremental repaints run against an existing surface; make sure the
        // run path leaves untouched pixels exactly as the flat path does.
        const fromFlat = makeImageData(grid.w, grid.h);
        const fromRuns = makeImageData(grid.w, grid.h);
        for (let i = 0; i < fromFlat.data.length; i++) {
          const value = (i * 37) % 256;
          fromFlat.data[i] = value;
          fromRuns.data[i] = value;
        }

        paintCase.run(fromFlat, flat.provinceMap, pixelIndex);
        paintCase.run(fromRuns, runIndex, runIndex);

        expect(Array.from(fromRuns.data)).toEqual(Array.from(fromFlat.data));
      });
    }
  }
});

describe("span writer fallback", () => {
  it("matches the 32-bit path when a Uint32 view is impossible", () => {
    const grid = GRIDS[7]!;
    const flat = buildProvinceIndexFromGrid(CATALOG, grid.w, grid.h, grid.ids);
    const runIndex = runIndexFromIds(grid.w, grid.h, grid.ids);

    const aligned = makeImageData(grid.w, grid.h);
    // Force the per-byte fallback by handing over a misaligned view.
    const backing = new ArrayBuffer(grid.w * grid.h * 4 + 1);
    const misaligned = {
      width: grid.w,
      height: grid.h,
      data: new Uint8ClampedArray(backing, 1, grid.w * grid.h * 4),
    } as ImageData;

    fillProvincePixels(aligned, runIndex, [1, 2], [3, 5, 7]);
    fillProvincePixels(misaligned, runIndex, [1, 2], [3, 5, 7]);

    const reference = makeImageData(grid.w, grid.h);
    fillProvincePixels(reference, flat.provinceMap, [1, 2], [3, 5, 7]);

    expect(Array.from(aligned.data)).toEqual(Array.from(reference.data));
    expect(Array.from(misaligned.data)).toEqual(Array.from(reference.data));
  });
});

// ---------------------------------------------------------------------------
// equivalence against the real shipped artifacts (6400x6400)
// ---------------------------------------------------------------------------

const DEFINES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../../backend/src/defines/main");
const REAL_GRID = path.join(DEFINES, "province_id_grid.bin.gz");
const REAL_RUNS = path.join(DEFINES, "province_id_runs.bin.gz");

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

const hasRealArtifacts = existsSync(REAL_GRID) && existsSync(REAL_RUNS);

describe.skipIf(!hasRealArtifacts)("real main artifacts: runs decode to the same grid", () => {
  it("matches province_id_grid.bin.gz pixel for pixel", () => {
    const gridPayload = toArrayBuffer(gunzipSync(readFileSync(REAL_GRID)));
    const grid = deserializeProvinceIdGrid(gridPayload);

    const runsPayload = toArrayBuffer(gunzipSync(readFileSync(REAL_RUNS)));
    const decoded = deserializeProvinceIdRuns(runsPayload);

    expect(decoded.width).toBe(grid.width);
    expect(decoded.height).toBe(grid.height);

    const runIndex = buildProvinceRunIndex(
      decoded.width,
      decoded.height,
      decoded.runLengths,
      decoded.runIds,
      decoded.bbox,
    );

    // Walk the runs and check every covered pixel against the flat grid,
    // without allocating a second full-size array.
    let covered = 0;
    let mismatches = 0;
    for (let i = 0; i < runIndex.runStarts.length; i++) {
      const start = runIndex.runStarts[i]!;
      const length = runIndex.runLengths[i]!;
      const pid = runIndex.runIds[i]!;
      for (let k = 0; k < length; k++) {
        if (grid.ids[start + k] !== pid) mismatches++;
      }
      covered += length;
    }

    expect(mismatches).toBe(0);
    expect(covered).toBe(grid.width * grid.height);
  });

  it("has a bbox row for exactly the province ids present in the grid", () => {
    const gridPayload = toArrayBuffer(gunzipSync(readFileSync(REAL_GRID)));
    const grid = deserializeProvinceIdGrid(gridPayload);
    const decoded = deserializeProvinceIdRuns(toArrayBuffer(gunzipSync(readFileSync(REAL_RUNS))));

    const present = new Set<number>();
    for (let i = 0; i < grid.ids.length; i++) {
      const pid = grid.ids[i]!;
      if (pid > 0) present.add(pid);
    }

    expect([...decoded.bbox.keys()].sort((a, b) => a - b)).toEqual([...present].sort((a, b) => a - b));
  });

  it("is far smaller in memory than the flat grid", () => {
    const decoded = deserializeProvinceIdRuns(toArrayBuffer(gunzipSync(readFileSync(REAL_RUNS))));
    const runBytes = decoded.runLengths.byteLength + decoded.runIds.byteLength;
    const flatBytes = decoded.width * decoded.height * 4;

    expect(runBytes).toBeLessThan(flatBytes / 50);
  });
});
