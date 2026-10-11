import { parseRgbString } from "@/app/lib/map/titleRgb";

import { createRgbaU32View, packRgbaForU32View } from "./editor/paintTitleLayers";

/**
 * Quarter-scale province id grid as `deserializeProvinceIdGrid` hands it back.
 * Id `0` is ocean / no province.
 */
export type ProvinceIdGrid = {
  width: number;
  height: number;
  ids: Uint16Array;
};

/**
 * Nation ownership straight out of a chronicle `nation.json` snapshot. `rgb` is
 * the backend's comma-separated triple, not a tuple.
 *
 * `occupied_held` is land this nation holds but does not own; the compiler
 * keeps it disjoint from `provinces`, so the fill pass below ignores it and
 * `chronicleOccupation` is what reads it.
 */
export type NationOwnership = Record<string, { rgb?: string; provinces?: number[]; occupied_held?: number[] }>;

/**
 * Province id -> colour, packed as 0xRRGGBBAA. That order is deliberately
 * *not* the machine's `Uint32Array` byte order: the LUT is a portable value
 * both the 32-bit and the per-byte paint paths read, and each converts on its
 * own terms. `0` is fully transparent, which is also what an id with no owner
 * and an id past the end of the LUT resolve to.
 */
export type NationColorLut = Uint32Array;

function packCanonicalRgba(r: number, g: number, b: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}

/**
 * `ProvinceIdGrid.ids` is a `Uint16Array`, so no pixel can ever name an id above
 * this. A day file is unvalidated network JSON: without the clamp a single
 * `"provinces": [2000000000]` sizes the LUT — and the per-frame device LUT that
 * `paintChronicleFrame` allocates and walks on *every* frame — at 8 GB and
 * wedges the main thread. Ids past the clamp are unreachable by the paint
 * anyway, so dropping them costs a corrupt day nothing it could have drawn.
 */
export const MAX_PAINTABLE_PROVINCE_ID = 0xffff;

/**
 * Builds the province -> packed colour table for one chronicle day.
 *
 * Nations with an unparseable `rgb` or no provinces contribute nothing, so
 * their land stays transparent and the parchment base map shows through.
 * If two nations claim the same province id the later entry wins; the snapshot
 * is not supposed to contain overlaps, and picking a side beats scanning for a
 * conflict that costs a frame to detect and cannot be resolved anyway.
 */
export function buildNationColorLut(ownership: NationOwnership): NationColorLut {
  let maxProvinceId = 0;
  for (const nation of Object.values(ownership)) {
    for (const id of nation?.provinces ?? []) {
      if (Number.isInteger(id) && id > maxProvinceId && id <= MAX_PAINTABLE_PROVINCE_ID) {
        maxProvinceId = id;
      }
    }
  }

  const lut = new Uint32Array(maxProvinceId + 1);
  for (const nation of Object.values(ownership)) {
    const parsed = parseRgbString(nation?.rgb ?? "");
    if (!parsed) continue;
    const packed = packCanonicalRgba(parsed[0], parsed[1], parsed[2]);
    for (const id of nation?.provinces ?? []) {
      // Ocean (0) is never owned, and a negative or fractional id is junk.
      if (!Number.isInteger(id) || id <= 0 || id > maxProvinceId) continue;
      lut[id] = packed;
    }
  }
  return lut;
}

export type PaintChronicleFrameOptions = {
  /**
   * Force the per-byte writer even when a 32-bit view is available. Only the
   * tests set this — it exists so the fallback path is actually exercised
   * instead of being dead code on every machine that allows the fast view.
   */
  forceByteLoop?: boolean;
};

/**
 * Fills `output` with one frame of nation ownership: one pass over the grid,
 * one LUT lookup per pixel, no per-province bookkeeping. Every pixel is
 * written, so `output` needs no clearing between frames.
 *
 * Pure over typed arrays on purpose — the timelapse studio runs this off a
 * worker and the tests run it under node, so nothing here may touch
 * `ImageData` or a canvas.
 */
export function paintChronicleFrame(
  grid: ProvinceIdGrid,
  lut: NationColorLut,
  output: Uint8ClampedArray,
  options: PaintChronicleFrameOptions = {},
): void {
  const pixelCount = grid.width * grid.height;
  if (grid.ids.length !== pixelCount) {
    throw new Error(`province id grid has ${grid.ids.length} ids for ${grid.width}x${grid.height}`);
  }
  if (output.length !== pixelCount * 4) {
    throw new Error(
      `frame buffer holds ${output.length} bytes, expected ${pixelCount * 4} for ${grid.width}x${grid.height}`,
    );
  }

  const { ids } = grid;
  const lutLength = lut.length;
  const u32 = options.forceByteLoop ? null : createRgbaU32View(output);

  if (u32) {
    // Re-pack the LUT into machine byte order once per frame (thousands of
    // entries) so the hot loop over millions of pixels is a plain store.
    const deviceLut = new Uint32Array(lutLength);
    for (let id = 0; id < lutLength; id++) {
      const packed = lut[id]!;
      if (packed === 0) continue;
      deviceLut[id] = packRgbaForU32View(
        (packed >>> 24) & 0xff,
        (packed >>> 16) & 0xff,
        (packed >>> 8) & 0xff,
        packed & 0xff,
      );
    }
    for (let i = 0; i < pixelCount; i++) {
      const id = ids[i]!;
      u32[i] = id < lutLength ? deviceLut[id]! : 0;
    }
    return;
  }

  for (let i = 0, offset = 0; i < pixelCount; i++, offset += 4) {
    const id = ids[i]!;
    const packed = id < lutLength ? lut[id]! : 0;
    output[offset] = (packed >>> 24) & 0xff;
    output[offset + 1] = (packed >>> 16) & 0xff;
    output[offset + 2] = (packed >>> 8) & 0xff;
    output[offset + 3] = packed & 0xff;
  }
}

/** Convenience for callers that hold raw ownership rather than a cached LUT. */
export function paintChronicleOwnership(
  grid: ProvinceIdGrid,
  ownership: NationOwnership,
  output: Uint8ClampedArray,
  options: PaintChronicleFrameOptions = {},
): void {
  paintChronicleFrame(grid, buildNationColorLut(ownership), output, options);
}

/**
 * Canvas-side wrapper. `ImageData` is used as a type only, so importing this
 * module still costs nothing in a DOM-less environment.
 */
export function paintChronicleFrameToImageData(
  imageData: ImageData,
  grid: ProvinceIdGrid,
  lut: NationColorLut,
  options: PaintChronicleFrameOptions = {},
): void {
  if (imageData.width !== grid.width || imageData.height !== grid.height) {
    throw new Error(`frame canvas is ${imageData.width}x${imageData.height}, grid is ${grid.width}x${grid.height}`);
  }
  paintChronicleFrame(grid, lut, imageData.data, options);
}
