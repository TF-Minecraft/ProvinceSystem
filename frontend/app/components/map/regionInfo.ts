import type { MapMode, RegionInfo, RegionRecord } from "./types";

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

export function buildRegionInfo(
  id: string,
  region: RegionRecord[string],
  mapType: MapMode,
  regionData: RegionRecord
): RegionInfo {
  const tier = region.tier ?? capitalize(mapType);
  const overlordId = region.overlord;
  const overlordName = overlordId
    ? regionData[overlordId]?.name ?? overlordId
    : "";

  return {
    title: region.name ?? id,
    tier,
    banner: region.banner ?? "",
    size: region.size ?? 0,
    subject_size: region.subject_size ?? 0,
    overlord: overlordName,
    subjects: region.subjects ?? [],
  };
}
