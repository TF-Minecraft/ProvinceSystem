import type { MapObject, OverlayBBox } from "../components/map/types";

/**
 * One entry per region, plus a synthetic `${regionId}_nested` entry for any
 * region with subjects (the drilled-in, own-provinces-only shape).
 *
 * Structure is recorded on each entry (`nested`, `baseId`) instead of being
 * left to be recovered from the id later. Region ids are day-file object keys,
 * i.e. player-set names, so a real region can be named `Foo_nested` and is
 * indistinguishable by string from the synthetic entry for `Foo`. Only this
 * function knows which of the two it is building.
 */
export function buildMapObjectsFromRegionData(regionData: Record<string, unknown>): MapObject[] {
  return Object.keys(regionData).flatMap((regionId) => {
    const region = regionData[regionId] as Record<string, unknown>;
    const rgb = region.rgb as string | undefined;
    if (!rgb) return [];

    const rgbPath = rgb.replace(/,/g, "_");
    const overlay = region.overlay as OverlayBBox | undefined;
    const overlayNested = region.overlay_nested as OverlayBBox | undefined;

    const entries: MapObject[] = [
      {
        id: regionId,
        visible: !region.overlord,
        path: rgbPath,
        overlay,
        nested: false,
        baseId: regionId,
      },
    ];

    const subjects = region.subjects as string[] | undefined;
    if (subjects?.length) {
      entries.push({
        id: `${regionId}_nested`,
        visible: false,
        path: `${rgbPath}_nested`,
        overlay: overlayNested,
        nested: true,
        baseId: regionId,
      });
    }

    return entries;
  });
}

export function initialMapObjectVisibility(obj: MapObject, regionData: Record<string, unknown>): boolean {
  // The flag, not the id: a real region named `Foo_nested` used to be forced
  // permanently invisible here by the string test.
  if (obj.nested === true) {
    return false;
  }

  const regionId = typeof obj.baseId === "string" ? obj.baseId : obj.id;
  const region = regionData[regionId] as Record<string, unknown> | undefined;
  if (!region) return obj.visible;
  return !region.overlord;
}

export type MapObjectIndex = {
  /** Real region id -> that region's own entry. */
  base: Map<string, MapObject>;
  /** Real region id -> the synthetic `${id}_nested` entry, if the builder made one. */
  nested: Map<string, MapObject>;
};

/**
 * `mapObjects` keyed for O(1) lookup, by `baseId` in two buckets.
 *
 * Keying by `id` would merge the two namespaces (see `MapObject`) and let a
 * real region named `Foo_nested` answer lookups for `Foo`'s drill entry.
 * First entry wins a duplicate key, matching the old `Array.prototype.find`.
 */
export function buildMapObjectIndex(mapObjects: MapObject[] | null | undefined): MapObjectIndex {
  const base = new Map<string, MapObject>();
  const nested = new Map<string, MapObject>();
  if (!Array.isArray(mapObjects)) return { base, nested };

  for (const obj of mapObjects) {
    if (!obj || typeof obj.id !== "string") continue;
    const key = typeof obj.baseId === "string" ? obj.baseId : obj.id;
    const bucket = obj.nested === true ? nested : base;
    if (!bucket.has(key)) bucket.set(key, obj);
  }

  return { base, nested };
}

export type HoverTarget = {
  regionId: string;
  region: Record<string, unknown>;
  object: MapObject;
} | null;

/**
 * Walks up the `overlord` chain from a picked region id to the nearest entry
 * that is actually drawn, which is what a hover must highlight: the pick image
 * is coloured by *direct* owner, so a pick on a vassal's land has to resolve
 * to whichever ancestor's shape is on screen.
 *
 * Two properties the previous inline version in `MapEngineContext` lacked.
 *
 * 1. **Cycle guard.** `regionData` is not always engine-produced. The
 *    chronicle route renders a stored day file straight off disk with no
 *    schema validation, so `overlord` is attacker-controlled and
 *    `{"A":{"overlord":"B"},"B":{"overlord":"A"}}` is a legal file. Both such
 *    regions come out invisible, but the pick canvas is painted from
 *    `directOwnership`, which ignores visibility — so their pixels *are*
 *    hoverable and this walk is entered from a mousemove handler. Without the
 *    visited set it never returns, and there is no React error boundary under
 *    `app/` to contain it. This guard is unreachable only for well-formed
 *    data; it is not dead code.
 * 2. **Linear lookup.** The index replaces two `Array.prototype.find` scans
 *    per step, which made even an acyclic deep chain quadratic.
 */
export function resolveHoverTarget(
  regionId: string,
  regionData: Record<string, unknown>,
  index: MapObjectIndex,
): HoverTarget {
  const visited = new Set<string>();
  let currentRegionId: string | null = regionId;

  while (currentRegionId) {
    if (visited.has(currentRegionId)) return null;
    visited.add(currentRegionId);

    const region = regionData?.[currentRegionId] as Record<string, unknown> | undefined;
    if (!region) return null;

    const main = index.base.get(currentRegionId);
    if (main?.visible) {
      return { regionId: currentRegionId, region, object: main };
    }

    const nested = index.nested.get(currentRegionId);
    if (nested?.visible) {
      return { regionId: currentRegionId, region, object: nested };
    }

    currentRegionId = typeof region.overlord === "string" && region.overlord.length > 0 ? region.overlord : null;
  }

  return null;
}
