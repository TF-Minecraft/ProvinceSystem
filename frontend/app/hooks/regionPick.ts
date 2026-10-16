import type { HoverOverlay, RegionRecord } from "../components/map/types";
import type { PickSurface } from "../lib/map/pickSurface";
import { provinceAt, type ProvinceRunIndex } from "../lib/map/editor/buildProvinceIndex";
import type { TitleEntity, TitleLayers } from "../lib/titleProvinces";

export type GetHoverRegion = (
  mapType: string,
  mapId: string,
  regionId: string,
  regionData: RegionRecord,
) => {
  regionId: string | null;
  imagePath: string | null;
  region: Record<string, unknown> | null;
  overlay?: HoverOverlay["overlay"];
};

export type RegionPickResult = {
  pickId: string;
  regionId: string;
  region: Record<string, unknown>;
  imagePath: string | null;
  overlay?: HoverOverlay["overlay"];
};

/** Province-tooltip modes that own the pointer; region pick/click is suppressed. */
export function provinceHoverBlocksRegionPick(mapType: string): boolean {
  return (
    mapType === "terrain" ||
    mapType === "fertility" ||
    mapType === "prosperity" ||
    mapType === "infestation" ||
    mapType === "province"
  );
}

/** A region named outright (a pointed-at name), resolved as a pick would be. */
export function resolveRegionById(
  pickId: string,
  getHoverRegion: GetHoverRegion,
  mapType: string,
  mapId: string,
  regionData: RegionRecord | null,
): RegionPickResult | null {
  if (!regionData?.[pickId]) return null;
  const { regionId, imagePath, overlay, region } = getHoverRegion(mapType, mapId, pickId, regionData);
  if (!regionId || !region) return null;
  return { pickId, regionId, region, imagePath, overlay };
}

/**
 * How far a missed pick may reach for the nearest region, in pick pixels on
 * a full-size (6400 px) pick map. Region shapes cut water out, so a pond or
 * narrow river inside a realm is a hole in the pick map and an exact-pixel
 * pick drops the hover there. A short reach bridges those cutouts; open
 * water, further than this from any region, still picks nothing.
 */
const WATER_CUTOUT_REACH = 6;

/** Neighbour offsets within the reach, nearest first. */
const NEARBY_OFFSETS: Array<readonly [number, number]> = (() => {
  const offsets: Array<readonly [number, number]> = [];
  for (let dy = -WATER_CUTOUT_REACH; dy <= WATER_CUTOUT_REACH; dy++) {
    for (let dx = -WATER_CUTOUT_REACH; dx <= WATER_CUTOUT_REACH; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (dx * dx + dy * dy <= WATER_CUTOUT_REACH * WATER_CUTOUT_REACH) offsets.push([dx, dy]);
    }
  }
  return offsets.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
})();

/** The reach at a geometry width: reduced pick maps hold fewer, fatter pixels. */
function waterCutoutReachForWidth(width: number): number {
  if (width <= 0) return 0;
  return Math.max(2, Math.min(WATER_CUTOUT_REACH, Math.round(width / 1000)));
}

export function resolveRegionAtPickPixel(
  surface: PickSurface,
  x: number,
  y: number,
  rgbToId: Record<string, string>,
  getHoverRegion: GetHoverRegion,
  mapType: string,
  mapId: string,
  regionData: RegionRecord | null,
): RegionPickResult | null {
  if (!regionData) return null;

  /** Pick ids already resolved to nothing, so a watery neighbourhood is not re-walked per pixel. */
  const missed = new Set<string>();

  const resolveAt = (px: number, py: number): RegionPickResult | null => {
    const rgb = surface.rgbAt(px, py);
    if (rgb === null) return null;
    const pickId = rgbToId[rgb];
    if (!pickId || missed.has(pickId)) return null;

    const { regionId, imagePath, overlay, region } = getHoverRegion(mapType, mapId, pickId, regionData);
    if (!regionId || !region) {
      missed.add(pickId);
      return null;
    }

    return { pickId, regionId, region, imagePath, overlay };
  };

  const exact = resolveAt(x, y);
  if (exact) return exact;

  // A miss off the map has no land to bridge from.
  if (!(x >= 0 && y >= 0 && x < surface.width && y < surface.height)) return null;

  const reach = waterCutoutReachForWidth(surface.width);
  for (const [dx, dy] of NEARBY_OFFSETS) {
    if (dx * dx + dy * dy > reach * reach) break;
    const nearby = resolveAt(x + dx, y + dy);
    if (nearby) return nearby;
  }
  return null;
}

/** Province id -> the region id in `regionData` that directly holds it. */
export type ProvinceRegionIndex = Map<number, string>;

function provinceIdsOf(
  region: { provinces?: unknown; occupied_held?: unknown } | undefined,
  key: "provinces" | "occupied_held",
): number[] {
  const values = region?.[key];
  if (!Array.isArray(values)) return [];
  return values.filter((id) => typeof id === "number" && Number.isInteger(id) && id > 0);
}

/**
 * Membership for province-ID picking, built from the mode's own region data
 * so identity never passes through a display colour. Two passes: ordinary
 * holdings first, then `occupied_held`, so an occupier wins its provinces
 * over their legal owner exactly as the backend's occupation remap paints
 * them — regardless of record order.
 *
 * `discardedMask` (province id -> 1) drops provinces the mode's painter
 * refuses — trade's water and sea, whose dominant guilds are compiled into
 * the data but never painted. Nation passes none: a realm may hold water.
 */
export function buildProvinceRegionIndex(
  regionData: RegionRecord,
  discardedMask?: Uint8Array | null,
): ProvinceRegionIndex {
  const index: ProvinceRegionIndex = new Map();
  for (const key of ["provinces", "occupied_held"] as const) {
    for (const [pickId, region] of Object.entries(regionData)) {
      for (const provinceId of provinceIdsOf(region, key)) {
        if (discardedMask?.[provinceId] === 1) continue;
        index.set(provinceId, pickId);
      }
    }
  }
  return index;
}

function titleIdsOf(entity: TitleEntity | undefined): string[] {
  return Array.isArray(entity?.titles) ? entity.titles.filter((id) => typeof id === "string") : [];
}

/**
 * Membership for the title tiers, mirroring the backend painter
 * (`build_color_mapping`) exactly — chain, traversal order and erasure:
 * a province belongs to a duchy only through a county the duchy lists, to
 * a kingdom only through such a duchy, to an empire only through such a
 * kingdom. Direct `provinces` on an upper-tier entity and incomplete chains
 * paint nothing backend-side, so they pick nothing here either —
 * deliberately narrower than the label/geometry helpers in titleProvinces,
 * which union direct provinces and fall back across tiers for placement.
 *
 * Duplicate ownership resolves as the painter's last-write-wins does: parent
 * lookups are built in parent-tier order, then provinces are painted in
 * lower-tier order. At kingdom/empire level an unparented branch paints the
 * black sentinel, erasing any earlier claim; at duchy level an unparented
 * county is skipped outright.
 *
 * Returns null while a lower tier the chain needs has not loaded, so the
 * caller can withhold picking instead of answering from half a chain.
 */
export function buildTitleProvinceRegionIndex(
  mapType: string,
  regionData: RegionRecord,
  layers: TitleLayers | null,
): ProvinceRegionIndex | null {
  if (mapType === "county") return buildProvinceRegionIndex(regionData);
  if (!layers) return null;

  const index: ProvinceRegionIndex = new Map();
  /** Paint one county's provinces as `targetId`; null is the black sentinel and erases. */
  const paint = (countyId: string, targetId: string | null) => {
    const county = layers.county[countyId];
    if (!county) return;
    for (const provinceId of provinceIdsOf(county, "provinces")) {
      if (targetId !== null && regionData[targetId]) index.set(provinceId, targetId);
      else index.delete(provinceId);
    }
  };
  /** Child id -> parent id, last parent in tier order winning, as the painter's dicts do. */
  const parentOf = (parents: Record<string, TitleEntity>): Map<string, string> => {
    const map = new Map<string, string>();
    for (const [parentId, parent] of Object.entries(parents)) {
      for (const childId of titleIdsOf(parent)) map.set(childId, parentId);
    }
    return map;
  };

  if (mapType === "duchy") {
    if (!layers.duchy) return null;
    const countyDuchy = parentOf(layers.duchy);
    for (const countyId of Object.keys(layers.county)) {
      const duchyId = countyDuchy.get(countyId);
      if (duchyId === undefined) continue;
      paint(countyId, duchyId);
    }
    return index;
  }

  if (mapType === "kingdom") {
    if (!layers.duchy || !layers.kingdom) return null;
    const duchyKingdom = parentOf(layers.kingdom);
    for (const [duchyId, duchy] of Object.entries(layers.duchy)) {
      const kingdomId = duchyKingdom.get(duchyId) ?? null;
      for (const countyId of titleIdsOf(duchy)) paint(countyId, kingdomId);
    }
    return index;
  }

  if (mapType === "empire") {
    if (!layers.duchy || !layers.kingdom || !layers.empire) return null;
    const kingdomEmpire = parentOf(layers.empire);
    for (const [kingdomId, kingdom] of Object.entries(layers.kingdom)) {
      const empireId = kingdomEmpire.get(kingdomId) ?? null;
      for (const duchyId of titleIdsOf(kingdom)) {
        const duchy = layers.duchy[duchyId];
        if (!duchy) continue;
        for (const countyId of titleIdsOf(duchy)) paint(countyId, empireId);
      }
    }
    return index;
  }

  return null;
}

/**
 * The region at a province-geometry pixel: the province under the point,
 * resolved through membership and then the same visible-ancestor walk as a
 * colour pick. An exact miss (ocean, an unheld province, an invisible
 * holder) reaches nearby pixels under the same policy as
 * `resolveRegionAtPickPixel`.
 */
export function resolveRegionAtProvincePoint(
  runIndex: ProvinceRunIndex,
  x: number,
  y: number,
  provinceRegionIndex: ProvinceRegionIndex,
  getHoverRegion: GetHoverRegion,
  mapType: string,
  mapId: string,
  regionData: RegionRecord | null,
): RegionPickResult | null {
  if (!regionData) return null;

  /** Provinces and pick ids already resolved to nothing on this probe. */
  const missedProvinces = new Set<number>();
  const missedPickIds = new Set<string>();

  const resolveAt = (px: number, py: number): RegionPickResult | null => {
    const provinceId = provinceAt(runIndex, px, py);
    if (provinceId <= 0 || missedProvinces.has(provinceId)) return null;
    missedProvinces.add(provinceId);

    const pickId = provinceRegionIndex.get(provinceId);
    if (!pickId || missedPickIds.has(pickId)) return null;

    const picked = resolveRegionById(pickId, getHoverRegion, mapType, mapId, regionData);
    if (!picked) missedPickIds.add(pickId);
    return picked;
  };

  const exact = resolveAt(x, y);
  if (exact) return exact;

  // A miss off the map has no land to bridge from.
  if (!(x >= 0 && y >= 0 && x < runIndex.width && y < runIndex.height)) return null;

  const reach = waterCutoutReachForWidth(runIndex.width);
  for (const [dx, dy] of NEARBY_OFFSETS) {
    if (dx * dx + dy * dy > reach * reach) break;
    const nearby = resolveAt(x + dx, y + dy);
    if (nearby) return nearby;
  }
  return null;
}
