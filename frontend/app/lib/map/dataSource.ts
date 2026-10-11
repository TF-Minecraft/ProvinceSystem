import { fetchMapJson, fetchMapMarkers } from "@/lib/map/api";
import type { MapId, MapMarkersResponse, MapMode } from "@/app/components/map/types";

import {
  fetchChronicleDayFile,
  fetchChronicleDayMarkers,
  chronicleDayFilePath,
  chronicleDayMarkersPath,
} from "./chronicleData";
import { isChronicleStaticMode } from "./chronicleDayModes";

/**
 * The names the backend captures per day, defined once in
 * `backend/src/scripts/chronicle/store.py` (`CHRONICLE_FILES`) and mirrored
 * into TypeScript by `CHRONICLE_FILE_NAMES` in `./chronicleData`. Re-exported
 * rather than re-declared: a second literal union here could drift away from
 * the first one silently, and a day-file name that type-checks but does not
 * exist on disk is a 404 nobody sees until a user scrubs to that day.
 */
export type { ChronicleFileName } from "./chronicleData";
import type { ChronicleFileName } from "./chronicleData";

/**
 * Which day-varying map modes a stored day answers with a **region record** —
 * `{ rgb, provinces, ... }` keyed by id, the shape `fetchMapModeRegionData`
 * returns and `filterMapModeRegions` filters.
 *
 * Six of the ten modes qualify. `nation` and `trade` are the obvious ones.
 * `empire`, `county`, `duchy` and `kingdom` are title tiers that change as
 * players found titles, so a stored day must paint that day's files — serving
 * live de jure under a date stamp would be a leak. See
 * `CHRONICLE_STATIC_MODES` in `./chronicleDayModes` for the geography split
 * (terrain / fertility / province) that still uses the live source.
 *
 * `prosperity` and `infestation` are day-varying too, and this list still
 * refuses them on purpose. Their captures (`province_data.json`,
 * `infestation_data.json`) are *lists of per-province measurements*, not
 * coloured regions: no `rgb`, no province grouping. Turning them into colour
 * needs a ramp and a palette, which belong to the layers that choose them
 * (`chronicleProsperity`, `chronicleInfestation`), not to a data source. They
 * are routed instead through `CHRONICLE_PROVINCE_PAINT_SOURCE` in
 * `./chronicleDayModes`, which paints them client-side from that day's file.
 *
 * This map stays deliberately `Partial`, and the absence of a key still means
 * `unavailable` rather than a fall-through to the live endpoint: any *future*
 * mode nobody has classified gets the honest blank panel, not today's data
 * under a past date.
 */
export const CHRONICLE_MODE_SOURCE: Partial<Record<MapMode, ChronicleFileName>> = {
  nation: "nation",
  trade: "trade",
  empire: "empire",
  county: "county",
  duchy: "duchy",
  kingdom: "kingdom",
};

/**
 * Where one map mode's region data comes from.
 *
 * `unavailable` is a first-class member, not an error case, because the caller
 * has to be able to tell "this day has no duchies, and never will" apart from
 * "the request failed". The former renders a note and stops; the latter retries.
 */
export type MapDataSource =
  | { kind: "live"; path: string }
  | { kind: "day"; day: string; file: ChronicleFileName }
  | { kind: "unavailable"; day: string; mapType: MapMode };

/**
 * Thrown when a caller asks for region data for a mode the chronicle never
 * captured. Carries both halves of the question so the UI can say which mode
 * and which day, and is a distinct class so a `catch` can single it out
 * without string-matching a message.
 */
export class MapModeNotCapturedError extends Error {
  mapType: MapMode;
  day: string;

  constructor(mapType: MapMode, day: string) {
    super(`Map mode "${mapType}" was not captured for ${day}`);
    this.name = "MapModeNotCapturedError";
    this.mapType = mapType;
    this.day = day;
  }
}

export function isMapModeNotCaptured(error: unknown): error is MapModeNotCapturedError {
  return error instanceof MapModeNotCapturedError;
}

/**
 * `day === null` is the live map, and it must stay byte-for-byte what
 * `useMapModeData` built before the chronicle existed: `/${mapId}/data/${mapType}`.
 * Every day-scoped branch is reached only by explicitly passing a day, so no
 * existing caller can change behaviour by upgrading to this function.
 */
export function mapModeDataSource(mapId: MapId, mapType: MapMode, day: string | null): MapDataSource {
  if (day === null) {
    return { kind: "live", path: `/${mapId}/data/${mapType}` };
  }
  /**
   * A static mode's live source *is* its historical answer: terrain, fertility
   * and the province outline are geometry, which does not vary by day. Title
   * tiers are not static — they fall through to `CHRONICLE_MODE_SOURCE`.
   */
  if (isChronicleStaticMode(mapType)) {
    return { kind: "live", path: `/${mapId}/data/${mapType}` };
  }
  const file = CHRONICLE_MODE_SOURCE[mapType];
  if (!file) return { kind: "unavailable", day, mapType };
  return { kind: "day", day, file };
}

/**
 * `JSON.parse` turns a `"__proto__"` key in the wire payload into a real own
 * property, and copying that into a plain `{}` invokes
 * `Object.prototype.__proto__`'s setter instead of storing a region: the realm
 * disappears from the label pass while `buildNationColorLut` still paints its
 * provinces, and the object then answers truthily for keys it does not hold.
 * Same reasoning, and same fix, as `chronicleRegionData` in
 * `app/components/chronicle/chronicleLayers.ts`.
 *
 * Rebuilding onto a null prototype also strips the inherited `toString`,
 * `constructor` and friends that a region id could otherwise collide with.
 */
function toNullProtoRecord(value: unknown): Record<string, any> {
  const out: Record<string, any> = Object.create(null);
  // `Object.entries` reads own enumerable keys only, `__proto__` included, and
  // assignment onto a null-prototype target has no setter to hijack.
  for (const [key, entry] of Object.entries(value as object)) {
    out[key] = entry;
  }
  return out;
}

/**
 * A day file is a JSON object keyed by region id. Anything else — an array, a
 * bare string, `null` — means the capture wrote something we cannot interpret,
 * and handing it to the paint pass would throw somewhere far from here. There
 * is no React error boundary anywhere under `app/`, so a shape error during
 * render blanks the entire page rather than one panel; this check keeps the
 * failure inside the fetch, where a `catch` already exists.
 */
function isRegionRecordShape(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The one entry point for "give me this mode's regions, for this day or for
 * today". Callers pass `day: null` and get exactly the request they made
 * before; callers that pass a day get the stored capture or a hard error.
 *
 * Notably there is no fallback from `unavailable` to live. That is the product
 * rule the type system is enforcing: a mode with no per-day data must never
 * silently render the present under a past date.
 */
export async function fetchMapModeRegionData(args: {
  mapId: MapId;
  mapType: MapMode;
  day: string | null;
  sessionToken?: string | null;
  signal?: AbortSignal;
}): Promise<Record<string, any>> {
  const { mapId, mapType, day, sessionToken, signal } = args;
  const source = mapModeDataSource(mapId, mapType, day);

  if (source.kind === "unavailable") {
    throw new MapModeNotCapturedError(source.mapType, source.day);
  }

  if (source.kind === "live") {
    // Unchanged from what `useMapModeData` has always done, down to the
    // options object: the live path is the one thing that must not move.
    return fetchMapJson<Record<string, any>>(source.path, { sessionToken });
  }

  const file = await fetchChronicleDayFile<Record<string, any>>(mapId, source.day, source.file, sessionToken, signal);
  if (!isRegionRecordShape(file.value)) {
    throw new Error(`Chronicle ${source.day}/${source.file} is not a region object`);
  }
  return toNullProtoRecord(file.value);
}

/**
 * The live map's own filter, kept here so the day path and the live path agree
 * on what counts as a renderable region. Identical rule to
 * `chronicleRegionData` in `app/components/chronicle/chronicleLayers.ts` — that
 * one is typed for the studio's `NationRegionInput`, this one stays on the
 * loose `Record<string, any>` the live hook passes to `loadData`. Two call
 * sites, one rule; change both together.
 */
export function filterMapModeRegions(raw: Record<string, any>, mapType: MapMode | string): Record<string, any> {
  // Null-prototype for the same `__proto__` reason as `toNullProtoRecord`:
  // this object is keyed entirely by ids that arrived over the wire.
  const out: Record<string, any> = Object.create(null);
  for (const [id, region] of Object.entries(raw)) {
    // Always require RGB.
    if (typeof region?.rgb !== "string") continue;
    // Only the nation map additionally demands geometry to paint.
    if (mapType === "nation") {
      if (!Array.isArray(region.provinces) || region.provinces.length === 0) {
        continue;
      }
    }
    out[id] = region;
  }
  return out;
}

/**
 * Markers are the easy case: `map_markers` is one of the six captured files,
 * so every day has a variant and there is no `unavailable` arm. The live path
 * string is what `fetchMapMarkers` has always built.
 */
export function mapMarkersDataSource(
  mapId: MapId,
  day: string | null,
): { kind: "live"; path: string } | { kind: "day"; day: string; path: string } {
  if (day === null) return { kind: "live", path: `/${mapId}/data/markers` };
  // Built by `chronicleDayMarkersPath`, which does the `encodeURIComponent`.
  // Day strings are never concatenated into a URL by hand.
  return { kind: "day", day, path: chronicleDayMarkersPath(mapId, day) };
}

export async function fetchMapMarkersForDay(args: {
  mapId: MapId;
  day: string | null;
  sessionToken?: string | null;
  signal?: AbortSignal;
}): Promise<MapMarkersResponse> {
  const { mapId, day, sessionToken, signal } = args;
  if (day === null) return fetchMapMarkers(mapId, sessionToken);
  const file = await fetchChronicleDayMarkers(mapId, day, sessionToken, signal);
  // `fetchChronicleDayMarkers` hands back whatever `JSON.parse` produced, so a
  // stored `null` or a bare array arrives here typed as a response object. The
  // caller reaches straight into `.settlements`, and there is no error boundary
  // under `app/`, so an unchecked `null` blanks the page instead of one layer.
  if (!isRegionRecordShape(file.value)) {
    throw new Error(`Chronicle ${day}/map_markers is not a markers object`);
  }
  return file.value;
}

/**
 * The guild-name cache reads `/${mapId}/data/trade`, and `trade` is captured,
 * so it day-scopes to the `trade` chronicle file — the same file `trade` mode's
 * region data comes from. One capture, two readers.
 */
export function mapGuildsDataSource(
  mapId: MapId,
  day: string | null,
): { kind: "live"; path: string } | { kind: "day"; day: string; file: ChronicleFileName; path: string } {
  if (day === null) return { kind: "live", path: `/${mapId}/data/trade` };
  return {
    kind: "day",
    day,
    file: "trade",
    path: chronicleDayFilePath(mapId, day, "trade"),
  };
}

/**
 * Guild id -> display name, for the day asked about.
 *
 * Built on a null prototype because every key is a guild id straight off the
 * wire, and this map is later probed with `cache[id]` from hover handlers: on a
 * plain `{}` a lookup for `constructor` would answer with a function and put
 * `"function Object() ..."` in a tooltip. The name falls back to the id itself,
 * which is what the live cache has always done for a guild with no name set.
 */
export async function fetchGuildNameCache(args: {
  mapId: MapId;
  day: string | null;
  sessionToken?: string | null;
  signal?: AbortSignal;
}): Promise<Record<string, string>> {
  const { mapId, day, sessionToken, signal } = args;
  const source = mapGuildsDataSource(mapId, day);

  const guilds =
    source.kind === "live"
      ? await fetchMapJson<Record<string, { name?: string }>>(source.path, {
          sessionToken,
        })
      : (
          await fetchChronicleDayFile<Record<string, { name?: string }>>(
            mapId,
            source.day,
            source.file,
            sessionToken,
            signal,
          )
        ).value;

  const out: Record<string, string> = Object.create(null);
  if (!isRegionRecordShape(guilds)) return out;
  for (const [id, guild] of Object.entries(guilds)) {
    const name = (guild as { name?: unknown } | null)?.name;
    // `typeof` rather than `??` so a non-string `name` in a stored file cannot
    // put an object into a tooltip. An empty-string name still yields "",
    // exactly as `g.name ?? id` did, so the live map is unchanged.
    out[id] = typeof name === "string" ? name : id;
  }
  return out;
}
