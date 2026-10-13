import type { MapObject, RegionRecord } from "./types";

export type DrillLayer = {
  regionId: string;
  name: string;
  rgb: string;
};

export function drillStackNames(layers: DrillLayer[]): string[] {
  return layers.map((layer) => layer.name);
}

export function applyDrillStack(
  layers: DrillLayer[],
  regionData: RegionRecord,
  resetDrillVisibility: (regionData: RegionRecord) => void,
  drillDownRegion: (regionId: string, regionData: RegionRecord) => void,
) {
  resetDrillVisibility(regionData);
  for (const layer of layers) {
    drillDownRegion(layer.regionId, regionData);
  }
}

export function getAncestryChain(regionId: string, data: RegionRecord): string[] {
  const chain: string[] = [];
  let currentId: string | null = regionId;
  while (currentId && data[currentId]) {
    chain.push(currentId);
    currentId = data[currentId].overlord || null;
  }
  return chain;
}

/** Realms whose subject layout is currently open (main hidden, nested visible). */
export function getDrilledRealmIds(mapObjects: MapObject[]): Set<string> {
  const ids = new Set<string>();

  // Match on the `nested` flag and `baseId`, never on the id's suffix. Region
  // ids are day-file object keys — player-set names — so a real nation can be
  // called `Foo_nested` and is indistinguishable by string from the synthetic
  // entry `mapObjectBuilder` creates for `Foo`.
  for (const obj of mapObjects) {
    if (obj.nested) continue;
    if (obj.visible) continue;

    const nested = mapObjects.find((entry) => entry.nested && entry.baseId === obj.baseId);
    if (nested?.visible) {
      ids.add(obj.id);
    }
  }

  return ids;
}

function resolveNextDrillTarget(regionId: string, regionData: RegionRecord, drilledIds: Set<string>): string | null {
  let currentId: string | null = regionId;

  while (currentId) {
    const region: RegionRecord[string] | undefined = regionData[currentId];
    if (!region) return null;

    if (region.overlord) {
      if (drilledIds.has(region.overlord)) {
        return currentId;
      }
    } else if (!drilledIds.has(currentId)) {
      return currentId;
    }

    currentId = region.overlord || null;
  }

  return null;
}

export function getNextDrillTarget(
  regionId: string,
  regionData: RegionRecord,
  drillStack: DrillLayer[],
): string | null {
  const drilledIds = new Set(drillStack.map((layer) => layer.regionId));
  return resolveNextDrillTarget(regionId, regionData, drilledIds);
}

export function hasLandSubjects(regionId: string, regionData: RegionRecord): boolean {
  const subjects = regionData[regionId]?.subjects;
  if (!subjects?.length) return false;

  return subjects.some((subjectId) => (regionData[subjectId]?.size ?? 0) > 0);
}

export function canDrillIntoRegion(regionId: string, regionData: RegionRecord, mapObjects: MapObject[]): boolean {
  const drilledIds = getDrilledRealmIds(mapObjects);
  const targetId = resolveNextDrillTarget(regionId, regionData, drilledIds);
  if (!targetId || !hasLandSubjects(targetId, regionData)) {
    return false;
  }

  if (drilledIds.has(targetId)) {
    return false;
  }

  return true;
}

/**
 * Overlay crops a click on `regionId` draws: the region itself and, for the
 * realm the click opens (see `focusOnRegion`), its shape, its nested layout
 * and its subjects. Loading them during hover means the click needs no
 * network round trip before the rest of the map dims.
 */
export function selectionCropPaths(regionId: string, regionData: RegionRecord, mapObjects: MapObject[]): string[] {
  if (!regionData[regionId]) return [];
  const chain = getAncestryChain(regionId, regionData);
  const realmId = hasLandSubjects(regionId, regionData) ? regionId : (chain[1] ?? null);
  const base = (id: string) => mapObjects.find((obj) => !obj.nested && obj.baseId === id);
  const objects = [base(regionId)];
  if (realmId) {
    objects.push(
      base(realmId),
      mapObjects.find((obj) => obj.nested && obj.baseId === realmId),
    );
    for (const subjectId of regionData[realmId]?.subjects ?? []) objects.push(base(subjectId));
  }
  return [...new Set(objects.flatMap((obj) => (obj ? [obj.path] : [])))];
}
