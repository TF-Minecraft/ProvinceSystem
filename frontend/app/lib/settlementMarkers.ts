import type {
  SettlementMarker,
  SettlementMarkerKind,
} from "../components/map/types";
import {
  cleanRegionName,
  isNationLabelVisible,
  type LabelMapObject,
} from "./mapLabels";
import type { MapMarker } from "./mapMarkers";

export function filterPlacedSettlements(
  settlements: SettlementMarker[]
): SettlementMarker[] {
  return settlements.filter(
    (s) =>
      typeof s.map_x === "number" &&
      Number.isFinite(s.map_x) &&
      typeof s.map_y === "number" &&
      Number.isFinite(s.map_y)
  );
}

export function visibleSettlementKind(
  kind: SettlementMarkerKind | undefined,
  factionId: string | undefined,
  mapObjects: LabelMapObject[]
): SettlementMarkerKind {
  const resolved = kind ?? "settlement";
  if (resolved === "settlement") {
    return "settlement";
  }
  if (!factionId) {
    return resolved;
  }
  if (!isNationLabelVisible(factionId, mapObjects)) {
    return "settlement";
  }
  return resolved;
}

export function settlementToMapMarker(settlement: SettlementMarker): MapMarker {
  const displayName = cleanRegionName(settlement.name);
  return {
    id: settlement.id,
    kind: settlement.kind ?? "settlement",
    markerSize: settlement.marker_size,
    mapX: settlement.map_x!,
    mapY: settlement.map_y!,
    label: displayName,
    title:
      settlement.population != null
        ? `${displayName} (${settlement.population})`
        : displayName,
  };
}
