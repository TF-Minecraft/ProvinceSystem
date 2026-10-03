import type { HoverOverlay, RegionRecord } from "../components/map/types";

export type GetHoverRegion = (
  mapType: string,
  mapId: string,
  regionId: string,
  regionData: RegionRecord
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
    mapType === "infrastructure" ||
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
  regionData: RegionRecord | null
): RegionPickResult | null {
  if (!regionData?.[pickId]) return null;
  const { regionId, imagePath, overlay, region } = getHoverRegion(
    mapType,
    mapId,
    pickId,
    regionData
  );
  if (!regionId || !region) return null;
  return { pickId, regionId, region, imagePath, overlay };
}

export function resolveRegionAtPickPixel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rgbToId: Record<string, string>,
  getHoverRegion: GetHoverRegion,
  mapType: string,
  mapId: string,
  regionData: RegionRecord | null
): RegionPickResult | null {
  if (!regionData) return null;

  let pixel: Uint8ClampedArray;
  try {
    if (x < 0 || y < 0 || x >= ctx.canvas.width || y >= ctx.canvas.height) {
      return null;
    }
    pixel = ctx.getImageData(x, y, 1, 1).data;
  } catch {
    return null;
  }

  const rgb = `${pixel[0]},${pixel[1]},${pixel[2]}`;
  const pickId = rgbToId[rgb];
  if (!pickId) return null;

  const { regionId, imagePath, overlay, region } = getHoverRegion(
    mapType,
    mapId,
    pickId,
    regionData
  );
  if (!regionId || !region) return null;

  return { pickId, regionId, region, imagePath, overlay };
}
