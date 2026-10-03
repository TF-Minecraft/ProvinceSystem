import type {
  InstallationMarker,
  RegionRecord,
  SettlementMarker,
} from "@/app/components/map/types";
import { cleanRegionName } from "@/app/lib/mapLabels";
import { allGuilds } from "./guildProfile";

export type MapSearchEntry =
  | {
      kind: "region";
      key: string;
      regionId: string;
      label: string;
      detail: string;
      rgb: string | null;
    }
  | {
      kind: "guild";
      key: string;
      guildKey: string;
      label: string;
      detail: string;
      rgb: string | null;
    }
  | {
      kind: "place";
      key: string;
      label: string;
      detail: string;
      mapX: number;
      mapY: number;
    };

const INSTALLATION_LABELS: Record<InstallationMarker["kind"], string> = {
  fort: "Fort",
  port: "Port",
  airport: "Airfield",
  train_station: "Station",
};

const SETTLEMENT_LABELS: Record<string, string> = {
  faction_capital: "Capital",
  guild_capital: "Guild seat",
  settlement: "Settlement",
};

/** Lower-case, accents stripped: "Huǒyàoguó" is found by typing "huoyaoguo". */
export function normaliseSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function ownerName(
  factionId: string | undefined,
  regionData: RegionRecord | null
): string | null {
  if (!factionId) return null;
  const name = regionData?.[factionId]?.name;
  return name ? cleanRegionName(name) : null;
}

/**
 * Everything the search box can find on the current map mode: its regions
 * (nations, titles, trade areas) and the placed settlements and
 * installations. Raster-only modes have no region data, so they search places
 * alone.
 */
export function buildMapSearchIndex({
  regionData,
  tierLabel,
  settlements,
  installations,
}: {
  regionData: RegionRecord | null;
  tierLabel: string;
  settlements: SettlementMarker[];
  installations: InstallationMarker[];
}): MapSearchEntry[] {
  const entries: MapSearchEntry[] = [];

  for (const [regionId, region] of Object.entries(regionData ?? {})) {
    const label = cleanRegionName(region.name ?? regionId);
    if (!label) continue;
    const overlord = region.overlord ? ownerName(region.overlord, regionData) : null;
    entries.push({
      kind: "region",
      key: `region:${regionId}`,
      regionId,
      label,
      detail: overlord ? `Subject of ${overlord}` : region.tier ?? tierLabel,
      rgb: region.rgb ?? null,
    });
  }

  // Guilds live inside the realm map's data; other modes have none.
  for (const guild of allGuilds(regionData)) {
    const realm = ownerName(guild.factionId, regionData);
    entries.push({
      kind: "guild",
      key: `guild:${guild.key}`,
      guildKey: guild.key,
      label: guild.name,
      detail: realm ? `${guild.typeLabel} · ${realm}` : guild.typeLabel,
      rgb: guild.rgb,
    });
  }

  const guildCapitals = new Set(
    allGuilds(regionData)
      .map((guild) => guild.homeProvince)
      .filter((province): province is number => province !== null)
  );

  for (const settlement of settlements) {
    if (typeof settlement.map_x !== "number" || typeof settlement.map_y !== "number") {
      continue;
    }
    const label = cleanRegionName(settlement.name);
    if (!label) continue;
    const owner = ownerName(settlement.faction_id, regionData);
    const kind =
      (settlement.kind ?? "settlement") === "settlement" &&
      typeof settlement.province_id === "number" &&
      guildCapitals.has(settlement.province_id)
        ? "Guild capital"
        : SETTLEMENT_LABELS[settlement.kind ?? "settlement"] ?? "Settlement";
    entries.push({
      kind: "place",
      key: `settlement:${settlement.id}`,
      label,
      detail: owner ? `${kind} · ${owner}` : kind,
      mapX: settlement.map_x,
      mapY: settlement.map_y,
    });
  }

  for (const installation of installations) {
    if (
      typeof installation.map_x !== "number" ||
      typeof installation.map_y !== "number"
    ) {
      continue;
    }
    const label = cleanRegionName(installation.name);
    if (!label) continue;
    const owner = ownerName(installation.faction_id, regionData);
    const kind = INSTALLATION_LABELS[installation.kind] ?? "Installation";
    entries.push({
      kind: "place",
      key: `installation:${installation.id}`,
      label,
      detail: owner ? `${kind} · ${owner}` : kind,
      mapX: installation.map_x,
      mapY: installation.map_y,
    });
  }

  return entries;
}

/** On an equal match: realms and titles, then guilds, then places. */
function kindRank(entry: MapSearchEntry): number {
  return entry.kind === "region" ? 0 : entry.kind === "guild" ? 1 : 2;
}

/**
 * Best matches first: the whole name starting with the query, then any word
 * in it starting with the query, then the query anywhere. Ties go to regions
 * over places and then to the shorter name, which is usually the one meant.
 */
export function searchMap(
  entries: MapSearchEntry[],
  query: string,
  limit = 8
): MapSearchEntry[] {
  const needle = normaliseSearchText(query);
  if (!needle) return [];

  const scored: { entry: MapSearchEntry; score: number }[] = [];
  for (const entry of entries) {
    const haystack = normaliseSearchText(entry.label);
    let score: number;
    if (haystack.startsWith(needle)) score = 0;
    else if (haystack.split(/[\s'’\-_]+/).some((word) => word.startsWith(needle))) score = 1;
    else if (haystack.includes(needle)) score = 2;
    else continue;
    scored.push({ entry, score });
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      kindRank(a.entry) - kindRank(b.entry) ||
      a.entry.label.length - b.entry.label.length ||
      a.entry.label.localeCompare(b.entry.label)
  );
  return scored.slice(0, limit).map(({ entry }) => entry);
}
