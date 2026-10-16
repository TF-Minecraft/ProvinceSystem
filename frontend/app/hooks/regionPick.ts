import type { HoverOverlay, RegionRecord } from "../components/map/types";
import type { PickSurface } from "../lib/map/pickSurface";

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

/** The reach on the surface in hand: reduced pick maps hold fewer, fatter pixels. */
function waterCutoutReach(surface: PickSurface): number {
  if (surface.width <= 0) return 0;
  return Math.max(2, Math.min(WATER_CUTOUT_REACH, Math.round(surface.width / 1000)));
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

  const reach = waterCutoutReach(surface);
  for (const [dx, dy] of NEARBY_OFFSETS) {
    if (dx * dx + dy * dy > reach * reach) break;
    const nearby = resolveAt(x + dx, y + dy);
    if (nearby) return nearby;
  }
  return null;
}
