import type { TitleEntity } from "../titleProvinces";

export type CountyNameEntry = TitleEntity & { name?: unknown };

/**
 * Province id -> county display name, from a county JSON object.
 *
 * Direct `provinces` only: a province nested under a child title belongs to
 * that child, which is its own entry, so walking titles would attribute it to
 * the parent as well. Last writer wins if two counties claim the same id.
 */
export function buildProvinceCountyNames(counties: Record<string, CountyNameEntry>): Map<number, string> {
  const map = new Map<number, string>();
  if (!counties || typeof counties !== "object" || Array.isArray(counties)) {
    return map;
  }

  for (const [countyId, entry] of Object.entries(counties)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const provinces = entry.provinces;
    if (!Array.isArray(provinces)) continue;

    const name = typeof entry.name === "string" && entry.name.length > 0 ? entry.name : countyId;

    for (const pid of provinces) {
      if (typeof pid !== "number" || !Number.isInteger(pid)) continue;
      map.set(pid, name);
    }
  }

  return map;
}
