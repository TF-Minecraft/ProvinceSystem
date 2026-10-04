import { parseRgbString } from "@/app/lib/map/titleRgb";

import {
  createRgbaU32View,
  packRgbaForU32View,
} from "./editor/paintTitleLayers";
import {
  MAX_PAINTABLE_PROVINCE_ID,
  type NationOwnership,
  type ProvinceIdGrid,
} from "./chroniclePaint";

/**
 * Client-side port of the server's border painter
 * (`backend/src/scripts/util/border_paint.py`), reproducing its four rules:
 *
 * 1. `stroke_opaque_union_array` runs **once per owner**, on a buffer that
 *    holds only that owner's pixels: a pixel is a border pixel when it is
 *    opaque and any 4-neighbour is transparent. It keys on alpha, never RGB —
 *    colour differences *inside* one owner draw nothing, and a pixel of a
 *    different owner is transparent in this buffer, so it does count.
 * 2. Off-grid counts as transparent, so territory running off the map edge is
 *    still closed.
 * 3. Border pixels are dilated with a square stamp, `thickness` out and in.
 *    A nation-to-nation seam is struck twice — once from each side — so its
 *    dilated band is one pixel wider than a coastline's. That is the look.
 * 4. One unconditional ink, `INK_DARK`, so adjacent washed fills share the
 *    same stroke colour.
 *
 * The whole day is 1-bit information — border or not, in a single ink — so a
 * day is stored as a packed bitmask: 1600x1600 / 8 = 320,000 bytes, 32x
 * smaller than the 10.24 MB RGBA frame it describes. Only the day on screen
 * is ever expanded back to RGBA.
 *
 * Pure over typed arrays on purpose — no `ImageData`, no canvas — because the
 * tests run under node, exactly like `chroniclePaint.ts`.
 */

/** One chronicle day's borders, 1 bit per grid pixel, row-major, LSB first. */
export type ChronicleBorderMask = {
  width: number;
  height: number;
  /** Bit `i` of pixel index `i` is `(bits[i >> 3] >>> (i & 7)) & 1`. */
  bits: Uint8Array;
};

/**
 * The server's `INK_DARK = (42, 31, 20, 255)` — the same `#2a1f14` the label
 * layer calls `LABEL_INK`. Applied unconditionally, never tinted per nation.
 */
export const CHRONICLE_BORDER_INK_RGBA = [42, 31, 20, 255] as const;

/**
 * The 1600x1600 quarter-scale grid already costs a 5 MB RGBA expansion when
 * displayed; this cap (the 6400x6400 native source resolution) is the point
 * past which a malformed grid header stops sizing allocations. Same defence as
 * `MAX_PAINTABLE_PROVINCE_ID`: the dimensions arrive as unvalidated network
 * data, and without a ceiling a corrupt width wedges the tab in one `new`.
 */
export const MAX_BORDER_GRID_PIXELS = 6400 * 6400;

/**
 * Dilation half-width, scaled from the server's stamp. The server dilates with
 * `border_thickness = 5` at the 6400x6400 source — an 11x11 square per border
 * pixel, ~5 px out and ~5 px in from the edge. Scaled to the resolution this
 * pass runs at: `5 * width / 6400`, so the quarter-scale 1600 grid gets a
 * half-width of 1 — a 3x3 stamp, worth 12 source pixels against the server's
 * 11, the closest the coarser grid can come.
 */
export function chronicleBorderThickness(gridWidth: number): number {
  return Math.max(1, Math.round((5 * gridWidth) / 6400));
}

/**
 * Exported because the occupation and fort-control passes walk the very same
 * grid and must reject the very same corrupt headers; a second copy of this
 * check is a second place for the ceiling to drift.
 */
export function assertChronicleGridShape(grid: ProvinceIdGrid): number {
  const { width, height, ids } = grid;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_BORDER_GRID_PIXELS
  ) {
    throw new Error(
      `province id grid claims ${width}x${height}, outside 1..${MAX_BORDER_GRID_PIXELS} pixels`
    );
  }
  const pixelCount = width * height;
  if (ids.length !== pixelCount) {
    throw new Error(
      `province id grid has ${ids.length} ids for ${width}x${height}`
    );
  }
  return pixelCount;
}

/**
 * Province id -> 1-based owner ordinal; 0 is "no owner" (ocean, unclaimed, or
 * a nation the fill pass would not paint either).
 *
 * The owner key is the *nation*, not its colour, because the server strokes
 * each nation's own buffer: two nations that happen to share an `rgb` still
 * strike the seam between them. Nations with an unparseable `rgb` are skipped
 * to match `buildNationColorLut` — territory the fill cannot paint must not
 * grow an outline around invisible land.
 */
function buildNationOwnerLut(ownership: NationOwnership): Uint32Array {
  let maxProvinceId = 0;
  for (const nation of Object.values(ownership)) {
    for (const id of nation?.provinces ?? []) {
      if (
        Number.isInteger(id) &&
        id > maxProvinceId &&
        id <= MAX_PAINTABLE_PROVINCE_ID
      ) {
        maxProvinceId = id;
      }
    }
  }

  const lut = new Uint32Array(maxProvinceId + 1);
  let ordinal = 0;
  for (const nation of Object.values(ownership)) {
    if (!parseRgbString(nation?.rgb ?? "")) continue;
    ordinal++;
    for (const id of nation?.provinces ?? []) {
      if (!Number.isInteger(id) || id <= 0 || id > maxProvinceId) continue;
      lut[id] = ordinal;
    }
  }
  return lut;
}

/**
 * One day's border pass: per-owner rim detection and square dilation, packed
 * straight into the bitmask. Overlapping stamps OR together, so re-stamping a
 * pixel from both sides of a seam costs nothing and loses nothing — the extra
 * heaviness of a doubled seam is carried by *where* the two rims sit, exactly
 * as it is on the server.
 */
export function computeChronicleBorderMask(
  grid: ProvinceIdGrid,
  ownership: NationOwnership
): ChronicleBorderMask {
  const pixelCount = assertChronicleGridShape(grid);
  const { width, height, ids } = grid;

  const ownerLut = buildNationOwnerLut(ownership);
  const lutLength = ownerLut.length;
  const bits = new Uint8Array((pixelCount + 7) >> 3);

  const thickness = chronicleBorderThickness(width);

  const ownerAt = (index: number): number => {
    const id = ids[index]!;
    return id < lutLength ? ownerLut[id]! : 0;
  };

  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const owner = ownerAt(i);
      if (owner === 0) continue;

      // Off-grid is transparent in every owner's buffer, hence `x === 0` etc.
      // count as borders; so does a neighbour any *other* owner holds, because
      // in this owner's buffer that pixel is transparent too.
      const rim =
        x === 0 ||
        ownerAt(i - 1) !== owner ||
        x === width - 1 ||
        ownerAt(i + 1) !== owner ||
        y === 0 ||
        ownerAt(i - width) !== owner ||
        y === height - 1 ||
        ownerAt(i + width) !== owner;
      if (!rim) continue;

      const y0 = y < thickness ? 0 : y - thickness;
      const y1 = y + thickness >= height ? height - 1 : y + thickness;
      const x0 = x < thickness ? 0 : x - thickness;
      const x1 = x + thickness >= width ? width - 1 : x + thickness;
      for (let ny = y0; ny <= y1; ny++) {
        const row = ny * width;
        for (let nx = x0; nx <= x1; nx++) {
          const bit = row + nx;
          bits[bit >> 3] |= 1 << (bit & 7);
        }
      }
    }
  }

  return { width, height, bits };
}

export type ExpandBorderMaskOptions = {
  /**
   * Force the per-byte writer even when a 32-bit view is available — test-only,
   * for the same reason `paintChronicleFrame` has it: the fallback must be
   * exercised somewhere, not just carried.
   */
  forceByteLoop?: boolean;
  /**
   * Ink to expand the set bits into, defaulting to the border stroke.
   *
   * The packed mask turned out to be the right carrier for every single-ink
   * chronicle overlay, not just borders — the occupation seam and the fort-ZoC
   * hatch are the same 1-bit-per-pixel fact in a different colour — and one
   * expander with a colour beats three copies of this loop.
   */
  ink?: readonly [number, number, number, number];
};

/**
 * Expands one stored mask back into RGBA ink for the day being displayed.
 * Every pixel is written (ink or fully transparent), so the output needs no
 * clearing between days.
 */
export function expandChronicleBorderMask(
  mask: ChronicleBorderMask,
  output: Uint8ClampedArray,
  options: ExpandBorderMaskOptions = {}
): void {
  const pixelCount = mask.width * mask.height;
  if (mask.bits.length !== (pixelCount + 7) >> 3) {
    throw new Error(
      `border mask holds ${mask.bits.length} bytes for ${mask.width}x${mask.height}`
    );
  }
  if (output.length !== pixelCount * 4) {
    throw new Error(
      `border buffer holds ${output.length} bytes, expected ${pixelCount * 4} for ${mask.width}x${mask.height}`
    );
  }

  const [r, g, b, a] = options.ink ?? CHRONICLE_BORDER_INK_RGBA;
  const { bits } = mask;
  const u32 = options.forceByteLoop ? null : createRgbaU32View(output);

  if (u32) {
    const ink = packRgbaForU32View(r, g, b, a);
    for (let byte = 0, i = 0; byte < bits.length; byte++, i += 8) {
      const value = bits[byte]!;
      const end = i + 8 < pixelCount ? i + 8 : pixelCount;
      if (value === 0) {
        u32.fill(0, i, end);
        continue;
      }
      for (let p = i; p < end; p++) {
        u32[p] = (value >>> (p - i)) & 1 ? ink : 0;
      }
    }
    return;
  }

  for (let p = 0, offset = 0; p < pixelCount; p++, offset += 4) {
    const inked = (bits[p >> 3]! >>> (p & 7)) & 1;
    output[offset] = inked ? r : 0;
    output[offset + 1] = inked ? g : 0;
    output[offset + 2] = inked ? b : 0;
    output[offset + 3] = inked ? a : 0;
  }
}
