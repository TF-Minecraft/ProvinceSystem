import type { MapMode } from "@/app/components/map/types";

import type { ChronicleFileName } from "./chronicleData";
import type { NationColorLut } from "./chroniclePaint";
import { buildInfestationColorLut } from "./chronicleInfestation";
import { buildProsperityColorLut } from "./chronicleProsperity";

/**
 * How each map mode answers the question "what did this look like on day D?".
 *
 * There are three answers, and the whole day page hangs off telling them apart:
 *
 *  - **Day-varying** — `nation`, `trade`, `prosperity`, `empire`,
 *    `infestation`, plus the title tiers `county`, `duchy`, `kingdom`. These
 *    are game state. They must come out of that day's capture, and rendering
 *    the live version of any of them under a past date would be fabricated
 *    history.
 *
 *  - **Static** - `terrain`, `fertility`, `province`. These are province
 *    geometry, not state: they are the same on every day, so the live source
 *    *is* the historical answer. Serving them live is correct, not a leak, and
 *    it is why they are not captured.
 *
 *  - Region-record vs province-quantity, which cuts across the first split and
 *    is what `CHRONICLE_PROVINCE_PAINT_SOURCE` below is about.
 *
 * Kept in one module, pure, so the split is testable: the components that act
 * on it ship untested (vitest here is node-env, `app/**\/*.test.ts` only).
 */
export const CHRONICLE_STATIC_MODES: ReadonlySet<MapMode> = new Set<MapMode>([
  "terrain",
  "fertility",
  "province",
]);

/**
 * True for a mode whose live source is also its historical answer.
 *
 * Takes `MapMode | string` because callers hold the mode as a loose string in
 * a couple of places (`useMapModeData`), and an unknown string is *not* static:
 * a mode nobody has classified must fall through to the day-scoped path and its
 * honest "not recorded" panel rather than quietly serving today's data.
 */
export function isChronicleStaticMode(mapType: MapMode | string): boolean {
  return CHRONICLE_STATIC_MODES.has(mapType as MapMode);
}

/**
 * The modes drawn as a full-map raster over the base map rather than as region
 * shapes — on the live map, `/{mapId}/mapdata/{mode}` — and so the modes that
 * never appear in `CHRONICLE_MODE_SOURCE`, which is about region records.
 */
export const PROVINCE_RASTER_MODES: ReadonlySet<MapMode> = new Set<MapMode>([
  "terrain",
  "fertility",
  "province",
  "prosperity",
  "infestation",
]);

/**
 * The day-varying raster modes and the captured file each one paints from.
 *
 * Deliberately separate from `CHRONICLE_MODE_SOURCE`. That map's contract is
 * "region records keyed by id, each with an `rgb`", which is the shape
 * `fetchMapModeRegionData` returns and `filterMapModeRegions` filters. Neither
 * file here is that shape: `province_data.json` is a *list* of
 * `{ id, prosperity, trade, ... }` and `infestation_data.json` is a list of
 * `{ id, severity }`. Both answer per-province quantities that need a ramp or a
 * palette to become colour, and that policy lives in `chronicleProsperity` and
 * `chronicleInfestation`. Routing them through the region-record map would mean
 * either lying about their shape or teaching a data source about colour ramps.
 */
export const CHRONICLE_PROVINCE_PAINT_SOURCE: Partial<
  Record<MapMode, ChronicleFileName>
> = {
  prosperity: "province_data",
  infestation: "infestation_data",
};

/**
 * Where one raster mode's pixels come from.
 *
 * `null` means "this mode draws no province raster at all" — the region modes —
 * and is distinct from `{ kind: "live" }`, which means "this mode draws the
 * live raster, and that is the right answer for this day".
 */
export type ChronicleProvincePaintSource =
  | { kind: "live" }
  | { kind: "day"; day: string; mapType: MapMode; file: ChronicleFileName };

export function chronicleProvincePaintSource(
  mapType: MapMode | string,
  day: string | null
): ChronicleProvincePaintSource | null {
  if (!PROVINCE_RASTER_MODES.has(mapType as MapMode)) return null;
  // The live map is unchanged, byte for byte: every raster mode is live.
  if (day === null) return { kind: "live" };
  // Terrain, fertility and the province pick map are province geometry. Their
  // raster is identical on every day, so the live PNG is the historical picture.
  if (isChronicleStaticMode(mapType)) return { kind: "live" };
  const file = CHRONICLE_PROVINCE_PAINT_SOURCE[mapType as MapMode];
  if (!file) return { kind: "live" };
  return { kind: "day", day, mapType: mapType as MapMode, file };
}

/**
 * True when `MapCanvas` should render the server's `/{mapId}/mapdata/{mode}`
 * image. False for a day-varying raster under a stored day — that is the
 * second of the two live-leak paths, and the one an allow-list widening would
 * have left wide open, since this `<img>` has never known what day it is.
 */
export function showsLiveProvinceRaster(
  mapType: MapMode | string,
  day: string | null
): boolean {
  return chronicleProvincePaintSource(mapType, day)?.kind === "live";
}

/** True when the raster must instead be painted from a captured day file. */
export function usesChronicleProvincePaint(
  mapType: MapMode | string,
  day: string | null
): boolean {
  return chronicleProvincePaintSource(mapType, day)?.kind === "day";
}

/**
 * A day file's raw payload -> the packed colour LUT its mode paints with.
 *
 * The dispatch is here rather than in the fetching hook so the mapping from
 * mode to ramp is a pure function with a test, and so the two builders keep
 * owning their own hostile-input rules. An unclassified mode yields an empty
 * LUT, which paints nothing — the same as a capture with no usable rows.
 */
export function chronicleProvincePaintLut(
  mapType: MapMode | string,
  payload: unknown
): NationColorLut {
  if (mapType === "prosperity") return buildProsperityColorLut(payload);
  if (mapType === "infestation") return buildInfestationColorLut(payload);
  return new Uint32Array(0);
}
