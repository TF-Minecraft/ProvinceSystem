import { describe, expect, it } from "vitest";

import {
  CHRONICLE_BORDER_INK_RGBA,
  chronicleBorderThickness,
  computeChronicleBorderMask,
  expandChronicleBorderMask,
  type ChronicleBorderMask,
} from "./chronicleBorderMask";
import type { NationOwnership, ProvinceIdGrid } from "./chroniclePaint";

function makeGrid(ids: number[], width: number, height: number): ProvinceIdGrid {
  return { width, height, ids: Uint16Array.from(ids) };
}

/** `fill(x, y)` -> province id, evaluated row-major over the whole grid. */
function gridOf(width: number, height: number, fill: (x: number, y: number) => number): ProvinceIdGrid {
  const ids = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) ids[y * width + x] = fill(x, y);
  }
  return { width, height, ids };
}

function bitAt(mask: ChronicleBorderMask, x: number, y: number): number {
  const i = y * mask.width + x;
  return (mask.bits[i >> 3]! >>> (i & 7)) & 1;
}

const red: NationOwnership = {
  RED: { rgb: "229,60,112", provinces: [1] },
} as NationOwnership;

// All grids here are small, so `chronicleBorderThickness` resolves to its
// floor of 1: a 3x3 stamp, one pixel out and one pixel in from every rim.

describe("computeChronicleBorderMask", () => {
  it("inks a nation's rim, dilated out and in, and leaves the interior clear", () => {
    // A 10x10 RED block on 16x16 ocean, spanning x,y 3..12. Rim pixels are the
    // block's outermost ring; the stamp reaches one pixel beyond it each way.
    const grid = gridOf(16, 16, (x, y) => (x >= 3 && x <= 12 && y >= 3 && y <= 12 ? 1 : 0));
    const mask = computeChronicleBorderMask(grid, red);

    expect(bitAt(mask, 3, 3)).toBe(1); // the rim itself
    expect(bitAt(mask, 2, 2)).toBe(1); // dilated one pixel outward
    expect(bitAt(mask, 4, 4)).toBe(1); // dilated one pixel inward
    expect(bitAt(mask, 1, 1)).toBe(0); // two pixels out: past the stamp
    expect(bitAt(mask, 5, 5)).toBe(0); // two pixels in: interior stays clear
    expect(bitAt(mask, 8, 8)).toBe(0); // deep interior
    expect(bitAt(mask, 15, 15)).toBe(0); // open ocean
  });

  it("draws nothing between two provinces of the same nation", () => {
    // Same block, but split into province 1 (left) and 2 (right). The border
    // keys on the owner's opaque union, never on ids or colours within it, so
    // the internal seam at x 7|8 must stay clear.
    const grid = gridOf(16, 16, (x, y) => {
      if (x < 3 || x > 12 || y < 3 || y > 12) return 0;
      return x <= 7 ? 1 : 2;
    });
    const both: NationOwnership = {
      RED: { rgb: "229,60,112", provinces: [1, 2] },
    } as NationOwnership;

    const mask = computeChronicleBorderMask(grid, both);
    expect(bitAt(mask, 7, 8)).toBe(0);
    expect(bitAt(mask, 8, 8)).toBe(0);
    // The outer rim is still there.
    expect(bitAt(mask, 3, 8)).toBe(1);
    expect(bitAt(mask, 12, 8)).toBe(1);
  });

  it("strikes a shared seam from both sides, so it reads wider than a coast", () => {
    // RED holds x 0..7, BLUE x 8..15, full height: both rims sit at the seam
    // (x=7 and x=8), so the dilated band spans x 6..9. A coastline has a rim
    // on the land side only, so its band is one pixel narrower.
    const seamGrid = gridOf(16, 16, (x) => (x <= 7 ? 1 : 2));
    const pair: NationOwnership = {
      RED: { rgb: "229,60,112", provinces: [1] },
      BLUE: { rgb: "10,20,30", provinces: [2] },
    } as NationOwnership;
    const seam = computeChronicleBorderMask(seamGrid, pair);
    expect(bitAt(seam, 6, 8)).toBe(1);
    expect(bitAt(seam, 9, 8)).toBe(1);
    expect(bitAt(seam, 5, 8)).toBe(0);
    expect(bitAt(seam, 10, 8)).toBe(0);

    const coastGrid = gridOf(16, 16, (x) => (x <= 7 ? 1 : 0));
    const coast = computeChronicleBorderMask(coastGrid, red);
    expect(bitAt(coast, 6, 8)).toBe(1);
    expect(bitAt(coast, 8, 8)).toBe(1); // one out from the x=7 rim
    expect(bitAt(coast, 9, 8)).toBe(0); // the doubled seam reached here; a coast does not
  });

  it("closes territory against the edge of the grid", () => {
    // RED covers the whole grid: every edge pixel neighbours off-grid, which
    // counts as transparent, so the map's rim is inked and the centre is not.
    const grid = gridOf(16, 16, () => 1);
    const mask = computeChronicleBorderMask(grid, red);
    expect(bitAt(mask, 0, 0)).toBe(1);
    expect(bitAt(mask, 15, 0)).toBe(1);
    expect(bitAt(mask, 0, 15)).toBe(1);
    expect(bitAt(mask, 15, 15)).toBe(1);
    expect(bitAt(mask, 1, 8)).toBe(1); // one in from the rim: dilation
    expect(bitAt(mask, 2, 8)).toBe(0);
    expect(bitAt(mask, 8, 8)).toBe(0);
  });

  it("ignores land whose nation the fill would not paint either", () => {
    const grid = makeGrid([0, 5, 5, 0], 2, 2);
    const ghost: NationOwnership = {
      GHOST: { provinces: [5] },
    } as NationOwnership;
    const mask = computeChronicleBorderMask(grid, ghost);
    expect(Array.from(mask.bits).every((byte) => byte === 0)).toBe(true);
  });

  it("rejects a grid whose id count does not match its size", () => {
    expect(() => computeChronicleBorderMask(makeGrid([1, 1], 4, 4), red)).toThrow(/province id grid/);
  });

  it("rejects oversized or malformed dimensions before allocating anything", () => {
    // 7000x7000 exceeds the 6400x6400 native source cap; checked before the
    // id-count comparison so a lying header never sizes a buffer.
    expect(() => computeChronicleBorderMask({ width: 7000, height: 7000, ids: new Uint16Array(0) }, red)).toThrow(
      /outside/,
    );
    expect(() => computeChronicleBorderMask({ width: 2.5, height: 4, ids: new Uint16Array(10) }, red)).toThrow(
      /outside/,
    );
    expect(() => computeChronicleBorderMask({ width: -4, height: 4, ids: new Uint16Array(0) }, red)).toThrow(/outside/);
  });
});

describe("chronicleBorderThickness", () => {
  it("scales the server's 5px-at-6400 stamp to the running resolution", () => {
    expect(chronicleBorderThickness(6400)).toBe(5);
    expect(chronicleBorderThickness(3200)).toBe(3); // 2.5 rounds up
    expect(chronicleBorderThickness(1600)).toBe(1); // 1.25 rounds down
    expect(chronicleBorderThickness(16)).toBe(1); // never vanishes
  });
});

describe("expandChronicleBorderMask", () => {
  const grid = gridOf(16, 16, (x, y) => (x >= 3 && x <= 12 && y >= 3 && y <= 12 ? 1 : 0));
  const mask = computeChronicleBorderMask(grid, red);
  const [r, g, b, a] = CHRONICLE_BORDER_INK_RGBA;

  const expandsCorrectly = (forceByteLoop: boolean) => {
    const output = new Uint8ClampedArray(16 * 16 * 4);
    // Pre-soil the buffer: every pixel must be written, ink or transparent.
    output.fill(77);
    expandChronicleBorderMask(mask, output, { forceByteLoop });

    const at = (x: number, y: number) => {
      const offset = (y * 16 + x) * 4;
      return Array.from(output.slice(offset, offset + 4));
    };
    expect(at(3, 3)).toEqual([r, g, b, a]);
    expect(at(8, 8)).toEqual([0, 0, 0, 0]);
    expect(at(15, 15)).toEqual([0, 0, 0, 0]);
  };

  it("expands the mask into single-ink RGBA on the fast path", () => {
    expandsCorrectly(false);
  });

  it("expands identically through the per-byte fallback", () => {
    expandsCorrectly(true);
  });

  it("rejects a wrongly sized output buffer", () => {
    expect(() => expandChronicleBorderMask(mask, new Uint8ClampedArray(16))).toThrow(/border buffer/);
  });

  it("rejects a mask whose byte count does not match its dimensions", () => {
    expect(() =>
      expandChronicleBorderMask({ width: 16, height: 16, bits: new Uint8Array(3) }, new Uint8ClampedArray(16 * 16 * 4)),
    ).toThrow(/border mask/);
  });
});
