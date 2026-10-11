import { describe, expect, it } from "vitest";

import {
  buildGifPalette,
  mapFrameToPaletteIndices,
  NearestColorCache,
  PALETTE_SAMPLE_TARGET,
  pixelSampleStride,
  type GifPalette,
} from "./gifPalette";

function frameOf(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  return data;
}

function paletteColors(palette: GifPalette): string[] {
  const colors: string[] = [];
  for (let i = 0; i < palette.colorCount; i++) {
    const o = i * 3;
    colors.push(`${palette.table[o]},${palette.table[o + 1]},${palette.table[o + 2]}`);
  }
  return colors;
}

function nearestColor(palette: GifPalette, r: number, g: number, b: number): [number, number, number] {
  const index = new NearestColorCache(palette).lookup(r, g, b);
  const o = index * 3;
  return [palette.table[o]!, palette.table[o + 1]!, palette.table[o + 2]!];
}

function distance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

describe("pixelSampleStride", () => {
  it("walks every pixel of a small animation", () => {
    expect(pixelSampleStride(4 * 4, 4)).toBe(1);
  });

  it("keeps the sample count near the target for a large export", () => {
    const total = 1080 * 1080 * 60;
    const stride = pixelSampleStride(total, 1080);
    expect(total / stride).toBeGreaterThan(PALETTE_SAMPLE_TARGET * 0.5);
    expect(total / stride).toBeLessThan(PALETTE_SAMPLE_TARGET * 1.5);
  });

  it("never lands on a multiple of the frame width", () => {
    // A stride that matches the row period would sample one column of the map.
    for (const width of [64, 100, 720, 1080]) {
      for (let total = width * 1000; total < width * 1000 + 40; total++) {
        const stride = pixelSampleStride(total, width);
        expect(stride % width === 0 && stride > 1).toBe(false);
      }
    }
  });
});

describe("buildGifPalette", () => {
  it("reproduces a small palette exactly", () => {
    const colors: Array<[number, number, number]> = [
      [12, 34, 56],
      [200, 30, 30],
      [240, 232, 200],
    ];
    const frame = frameOf(6, 6, (x) => [...colors[x % 3]!, 255]);
    const palette = buildGifPalette([frame], 6);

    expect(palette.colorCount).toBe(3);
    expect(paletteColors(palette).sort()).toEqual(colors.map((c) => c.join(",")).sort());
    // Table size is a power of two even though only three entries are used.
    expect(palette.table.length).toBe(4 * 3);
  });

  it("pools colours from every frame into one table", () => {
    const a = frameOf(4, 4, () => [10, 20, 30, 255]);
    const b = frameOf(4, 4, () => [200, 100, 50, 255]);
    const palette = buildGifPalette([a, b], 4);
    expect(paletteColors(palette).sort()).toEqual(["10,20,30", "200,100,50"].sort());
  });

  it("folds sub-threshold alpha into black", () => {
    const frame = frameOf(4, 4, (x) => (x === 0 ? [255, 0, 0, 0] : [9, 9, 9, 255]));
    const palette = buildGifPalette([frame], 4);
    expect(paletteColors(palette).sort()).toEqual(["0,0,0", "9,9,9"].sort());
  });

  it("quantises past 256 colours and keeps saturated minorities apart", () => {
    // The shape of a real map export: a huge, nearly flat ocean and parchment
    // spread over hundreds of shades, plus four tiny saturated nation fills.
    const width = 128;
    const height = 128;
    const nations: Array<[number, number, number]> = [
      [220, 20, 20],
      [20, 200, 60],
      [240, 220, 20],
      [180, 30, 200],
    ];
    const frame = frameOf(width, height, (x, y) => {
      const nation = y < 4 ? nations[x & 3] : null;
      if (nation && x < 16) return [...nation, 255];
      if (x < width / 2) return [20 + ((x * y) % 24), 40 + (y % 20), 90 + (x % 24), 255];
      return [230 - (y % 22), 214 - (x % 18), 176 - ((x + y) % 20), 255];
    });

    const palette = buildGifPalette([frame], width);
    expect(palette.colorCount).toBeLessThanOrEqual(256);
    expect(palette.colorCount).toBeGreaterThan(32);

    const mapped = nations.map((n) => nearestColor(palette, n[0], n[1], n[2]));
    for (let i = 0; i < nations.length; i++) {
      // Each nation keeps a representative close to its own colour...
      expect(distance(mapped[i]!, nations[i]!)).toBeLessThan(40 * 40);
      for (let j = i + 1; j < nations.length; j++) {
        // ...and no two of them collapse onto the same entry.
        expect(mapped[i]!.join(",")).not.toBe(mapped[j]!.join(","));
      }
    }
  });

  it("survives a single-colour animation", () => {
    const frame = frameOf(4, 4, () => [5, 5, 5, 255]);
    const palette = buildGifPalette([frame], 4);
    expect(palette.colorCount).toBe(1);
    expect(palette.table.length).toBe(2 * 3);
    expect(nearestColor(palette, 200, 200, 200)).toEqual([5, 5, 5]);
  });
});

describe("NearestColorCache", () => {
  it("agrees with a brute-force nearest search", () => {
    const frame = frameOf(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2, 255]);
    const palette = buildGifPalette([frame], 64);
    const cache = new NearestColorCache(palette);

    let seed = 12345;
    for (let i = 0; i < 3_000; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const r = (seed >>> 8) & 0xff;
      const g = (seed >>> 16) & 0xff;
      const b = (seed >>> 24) & 0xff;

      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < palette.colorCount; c++) {
        const o = c * 3;
        const d = distance([r, g, b], [palette.table[o]!, palette.table[o + 1]!, palette.table[o + 2]!]);
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      expect(cache.lookup(r, g, b)).toBe(best);
      // Second lookup comes out of the memo and must not drift.
      expect(cache.lookup(r, g, b)).toBe(best);
    }
  });

  it("resolves transparent pixels to the entry nearest black", () => {
    const frame = frameOf(4, 4, (x) => (x === 0 ? [2, 2, 2, 255] : [250, 250, 250, 255]));
    const palette = buildGifPalette([frame], 4);
    const cache = new NearestColorCache(palette);
    expect(cache.transparentIndex).toBe(cache.lookup(0, 0, 0));

    const withHole = frameOf(4, 4, (x) => (x === 1 ? [250, 0, 0, 10] : [250, 250, 250, 255]));
    const out = new Uint8Array(16);
    mapFrameToPaletteIndices(withHole, cache, out);
    expect(out[1]).toBe(cache.transparentIndex);
    expect(out[0]).toBe(cache.lookup(250, 250, 250));
  });
});
