import type { MapId } from "@/app/components/map/types";

/**
 * Exactly `YYYY-MM-DD`, anchored at both ends.
 *
 * The `day` route segment arrives from the URL bar, so it is attacker-supplied
 * text that ends up in a request path and, on the backend, in a
 * filesystem-backed lookup. This regex is *defence in depth*, not the only
 * guard: the backend is independently hardened against traversal, and every
 * helper in `chronicleData.ts` already runs the day through
 * `encodeURIComponent` before it reaches a URL. It exists so that a nonsense
 * segment produces a plain "not a valid date" page instead of a 404 from three
 * layers down, and so nothing arbitrary is ever handed to the data layer.
 *
 * Deliberately a *shape* check only. `2026-02-31` matches and is a real
 * `YYYY-MM-DD` string; whether that day was ever captured is answered by the
 * chronicle index, which is the only thing that actually knows.
 */
export const CHRONICLE_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Narrows unknown input — a route param is typed `string | string[]` at best —
 * to a day string of the right shape.
 */
export function isValidChronicleDay(value: unknown): value is string {
  return typeof value === "string" && CHRONICLE_DAY_PATTERN.test(value);
}

/**
 * `MapId` is the wire/API identifier; the public routes use a different word
 * for the dev map. Kept in one place so no component has to remember that
 * `"dev"` lives at `/map/r3b1rth`.
 */
const DEV_PUBLIC_SEGMENT = "r3b1rth";

export function isMapId(value: string): value is MapId {
  return value.length > 0 && /^[a-z0-9]+$/i.test(value);
}

/**
 * URL segment → wire map id. `r3b1rth` is the public name for `dev`.
 * `editor` is reserved for the title editor route, not a map.
 */
export function parseMapRouteSegment(value: unknown): MapId | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw || raw === "editor") return null;
  if (raw === DEV_PUBLIC_SEGMENT) return "dev";
  if (!isMapId(raw)) return null;
  return raw;
}

export function mapRouteSegment(mapId: MapId): string {
  return mapId === "dev" ? DEV_PUBLIC_SEGMENT : mapId;
}

/**
 * The map's own path, `/map/{segment}`. Pages nested under a map (chronicle,
 * staff console) build on this rather than on `liveMapHref`, because `main`'s
 * live map lives at the bare `/map` and `/map/chronicle` would read as a map
 * called "chronicle".
 */
export function mapBaseHref(mapId: MapId): string {
  return `/map/${mapRouteSegment(mapId)}`;
}

/** `/map` for `main`, `/map/r3b1rth` or `/map/{archive}` — the live map. */
export function liveMapHref(mapId: MapId): string {
  return mapId === "main" ? "/map" : mapBaseHref(mapId);
}

/** `/map/{map}/chronicle` — the timelapse studio. */
export function chronicleStudioHref(mapId: MapId): string {
  return `${mapBaseHref(mapId)}/chronicle`;
}

/**
 * The day span of the timelapse the reader came from, carried in the query so
 * previous/next on a stored day walks that same span rather than every day the
 * map has ever stored.
 */
export type ChronicleDayRange = { start: string; end: string };

/**
 * `/map/{map}/chronicle/{day}` — one stored day, explorable, optionally
 * carrying the timelapse span it was reached from.
 *
 * The day is encoded rather than interpolated raw. A well-formed day has
 * nothing to encode, but this is the same rule `chronicleDayFilePath` follows,
 * and a day string is never concatenated into a path by hand anywhere in the
 * codebase.
 */
export function chronicleDayHref(
  mapId: MapId,
  day: string,
  range?: ChronicleDayRange | null
): string {
  const href = `${chronicleStudioHref(mapId)}/${encodeURIComponent(day)}`;
  if (!range) return href;
  return `${href}?from=${encodeURIComponent(range.start)}&to=${encodeURIComponent(
    range.end
  )}`;
}

/**
 * Both halves arrive from the URL bar, so a range is only honoured when it is
 * fully well-formed. A partial or reversed range is treated as *no* range
 * rather than as an error: the day page still works without one, and silently
 * falling back to the full day list is better than refusing to render.
 */
export function parseChronicleDayRange(
  from: unknown,
  to: unknown
): ChronicleDayRange | null {
  if (!isValidChronicleDay(from) || !isValidChronicleDay(to)) return null;
  if (from > to) return null;
  return { start: from, end: to };
}

/**
 * Where `day` sits in the walkable day list, and which days flank it.
 *
 * `days` is unvalidated network JSON straight out of the chronicle index, and
 * there is no React error boundary anywhere under `app/` — a throw in here
 * blanks the whole page rather than one panel — so every entry is shape-checked
 * before it is used.
 *
 * `previous`/`next` are computed by comparison, not by index arithmetic, so
 * navigation still works when `day` itself falls outside the range (a reader
 * who edited the URL, or followed a link into a day the timelapse skipped).
 * `YYYY-MM-DD` is fixed-width, so lexicographic order is chronological order.
 */
export function chronicleDayWalk(
  days: unknown,
  day: string,
  range: ChronicleDayRange | null
): {
  days: string[];
  position: number;
  total: number;
  previous: string | null;
  next: string | null;
} {
  const source = Array.isArray(days) ? days.filter(isValidChronicleDay) : [];
  const deduped = Array.from(new Set(source)).sort();
  const walkable = range
    ? deduped.filter((d) => d >= range.start && d <= range.end)
    : deduped;

  let previous: string | null = null;
  let next: string | null = null;
  for (const candidate of walkable) {
    if (candidate < day) previous = candidate;
    else if (candidate > day && next === null) next = candidate;
  }

  return {
    days: walkable,
    position: walkable.indexOf(day) + 1,
    total: walkable.length,
    previous,
    next,
  };
}
