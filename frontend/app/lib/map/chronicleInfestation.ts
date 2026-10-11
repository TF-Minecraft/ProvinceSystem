import { MAX_PAINTABLE_PROVINCE_ID, type NationColorLut } from "./chroniclePaint";

/**
 * The infestation heat map for one stored day, built from the captured
 * `infestation_data.json`.
 *
 * The live map serves this mode as a pre-rendered raster
 * (`/{map}/mapdata/infestation`), regenerated from *today's* upload with no
 * per-day variant, so a stored day has to paint it client-side from that day's
 * own file or it would show today's outbreak under a past date.
 *
 * Pure over typed arrays, like `chronicleProsperity`: the tests run under node
 * and the paint happens off the render path.
 */

/** One row of the file. Everything optional: it is unvalidated network JSON. */
export type ChronicleInfestationDatum = {
  id?: unknown;
  severity?: unknown;
};

/**
 * The exact palette `backend/src/scripts/mapgen/infestationgen.py`
 * (`SEVERITY_RGBA`) paints the live raster with, mirrored so a stored day and
 * the live map read as the same map mode rather than two different ones.
 * Yellow -> orange -> red -> near-black; deliberately no green, because every
 * value here is bad news and a green stop would read as "healthy".
 *
 * The alphas are the backend's too, and they are baked into the LUT below, so
 * the layer that draws this needs no opacity of its own.
 */
export const CHRONICLE_INFESTATION_SEVERITY_RGBA: Readonly<Record<string, readonly [number, number, number, number]>> =
  Object.assign(
    Object.create(null) as Record<string, never>,
    {
      mild: [230, 200, 40, 220],
      worrying: [220, 120, 20, 230],
      severe: [180, 20, 20, 240],
      extreme: [90, 0, 0, 255],
    } as const,
  );

/**
 * Severity string -> colour, or null for anything this palette does not name.
 *
 * Case- and whitespace-insensitive, matching the backend's
 * `str(severity).strip().lower()`. The palette is a null-prototype object
 * because the severity string arrives straight off the wire: on a plain `{}` a
 * row with `severity: "constructor"` would look up `Object.prototype`'s
 * function and be destructured into NaN colour channels.
 *
 * An unknown severity paints nothing rather than guessing a colour: inventing a
 * stop for a word the palette never had would put a number on the map that the
 * capture never contained.
 */
export function chronicleInfestationRgba(severity: unknown): readonly [number, number, number, number] | null {
  if (typeof severity !== "string") return null;
  const key = severity.trim().toLowerCase();
  if (!key) return null;
  return CHRONICLE_INFESTATION_SEVERITY_RGBA[key] ?? null;
}

/**
 * The payload arrives in one of two shapes, both of which the backend's
 * `load_infestation_by_id` accepts: a bare list of rows, or an object with a
 * `provinces` list. Anything else yields no rows rather than a throw — there is
 * no React error boundary under `app/`, so a shape surprise here would blank
 * the whole page instead of one layer.
 */
export function chronicleInfestationRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const rows = (payload as { provinces?: unknown }).provinces;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

/**
 * Province id -> packed severity colour for one day.
 *
 * Only infested provinces get an entry; everything else stays transparent so
 * the base map shows through, which is what the live raster does too.
 *
 * Hostile-input rules, each producing a skipped row rather than a throw: a
 * non-object row, an id that is not a positive integer (numeric strings are
 * accepted because the backend coerces with `int(row["id"])` and the plugin has
 * been seen to send both), an id past `MAX_PAINTABLE_PROVINCE_ID` — which would
 * otherwise size this array off a single crafted number — and a severity the
 * palette does not name. A duplicate id keeps the last row, matching
 * `buildProsperityColorLut` and `buildNationColorLut`.
 */
export function buildInfestationColorLut(payload: unknown): NationColorLut {
  const usable: { id: number; packed: number }[] = [];
  let maxProvinceId = 0;

  for (const row of chronicleInfestationRows(payload)) {
    if (typeof row !== "object" || row === null) continue;
    const { id, severity } = row as ChronicleInfestationDatum;

    const numericId = typeof id === "number" ? id : typeof id === "string" && id.trim() !== "" ? Number(id) : NaN;
    if (!Number.isInteger(numericId) || numericId <= 0 || numericId > MAX_PAINTABLE_PROVINCE_ID) {
      continue;
    }

    const rgba = chronicleInfestationRgba(severity);
    if (!rgba) continue;

    const [r, g, b, a] = rgba;
    usable.push({
      id: numericId,
      packed: ((r << 24) | (g << 16) | (b << 8) | a) >>> 0,
    });
    if (numericId > maxProvinceId) maxProvinceId = numericId;
  }

  if (!maxProvinceId) return new Uint32Array(0);

  const lut = new Uint32Array(maxProvinceId + 1);
  for (const { id, packed } of usable) lut[id] = packed;
  return lut;
}
