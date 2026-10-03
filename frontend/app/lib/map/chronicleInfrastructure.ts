import {
  MAX_PAINTABLE_PROVINCE_ID,
  type NationColorLut,
} from "./chroniclePaint";

export const INFRASTRUCTURE_TERRAIN_MIN = 0.3;
export const INFRASTRUCTURE_TERRAIN_MAX = 0.75;
export const INFRASTRUCTURE_COLOR_STOPS = [
  [244, 160, 160],
  [140, 70, 170],
  [20, 40, 120],
] as const;
export const INFRASTRUCTURE_PAINT_ALPHA = 140;

export function infrastructureColor(value: number): [number, number, number] | null {
  if (!Number.isFinite(value)) return null;
  const t = Math.max(
    0,
    Math.min(
      1,
      (value - INFRASTRUCTURE_TERRAIN_MIN) /
        (INFRASTRUCTURE_TERRAIN_MAX - INFRASTRUCTURE_TERRAIN_MIN)
    )
  );
  const stops = INFRASTRUCTURE_COLOR_STOPS;
  const first = t <= 0.5 ? stops[0] : stops[1];
  const second = t <= 0.5 ? stops[1] : stops[2];
  const fraction = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
  return [0, 1, 2].map((channel) =>
    Math.round(first[channel]! + (second[channel]! - first[channel]!) * fraction)
  ) as [number, number, number];
}

/** Builds the stored day's effective-terrain wash; absent/bad rows stay clear. */
export function buildInfrastructureColorLut(payload: unknown): NationColorLut {
  if (!Array.isArray(payload)) return new Uint32Array(0);
  const usable: { id: number; value: number }[] = [];
  let maxId = 0;
  for (const item of payload) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as { id?: unknown; terrain?: unknown; effective_terrain?: unknown };
    if (
      typeof row.id !== "number" || !Number.isInteger(row.id) || row.id <= 0 ||
      row.id > MAX_PAINTABLE_PROVINCE_ID ||
      row.terrain === "sea" || row.terrain === "water" ||
      typeof row.effective_terrain !== "number" || !Number.isFinite(row.effective_terrain)
    ) continue;
    usable.push({ id: row.id, value: row.effective_terrain });
    maxId = Math.max(maxId, row.id);
  }
  if (!maxId) return new Uint32Array(0);
  const lut = new Uint32Array(maxId + 1);
  const cache = new Map<string, number>();
  for (const { id, value } of usable) {
    const color = infrastructureColor(value);
    if (!color) continue;
    const key = color.join(",");
    let packed = cache.get(key);
    if (packed === undefined) {
      packed = ((color[0] << 24) | (color[1] << 16) | (color[2] << 8) | INFRASTRUCTURE_PAINT_ALPHA) >>> 0;
      cache.set(key, packed);
    }
    lut[id] = packed;
  }
  return lut;
}
