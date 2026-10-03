import type {
  InstallationMarker,
  RegionRecord,
  SettlementMarker,
} from "@/app/components/map/types";
import type { MapMarker } from "@/app/lib/mapMarkers";
import { isBattleMarkerKind } from "@/app/lib/mapMarkers";
import { cleanRegionName } from "@/app/lib/mapLabels";

/**
 * What the details panel shows for a marker: a settlement, an installation or
 * a battle. Read from the marker export the map already holds; nothing here
 * costs a request.
 */
export type PlaceProfile = {
  markerId: string;
  name: string;
  /** "Capital", "Guild seat", "Port", "Battle", ... */
  kindLabel: string;
  /** The realm that owns it, if it has one the map knows. */
  ownerId: string | null;
  population: number | null;
  /** Provinces the settlement spans. */
  provinces: number[];
  hubs: number | null;
  hubSlots: number | null;
  mapX: number;
  mapY: number;
  /** Free text for kinds with nothing structured (battles). */
  note: string | null;
};

const SETTLEMENT_KIND_LABELS: Record<string, string> = {
  faction_capital: "Capital",
  guild_capital: "Guild seat",
  settlement: "Settlement",
};

const INSTALLATION_KIND_LABELS: Record<string, string> = {
  fort: "Fort",
  port: "Port",
  airport: "Airfield",
  train_station: "Station",
};

/** The marker id a settlement or installation search result stands for. */
export function placeMarkerIdForSearchKey(key: string): string | null {
  if (key.startsWith("settlement:")) return key.slice("settlement:".length);
  if (key.startsWith("installation:")) return key;
  return null;
}

export function buildPlaceProfile(
  marker: MapMarker,
  settlements: SettlementMarker[],
  installations: InstallationMarker[],
  regionData: RegionRecord | null
): PlaceProfile {
  const base: PlaceProfile = {
    markerId: marker.id,
    name: marker.label,
    kindLabel: "Place",
    ownerId: null,
    population: null,
    provinces: [],
    hubs: null,
    hubSlots: null,
    mapX: marker.mapX,
    mapY: marker.mapY,
    note: null,
  };
  const known = (id: string | undefined) => (id && regionData?.[id] ? id : null);

  if (marker.id.startsWith("installation:")) {
    const id = marker.id.slice("installation:".length);
    const installation = installations.find((entry) => entry.id === id);
    if (!installation) return base;
    return {
      ...base,
      name: cleanRegionName(installation.name) || base.name,
      kindLabel: INSTALLATION_KIND_LABELS[installation.kind] ?? "Installation",
      ownerId: known(installation.faction_id),
      provinces:
        typeof installation.province_id === "number" ? [installation.province_id] : [],
      hubs: (installation.hub_slots ?? 0) > 0 ? installation.hubs ?? 0 : null,
      hubSlots: (installation.hub_slots ?? 0) > 0 ? installation.hub_slots ?? 0 : null,
    };
  }

  if (isBattleMarkerKind(marker.kind)) {
    return { ...base, kindLabel: "Battle", note: marker.title || null };
  }

  const settlement = settlements.find((entry) => entry.id === marker.id);
  if (!settlement) return base;
  const raw = settlement as SettlementMarker & { provinces?: unknown };
  const provinces = Array.isArray(raw.provinces)
    ? raw.provinces.filter((value): value is number => typeof value === "number")
    : typeof settlement.province_id === "number"
      ? [settlement.province_id]
      : [];
  return {
    ...base,
    name: cleanRegionName(settlement.name) || base.name,
    kindLabel: SETTLEMENT_KIND_LABELS[settlement.kind ?? "settlement"] ?? "Settlement",
    ownerId: known(settlement.faction_id),
    population: typeof settlement.population === "number" ? settlement.population : null,
    provinces,
  };
}
