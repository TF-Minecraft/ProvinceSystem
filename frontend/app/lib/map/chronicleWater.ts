import {
  MAX_PAINTABLE_PROVINCE_ID,
  type NationColorLut,
} from "./chroniclePaint";

/**
 * Terrains the live prosperity and trade generators refuse to paint.
 *
 * `prosperitygen.py` and the trade branch of `colour_mapping.py` both skip
 * `water` and `sea`. Those provinces still have ids, and a chronicle day will
 * happily list them, so the studio has to drop them itself or a league and a
 * heat map paint across the water the live map leaves bare.
 *
 * Nation fill, borders and occupation are not in this set. A realm can hold
 * water, and that ownership is still drawn.
 */
export const CHRONICLE_DISCARDED_TERRAINS: ReadonlySet<string> = new Set([
  "water",
  "sea",
]);

export function isChronicleDiscardedTerrain(terrain: unknown): boolean {
  return (
    typeof terrain === "string" &&
    CHRONICLE_DISCARDED_TERRAINS.has(terrain.trim().toLowerCase())
  );
}

/**
 * Province id -> 1 when that province is water or sea.
 *
 * Built from `/{map}/compiled_data/provinces`, which is keyed by id and carries
 * a `terrain` string. Only that field is read. The same payload also holds
 * today's prosperity and trade, and using either of those on a stored day
 * would paint the present onto the past.
 *
 * `null` means the payload is not a record of provinces at all, so there is
 * no mask to trust. An empty array means the record was readable and named no
 * water. Those two have to stay apart: an empty mask paints every province,
 * and a missing one must not.
 */
export function chronicleDiscardedProvinceMask(
  payload: unknown
): Uint8Array | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const hits: number[] = [];
  let maxId = 0;
  for (const [key, value] of Object.entries(payload)) {
    const id = Number(key);
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      id > MAX_PAINTABLE_PROVINCE_ID
    ) {
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    const terrain = (value as { terrain?: unknown }).terrain;
    if (!isChronicleDiscardedTerrain(terrain)) continue;
    hits.push(id);
    if (id > maxId) maxId = id;
  }

  if (!hits.length) return new Uint8Array(0);
  const mask = new Uint8Array(maxId + 1);
  for (const id of hits) mask[id] = 1;
  return mask;
}

/**
 * Zeros every province the mask marks, and returns the same table when nothing
 * changes.
 *
 * A missing or empty mask leaves the table alone. Callers that have not loaded
 * terrain yet must withhold the layer entirely rather than call this with a
 * stand-in, or the water paints until the fetch lands.
 */
export function omitDiscardedProvinces(
  lut: NationColorLut,
  mask: Uint8Array | null | undefined
): NationColorLut {
  if (!mask || mask.length === 0 || lut.length === 0) return lut;
  const limit = Math.min(lut.length, mask.length);
  let copy: NationColorLut | null = null;
  for (let id = 1; id < limit; id++) {
    if (mask[id] && lut[id]) {
      if (!copy) copy = lut.slice();
      copy[id] = 0;
    }
  }
  return copy ?? lut;
}
