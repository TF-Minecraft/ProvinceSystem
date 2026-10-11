import { MAX_PAINTABLE_PROVINCE_ID, type NationColorLut } from "./chroniclePaint";

/**
 * The prosperity heat map for one stored day, built from the captured
 * `province_data.json`.
 *
 * That file is the one per-day payload that carries a *number per province*
 * rather than a list of provinces per owner, so it is the only chronicle layer
 * whose subject is a quantity. Everything below is about making a quantity
 * readable across a timelapse rather than within a single frame.
 *
 * Pure over typed arrays, like the other chronicle paint modules: the tests run
 * under node and the studio calls this off the render path.
 */

/**
 * The payload is a JSON *list*, not an object keyed by id — unlike every other
 * chronicle day file. Every field is optional here because it all arrives as
 * unvalidated network JSON and there is no error boundary under `app/`: a throw
 * while building this LUT blanks the whole page, so a torn row has to be a
 * missing province rather than an exception.
 */
export type ChronicleProvinceDatum = {
  id?: unknown;
  prosperity?: unknown;
};

/**
 * Top of the ramp's domain, in raw prosperity units.
 *
 * Fixed, **not** rescaled per day, and that is the whole design of this layer.
 * A per-day rescale normalises every frame to its own maximum, so the day one
 * province first turns green looks exactly like the day the whole map is rich:
 * the growth a timelapse exists to show is precisely what the rescale divides
 * out. With a fixed domain a colour means the same number on every frame, so a
 * province warming from day to day is warming on screen.
 *
 * The cost of a fixed domain is that it has to be chosen. On main's 806
 * provinces a stored day runs 0 to ~40 with a long tail — 134 provinces above
 * zero, most of them in single digits, one at 39.3 — so a linear 0..40 would
 * flatten almost the entire map onto the bottom stop. 100 with the log
 * compression below leaves headroom for a map that grows into it while still
 * spreading today's values over most of the ramp, and anything above it clamps
 * to the top stop rather than rescaling the days beneath it.
 */
export const CHRONICLE_PROSPERITY_DOMAIN_MAX = 100;

/**
 * How opaque the wash is over whatever fill sits beneath it. Partial on
 * purpose: with nation fill also on, the realm's own colour has to keep showing
 * through or the heat map is just a fill layer that replaced another one.
 */
export const CHRONICLE_PROSPERITY_ALPHA = 140;

/**
 * Viridis, five stops.
 *
 * Sequential and colourblind-safe: it is monotonic in lightness end to end, so
 * the ordering survives greyscale and survives every common form of colour
 * vision deficiency. Deliberately not a red-green ramp, which is the one that
 * collapses for deuteranopes — and not a diverging ramp either, since
 * prosperity has a floor rather than a meaningful midpoint.
 */
export const CHRONICLE_PROSPERITY_RAMP: readonly (readonly [number, number, number])[] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 144, 140],
  [94, 201, 98],
  [253, 231, 37],
];

/**
 * Raw prosperity -> 0..1 along the ramp.
 *
 * `log1p` rather than a straight ratio because the distribution is heavily
 * skewed: the handful of rich provinces would otherwise own the top nine tenths
 * of the ramp and every ordinary province would be indistinguishable at the
 * bottom. `log1p(0)` is 0, so an unprospering province still lands exactly on
 * the first stop instead of falling off the scale.
 *
 * Everything unusable — missing, null, a string, NaN — is *not* handled here;
 * this takes a number and the caller decides what a non-number means. A
 * negative value clamps to 0 rather than being dropped, since it is a value the
 * server could plausibly write and it unambiguously means "the bottom".
 */
export function chronicleProsperityFraction(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const capped = Math.min(value, CHRONICLE_PROSPERITY_DOMAIN_MAX);
  return Math.log1p(capped) / Math.log1p(CHRONICLE_PROSPERITY_DOMAIN_MAX);
}

/** Linear interpolation between the ramp's stops. `t` is clamped to 0..1. */
export function chronicleProsperityRgb(t: number): [number, number, number] {
  const stops = CHRONICLE_PROSPERITY_RAMP;
  const clamped = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const scaled = clamped * (stops.length - 1);
  const low = Math.min(Math.floor(scaled), stops.length - 2);
  const frac = scaled - low;
  const a = stops[low]!;
  const b = stops[low + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
}

/**
 * Province id -> packed heat colour for one day.
 *
 * Every province the day reports is painted, zero included: a flat floor-colour
 * map on day one is the honest picture of a world that has not prospered yet,
 * and it is what makes the first province to warm up visible at all. A province
 * the file does not mention stays transparent, so a partial capture shows a
 * hole rather than a false floor.
 *
 * Hostile-input rules, all of which must produce a missing province rather than
 * a throw: a non-array payload, a non-object row, an id that is not a positive
 * integer, an id past `MAX_PAINTABLE_PROVINCE_ID` (which would otherwise size
 * this array — and the per-frame device LUT `paintChronicleFrame` derives from
 * it — off a single crafted number), and a prosperity that is not a finite
 * number. A duplicate id keeps the last row, matching `buildNationColorLut`'s
 * rule for a province two owners both claim: picking a side beats scanning for
 * a conflict that cannot be resolved anyway.
 */
export function buildProsperityColorLut(payload: unknown): NationColorLut {
  const rows = Array.isArray(payload) ? (payload as unknown[]) : [];

  const usable: { id: number; value: number }[] = [];
  let maxProvinceId = 0;
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { id, prosperity } = row as ChronicleProvinceDatum;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || id > MAX_PAINTABLE_PROVINCE_ID) {
      continue;
    }
    if (typeof prosperity !== "number" || !Number.isFinite(prosperity)) {
      continue;
    }
    usable.push({ id, value: prosperity });
    if (id > maxProvinceId) maxProvinceId = id;
  }

  if (!maxProvinceId) return new Uint32Array(0);

  const lut = new Uint32Array(maxProvinceId + 1);
  // The ramp is smooth but the LUT is not: identical values are common (806
  // provinces, most of them at 0), so the interpolation is memoised on the
  // rounded fraction rather than run per province.
  const cache = new Map<number, number>();
  for (const { id, value } of usable) {
    const key = Math.round(chronicleProsperityFraction(value) * 512);
    let packed = cache.get(key);
    if (packed === undefined) {
      const [r, g, b] = chronicleProsperityRgb(key / 512);
      packed = ((r << 24) | (g << 16) | (b << 8) | CHRONICLE_PROSPERITY_ALPHA) >>> 0;
      cache.set(key, packed);
    }
    lut[id] = packed;
  }
  return lut;
}
