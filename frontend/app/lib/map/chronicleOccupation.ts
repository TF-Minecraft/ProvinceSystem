import { parseRgbString } from "@/app/lib/map/titleRgb";

import { parchmentWashRgb } from "./displayColour";

import {
  assertChronicleGridShape,
  type ChronicleBorderMask,
} from "./chronicleBorderMask";
import {
  MAX_PAINTABLE_PROVINCE_ID,
  type NationColorLut,
  type NationOwnership,
  type ProvinceIdGrid,
} from "./chroniclePaint";

/**
 * Client-side port of how the server's pipeline distinguishes occupied land
 * from home land, so a conquest reads as a conquest in a timelapse instead of
 * as a clean handover on the day the province formally changes hands.
 *
 * Two independent marks, both taken from the pipeline:
 *
 * 1. The fill. Home land is `display_colour.display_rgb` — the parchment wash,
 *    not the faction's raw RGB. Occupied land is `occupation_display_rgb`: that
 *    washed colour muted 22% of the way toward its own luminance grey. The
 *    mute below is applied to the washed triple, which is the order the server
 *    uses, so home and occupied stay in the same relationship the overlay has.
 * 2. The seam. `border_paint.apply_occupation_seam_dashes` finds every
 *    occupation-side pixel that 4-neighbours the same nation's home wash and
 *    stamps it in `OCCUPATION_DASH_COLOR`. Its `dash_off` is 0, so the "dashes"
 *    are in fact continuous — every seam pixel is stamped — and reproducing the
 *    polyline walk would change nothing on screen.
 *
 * `occupied_held` is disjoint from `provinces` by construction
 * (`nation_compiler._occupied_held_by_nation` drops a province the occupier
 * already owns outright), which is exactly why the existing fill pass shows
 * nothing here: it reads `provinces` alone, so occupied land keeps the de jure
 * owner's colour right up until the transfer.
 *
 * Pure over typed arrays, like `chroniclePaint` and `chronicleBorderMask`: the
 * tests run under node and the studio calls this off the render path.
 */

/** The server's `OCCUPATION_DASH_COLOR`, stamped without tinting per nation. */
export const CHRONICLE_OCCUPATION_SEAM_RGBA = [150, 72, 66, 210] as const;

/** `display_colour.OCCUPATION_GREY_BLEND`. */
export const CHRONICLE_OCCUPATION_GREY_BLEND = 0.22;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * The occupier's colour, muted toward its own luminance grey. Same weights and
 * same blend the server uses, applied to whichever base colour the caller is
 * already painting home land with.
 */
export function occupationDisplayRgb(
  rgb: readonly [number, number, number]
): [number, number, number] {
  const [r, g, b] = rgb;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const blend = CHRONICLE_OCCUPATION_GREY_BLEND;
  return [
    clampByte(r + (luminance - r) * blend),
    clampByte(g + (luminance - g) * blend),
    clampByte(b + (luminance - b) * blend),
  ];
}

function packCanonicalRgba(r: number, g: number, b: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}

/**
 * Every list here is unvalidated network JSON: a day file whose `provinces` is
 * an object reaches `for...of` and takes the page down, and there is no error
 * boundary under `app/` to catch it.
 */
function provinceIds(value: unknown): number[] {
  return Array.isArray(value) ? (value as number[]) : [];
}

function maxProvinceIdIn(lists: number[][]): number {
  let max = 0;
  for (const list of lists) {
    for (const id of list) {
      if (Number.isInteger(id) && id > max && id <= MAX_PAINTABLE_PROVINCE_ID) {
        max = id;
      }
    }
  }
  return max;
}

export type ChronicleFillOptions = {
  /** The `nationFill` toggle: home territory in each nation's own colour. */
  fill: boolean;
  /** The `occupation` toggle: occupied territory in the occupier's muted colour. */
  occupation: boolean;
};

/**
 * The province -> colour table for one day, given which of the two fill layers
 * are on.
 *
 * Both layers share the one fill canvas rather than stacking a second one:
 * they are the same kind of mark — a province painted a colour — and a second
 * full-resolution canvas per frame would double what a built timelapse holds in
 * memory for no visual difference. With `fill` off and `occupation` on the
 * table carries occupied land only, which is a legible frame on its own:
 * conquered ground stands as coloured patches on bare parchment.
 *
 * Occupation is written second so it wins any province a malformed day claims
 * in both lists. Real days never overlap — see the module note.
 */
export function chronicleDayColorLut(
  ownership: NationOwnership | null,
  options: ChronicleFillOptions
): NationColorLut {
  const nations = ownership ? Object.values(ownership) : [];
  const homeLists = options.fill
    ? nations.map((nation) => provinceIds(nation?.provinces))
    : [];
  const occupiedLists = options.occupation
    ? nations.map((nation) => provinceIds(nation?.occupied_held))
    : [];

  const maxProvinceId = maxProvinceIdIn([...homeLists, ...occupiedLists]);
  const lut = new Uint32Array(maxProvinceId + 1);

  const write = (lists: number[][], mute: boolean) => {
    nations.forEach((nation, index) => {
      const parsed = parseRgbString(nation?.rgb ?? "");
      if (!parsed) return;
      const home = parchmentWashRgb(parsed);
      const rgb = mute ? occupationDisplayRgb(home) : home;
      const packed = packCanonicalRgba(rgb[0], rgb[1], rgb[2]);
      for (const id of lists[index] ?? []) {
        // Ocean (0) is never owned, and a negative or fractional id is junk.
        if (!Number.isInteger(id) || id <= 0 || id > maxProvinceId) continue;
        lut[id] = packed;
      }
    });
  };

  write(homeLists, false);
  write(occupiedLists, true);
  return lut;
}

/**
 * Dilation half-width for the seam stamp, scaled off the server's
 * `OCCUPATION_DASH_THICKNESS = 1` at the 6400-wide source — a 3x3 stamp there.
 * The quarter-scale grid rounds that to 0, i.e. the bare seam pixel, which is
 * already 4 source pixels wide and so the closest this resolution can come
 * without overshooting. Deliberately thinner than `chronicleBorderThickness`,
 * exactly as the server's 1 is thinner than its border 5.
 */
export function chronicleOccupationSeamThickness(gridWidth: number): number {
  return Math.max(0, Math.round(gridWidth / 6400));
}

/**
 * Province -> 1-based nation ordinal, one LUT per role. Keyed on the nation
 * rather than on its colour so the seam is found per nation, the way the server
 * runs its seam pass once per nation. Nations the fill cannot paint are skipped
 * in both, so no seam is ever drawn around invisible land.
 */
function buildRoleLuts(ownership: NationOwnership): {
  home: Uint32Array;
  occupied: Uint32Array;
} {
  const nations = Object.values(ownership);
  const homeLists = nations.map((nation) => provinceIds(nation?.provinces));
  const occupiedLists = nations.map((nation) =>
    provinceIds(nation?.occupied_held)
  );
  const maxProvinceId = maxProvinceIdIn([...homeLists, ...occupiedLists]);

  const home = new Uint32Array(maxProvinceId + 1);
  const occupied = new Uint32Array(maxProvinceId + 1);
  let ordinal = 0;
  nations.forEach((nation, index) => {
    if (!parseRgbString(nation?.rgb ?? "")) return;
    ordinal++;
    for (const id of homeLists[index] ?? []) {
      if (!Number.isInteger(id) || id <= 0 || id > maxProvinceId) continue;
      home[id] = ordinal;
    }
    for (const id of occupiedLists[index] ?? []) {
      if (!Number.isInteger(id) || id <= 0 || id > maxProvinceId) continue;
      occupied[id] = ordinal;
    }
  });

  return { home, occupied };
}

/**
 * The occupation seam for one day, packed 1 bit per grid pixel exactly like a
 * border mask: it is single-ink, single-day information, and at 1600 square a
 * packed mask is 320 KB against the 10.24 MB the RGBA it describes would cost
 * every frame of a build.
 *
 * Null when the day has no occupation at all, so a build over a peaceful
 * stretch allocates nothing and the overlay canvas stays unmounted.
 */
export function computeChronicleOccupationSeamMask(
  grid: ProvinceIdGrid,
  ownership: NationOwnership | null
): ChronicleBorderMask | null {
  if (!ownership) return null;
  const pixelCount = assertChronicleGridShape(grid);
  const { width, height, ids } = grid;

  const { home, occupied } = buildRoleLuts(ownership);
  const lutLength = occupied.length;
  if (lutLength <= 1) return null;

  const thickness = chronicleOccupationSeamThickness(width);
  const bits = new Uint8Array((pixelCount + 7) >> 3);
  let any = false;

  const homeAt = (index: number): number => {
    const id = ids[index]!;
    return id < lutLength ? home[id]! : 0;
  };

  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const id = ids[i]!;
      const occupier = id < lutLength ? occupied[id]! : 0;
      if (occupier === 0) continue;

      // Off-grid is not a seam: the server stamps only where an occupied pixel
      // touches that same nation's *home* wash, so the map edge closes nothing.
      const seam =
        (x > 0 && homeAt(i - 1) === occupier) ||
        (x < width - 1 && homeAt(i + 1) === occupier) ||
        (y > 0 && homeAt(i - width) === occupier) ||
        (y < height - 1 && homeAt(i + width) === occupier);
      if (!seam) continue;

      any = true;
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

  return any ? { width, height, bits } : null;
}
