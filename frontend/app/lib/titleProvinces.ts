import type { MapMode } from "../components/map/types";

export type TitleEntity = {
  provinces?: number[];
  titles?: string[];
};

export type TitleLayers = {
  county: Record<string, TitleEntity>;
  duchy?: Record<string, TitleEntity>;
  kingdom?: Record<string, TitleEntity>;
  empire?: Record<string, TitleEntity>;
  trade?: Record<string, TitleEntity>;
};

function unionEntityProvinces(entity: TitleEntity | undefined, resolveChild: (childId: string) => number[]): number[] {
  if (!entity) return [];

  const ids: number[] = [];
  if (entity.provinces?.length) {
    ids.push(...entity.provinces);
  }
  for (const childId of entity.titles ?? []) {
    ids.push(...resolveChild(childId));
  }
  return ids;
}

function dedupe(ids: number[]): number[] {
  return [...new Set(ids)];
}

export function resolveCountyProvinces(countyId: string, layers: TitleLayers): number[] {
  const entity = layers.county[countyId];
  if (!entity) {
    return [];
  }
  return unionEntityProvinces(entity, (childId) => resolveCountyProvinces(childId, layers));
}

export function resolveDuchyProvinces(duchyId: string, layers: TitleLayers): number[] {
  const entity = layers.duchy?.[duchyId];
  if (entity) {
    return unionEntityProvinces(entity, (childId) => resolveCountyProvinces(childId, layers));
  }

  return resolveCountyProvinces(duchyId, layers);
}

export function resolveKingdomProvinces(kingdomId: string, layers: TitleLayers): number[] {
  const entity = layers.kingdom?.[kingdomId];
  if (entity) {
    return unionEntityProvinces(entity, (childId) => resolveDuchyProvinces(childId, layers));
  }

  return resolveCountyProvinces(kingdomId, layers);
}

export function resolveTitleProvinces(entityId: string, mapType: MapMode, layers: TitleLayers): number[] {
  switch (mapType) {
    case "county":
      return dedupe(resolveCountyProvinces(entityId, layers));
    case "duchy": {
      const entity = layers.duchy?.[entityId];
      if (!entity) return [];
      return dedupe(unionEntityProvinces(entity, (childId) => resolveCountyProvinces(childId, layers)));
    }
    case "kingdom": {
      const entity = layers.kingdom?.[entityId];
      if (!entity) return [];
      return dedupe(unionEntityProvinces(entity, (childId) => resolveDuchyProvinces(childId, layers)));
    }
    case "empire": {
      const entity = layers.empire?.[entityId];
      if (!entity) return [];
      return dedupe(unionEntityProvinces(entity, (childId) => resolveKingdomProvinces(childId, layers)));
    }
    case "trade":
      return [...(layers.trade?.[entityId]?.provinces ?? [])];
    default:
      return [];
  }
}
