import { describe, expect, it } from "vitest";

import {
  MAX_PAINTABLE_PROVINCE_ID,
  buildNationColorLut,
  paintChronicleFrame,
  paintChronicleFrameToImageData,
  paintChronicleOwnership,
  type NationOwnership,
  type ProvinceIdGrid,
} from "./chroniclePaint";

/** 4x2: two provinces, one ocean strip, one province nobody owns. */
function makeGrid(ids: number[], width: number, height: number): ProvinceIdGrid {
  return { width, height, ids: Uint16Array.from(ids) };
}

const ownership: NationOwnership = {
  RED: { id: "RED", rgb: "229,60,112", provinces: [1, 2] },
  BLUE: { rgb: "10,20,30", provinces: [3] },
  NOCOLOR: { provinces: [4] },
  NOLAND: { rgb: "1,2,3", provinces: [] },
} as NationOwnership;

function expectPixel(
  buffer: Uint8ClampedArray,
  index: number,
  rgba: [number, number, number, number]
): void {
  expect(Array.from(buffer.slice(index * 4, index * 4 + 4))).toEqual(rgba);
}

describe("buildNationColorLut", () => {
  it("packs owned provinces and leaves unowned ids at zero", () => {
    const lut = buildNationColorLut(ownership);

    expect(lut.length).toBe(5);
    expect(lut[0]).toBe(0);
    expect(lut[1]).toBe(((229 << 24) | (60 << 16) | (112 << 8) | 255) >>> 0);
    expect(lut[2]).toBe(lut[1]);
    expect(lut[3]).toBe(((10 << 24) | (20 << 16) | (30 << 8) | 255) >>> 0);
    // NOCOLOR owns 4 but has no rgb, so it contributes nothing.
    expect(lut[4]).toBe(0);
  });

  it("lets the later nation win a province claimed twice", () => {
    const lut = buildNationColorLut({
      FIRST: { rgb: "1,1,1", provinces: [7] },
      SECOND: { rgb: "2,2,2", provinces: [7] },
    });

    expect(lut[7]).toBe(((2 << 24) | (2 << 16) | (2 << 8) | 255) >>> 0);
  });
});

describe("paintChronicleFrame", () => {
  const grid = makeGrid([1, 2, 0, 3, 4, 0, 1, 0], 4, 2);

  it("paints owner colours and leaves ocean transparent", () => {
    const output = new Uint8ClampedArray(4 * 2 * 4);
    paintChronicleOwnership(grid, ownership, output);

    expectPixel(output, 0, [229, 60, 112, 255]);
    expectPixel(output, 1, [229, 60, 112, 255]);
    expectPixel(output, 2, [0, 0, 0, 0]);
    expectPixel(output, 3, [10, 20, 30, 255]);
    // Province 4 has an owner with no usable rgb: still nothing painted.
    expectPixel(output, 4, [0, 0, 0, 0]);
    expectPixel(output, 5, [0, 0, 0, 0]);
    expectPixel(output, 6, [229, 60, 112, 255]);
    expectPixel(output, 7, [0, 0, 0, 0]);
  });

  it("leaves ids past the end of the lut transparent without touching neighbours", () => {
    const wide = makeGrid([1, 9000, 1, 0], 4, 1);
    const output = new Uint8ClampedArray(4 * 4);
    paintChronicleOwnership(wide, ownership, output);

    expectPixel(output, 0, [229, 60, 112, 255]);
    expectPixel(output, 1, [0, 0, 0, 0]);
    expectPixel(output, 2, [229, 60, 112, 255]);
    expectPixel(output, 3, [0, 0, 0, 0]);
  });

  it("overwrites the previous frame rather than compositing onto it", () => {
    const output = new Uint8ClampedArray(4 * 2 * 4).fill(200);
    paintChronicleOwnership(grid, ownership, output);

    expectPixel(output, 2, [0, 0, 0, 0]);
  });

  it("produces byte-identical output on the 32-bit and per-byte paths", () => {
    const lut = buildNationColorLut(ownership);
    const fast = new Uint8ClampedArray(4 * 2 * 4);
    const slow = new Uint8ClampedArray(4 * 2 * 4);

    paintChronicleFrame(grid, lut, fast);
    paintChronicleFrame(grid, lut, slow, { forceByteLoop: true });

    expect(Array.from(slow)).toEqual(Array.from(fast));
    // Guard against both paths silently doing nothing.
    expect(fast.some((byte) => byte !== 0)).toBe(true);
  });

  it("still paints correctly through a misaligned buffer (no 32-bit view)", () => {
    const backing = new ArrayBuffer(4 * 2 * 4 + 1);
    const offset = new Uint8ClampedArray(backing, 1, 4 * 2 * 4);
    paintChronicleOwnership(grid, ownership, offset);

    expectPixel(offset, 0, [229, 60, 112, 255]);
    expectPixel(offset, 2, [0, 0, 0, 0]);
  });

  it("rejects a frame buffer that does not match the grid dimensions", () => {
    const lut = buildNationColorLut(ownership);

    expect(() =>
      paintChronicleFrame(grid, lut, new Uint8ClampedArray(4 * 4))
    ).toThrow(/frame buffer holds 16 bytes, expected 32/);
  });

  it("rejects a grid whose id count disagrees with its dimensions", () => {
    const lut = buildNationColorLut(ownership);
    const broken = makeGrid([1, 2, 3], 4, 2);

    expect(() =>
      paintChronicleFrame(broken, lut, new Uint8ClampedArray(32))
    ).toThrow(/3 ids for 4x2/);
  });
});

describe("paintChronicleFrameToImageData", () => {
  it("rejects a canvas sized differently from the grid", () => {
    const grid = makeGrid([1, 2, 0, 3], 4, 1);
    const lut = buildNationColorLut(ownership);
    const imageData = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16),
    } as ImageData;

    expect(() => paintChronicleFrameToImageData(imageData, grid, lut)).toThrow(
      /frame canvas is 2x2, grid is 4x1/
    );
  });

  it("fills the image data buffer when the sizes agree", () => {
    const grid = makeGrid([1, 0, 3, 0], 4, 1);
    const lut = buildNationColorLut(ownership);
    const imageData = {
      width: 4,
      height: 1,
      data: new Uint8ClampedArray(16),
    } as ImageData;

    paintChronicleFrameToImageData(imageData, grid, lut);

    expectPixel(imageData.data, 0, [229, 60, 112, 255]);
    expectPixel(imageData.data, 2, [10, 20, 30, 255]);
  });
});

describe("buildNationColorLut against an unvalidated day file", () => {
  it("clamps the LUT to the largest id a Uint16 grid can name", () => {
    // Unvalidated ids must not allocate beyond the province grid's range.
    const lut = buildNationColorLut({
      Bomb: { rgb: "1,2,3", provinces: [2_000_000_000] },
    });

    expect(lut.length).toBeLessThanOrEqual(MAX_PAINTABLE_PROVINCE_ID + 1);
  });

  it("still sizes itself from the largest reachable id", () => {
    const lut = buildNationColorLut({
      Big: { rgb: "1,2,3", provinces: [MAX_PAINTABLE_PROVINCE_ID] },
    });

    expect(lut.length).toBe(MAX_PAINTABLE_PROVINCE_ID + 1);
    expect(lut[MAX_PAINTABLE_PROVINCE_ID]).not.toBe(0);
  });

  it("drops the oversized ids and keeps the rest of the realm paintable", () => {
    const lut = buildNationColorLut({
      Mixed: { rgb: "10,20,30", provinces: [1, 70_000, 2, 2_000_000_000] },
    });

    expect(lut.length).toBe(3);
    expect(lut[1]).not.toBe(0);
    expect(lut[2]).not.toBe(0);
  });

  it("paints a grid normally when every id was clamped away", () => {
    // A corrupt day should skip, not kill the studio: the LUT is empty, so the
    // parchment shows through and no pixel is left half-written.
    const grid = makeGrid([1, 2, 0, 3], 4, 1);
    const lut = buildNationColorLut({
      Bomb: { rgb: "1,2,3", provinces: [2_000_000_000] },
    });
    const output = new Uint8ClampedArray(16);

    expect(() => paintChronicleFrame(grid, lut, output)).not.toThrow();
    expect(Array.from(output)).toEqual(new Array(16).fill(0));
  });
});
