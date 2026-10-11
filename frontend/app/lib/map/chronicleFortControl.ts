import { assertChronicleGridShape, type ChronicleBorderMask } from "./chronicleBorderMask";
import { MAX_PAINTABLE_PROVINCE_ID, type ProvinceIdGrid } from "./chroniclePaint";
import type { MapMarkersResponse } from "../../components/map/types";

/**
 * Fort zones of control for one stored day, rebuilt from the province ids the
 * day itself recorded.
 *
 * The live map shows a ZoC as a server-rendered `/{map}/zoc/{fort}.png`, and
 * the chronicle deliberately cannot use those: they are regenerated from
 * *today's* forts, so `MapCanvas` blocks them for a stored day and
 * `chronicle_routes` records the same limitation. The captured
 * `zoc_overlays` file is no help either — it holds a bounding box per fort and
 * nothing about the shape inside it.
 *
 * What the day *does* carry is `forts[].zoc_provinces`, the exact list
 * `zocgen.build_zoc_overlay_image` masks the hatch against. Rebuilding from
 * that against the same province id grid gives the historically correct zone
 * for the day being shown, not today's, and costs no source the `forts` toggle
 * was not already fetching.
 *
 * The hatch is `zocgen`'s own: an 80-pixel tile at the 6400-wide source, red
 * where `(x + y) % 80 < 32` and transparent elsewhere. The shipped
 * `assets/map/zoc_hatch.png` is pixel-for-pixel that formula, so there is one
 * pattern to match rather than two.
 *
 * Pure over typed arrays, like the other chronicle paint modules.
 */

/** `zocgen._HATCH_COLOR`. */
export const CHRONICLE_ZOC_HATCH_RGBA = [210, 35, 45, 210] as const;

/** `_HATCH_LINE_WIDTH + _HATCH_GAP` and `_HATCH_LINE_WIDTH`, at 6400 wide. */
const HATCH_PERIOD_AT_SOURCE = 80;
const HATCH_LINE_AT_SOURCE = 32;
const SOURCE_WIDTH = 6400;

/**
 * The hatch stripe geometry at whatever resolution the grid runs at. Scaled
 * rather than fixed so the quarter-scale grid gets stripes of the same visual
 * width as the server's, and both floors clamp at 1: a period that rounds to 0
 * would divide by zero, and a line width of 0 would draw nothing at all.
 */
export function chronicleZocHatchMetrics(gridWidth: number): {
  period: number;
  line: number;
} {
  const scale = gridWidth / SOURCE_WIDTH;
  return {
    period: Math.max(1, Math.round(HATCH_PERIOD_AT_SOURCE * scale)),
    line: Math.max(1, Math.round(HATCH_LINE_AT_SOURCE * scale)),
  };
}

/**
 * Every province under any fort's zone of control on this day.
 *
 * The union, not per fort: the mask is one bit deep, overlapping zones are
 * indistinguishable once hatched anyway, and the live map only ever shows one
 * fort's zone at a time so there is no per-fort look to preserve.
 *
 * `forts` and each `zoc_provinces` come straight off the wire, so both are
 * shape-checked before being walked — `?? []` would still let an object
 * through to `for...of` and blank the page mid-render.
 */
export function fortZocProvinceIds(markers: MapMarkersResponse | null): number[] {
  const forts = Array.isArray(markers?.forts) ? markers.forts : [];
  const seen = new Set<number>();
  for (const fort of forts) {
    const ids = Array.isArray(fort?.zoc_provinces) ? fort.zoc_provinces : [];
    for (const id of ids) {
      if (!Number.isInteger(id) || id <= 0 || id > MAX_PAINTABLE_PROVINCE_ID) {
        continue;
      }
      seen.add(id as number);
    }
  }
  return Array.from(seen);
}

/**
 * The day's zones of control, hatched and packed 1 bit per grid pixel.
 *
 * The stripes are baked into the mask rather than applied when it is expanded,
 * which is what keeps this the same single-ink overlay a border mask is: the
 * server bakes them the same way, into the PNG.
 *
 * Null when no fort on this day holds a zone, so a day before any fort existed
 * allocates nothing and leaves the overlay canvas unmounted.
 */
export function computeChronicleZocMask(grid: ProvinceIdGrid, zocProvinceIds: number[]): ChronicleBorderMask | null {
  if (!zocProvinceIds.length) return null;
  const pixelCount = assertChronicleGridShape(grid);
  const { width, height, ids } = grid;

  let maxProvinceId = 0;
  for (const id of zocProvinceIds) {
    if (Number.isInteger(id) && id > maxProvinceId) maxProvinceId = id;
  }
  const inZone = new Uint8Array(maxProvinceId + 1);
  for (const id of zocProvinceIds) {
    if (Number.isInteger(id) && id > 0 && id <= maxProvinceId) inZone[id] = 1;
  }

  const { period, line } = chronicleZocHatchMetrics(width);
  const bits = new Uint8Array((pixelCount + 7) >> 3);
  let any = false;

  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const id = ids[i]!;
      if (id > maxProvinceId || inZone[id] !== 1) continue;
      if ((x + y) % period >= line) continue;
      any = true;
      bits[i >> 3] |= 1 << (i & 7);
    }
  }

  return any ? { width, height, bits } : null;
}
