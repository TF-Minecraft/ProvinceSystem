/** Wire/API map id: alphanumeric, matching backend `validate_map`. */
export type MapId = string;

export type MapMode =
  | "nation"
  | "county"
  | "duchy"
  | "kingdom"
  | "empire"
  | "trade"
  | "prosperity"
  | "terrain"
  | "fertility"
  | "infestation"
  | "province"
  | "plain";

export type OverlayBBox = { x: number; y: number; w: number; h: number };

export type RegionInfo = {
  title: string;
  tier: string;
  banner: string;
  size: number;
  subject_size: number;
  overlord: string;
  subjects: string[];
};

export type RegionRecord = Record<
  string,
  {
    name?: string;
    tier?: string;
    banner?: string;
    rgb?: string;
    overlord?: string;
    subjects?: string[];
    size?: number;
    subject_size?: number;
    provinces?: number[];
    occupied_held?: number[];
    overlay?: OverlayBBox;
    overlay_nested?: OverlayBBox;
  }
>;

export type MapObject = {
  id: string;
  visible: boolean;
  path: string;
  overlay?: OverlayBBox;
  /**
   * Structure, stated rather than inferred. `id` mixes two namespaces: real
   * region ids are day-file object keys (player-set names), while the builder
   * also synthesises one `${regionId}_nested` entry per region with subjects.
   * A region literally named `Foo_nested` therefore collides with the
   * synthetic entry for `Foo`, and any consumer that recovers structure with
   * `id.endsWith("_nested")` mis-reads that real nation as a synthetic drill
   * shape — it loses its ownership entry and is painted transparent while the
   * pick canvas still resolves hovers over its land.
   *
   * `nested` is true only for entries the builder synthesised; `baseId` is the
   * real region id the entry describes (equal to `id` when `nested` is false).
   * Both are set literally at construction in `core/mapObjectBuilder.ts`,
   * which is the only place that knows which namespace an id came from.
   */
  nested: boolean;
  baseId: string;
};

export type HoverOverlay = {
  url: string;
  overlay?: OverlayBBox;
};

export type CursorTooltip = {
  x: number;
  y: number;
  text: string;
  hint?: string;
};

export type SettlementMarkerKind =
  | "faction_capital"
  | "guild_capital"
  | "settlement";

export type SettlementMarkerSize = "small" | "large";

export type SettlementMarker = {
  id: string;
  name: string;
  faction_id?: string;
  province_id?: number;
  kind?: SettlementMarkerKind;
  marker_size?: SettlementMarkerSize;
  population?: number;
  map_x?: number;
  map_y?: number;
};

export type InstallationMarkerKind =
  | "fort"
  | "port"
  | "airport"
  | "train_station";

export type InstallationMarker = {
  id: string;
  name: string;
  kind: InstallationMarkerKind;
  faction_id?: string;
  province_id?: number;
  map_x?: number;
  map_y?: number;
};

export type FortMarker = {
  id: string;
  name?: string;
  province_id?: number;
  faction_id?: string;
  map_x?: number;
  map_y?: number;
  overlay?: OverlayBBox;
  zoc_url?: string;
  /**
   * The provinces under this fort's zone of control. `zoc_url` is the live
   * rendering of exactly this list, regenerated daily, so a stored chronicle
   * day can only redraw its own zone from the ids.
   */
  zoc_provinces?: number[];
};

export type WarScheduleSlot = {
  schedule_index: number;
  leg: "invasion" | "counter";
  province_id: number;
  kind: string;
  kind_label: string;
  battle_type?: string;
  required?: boolean;
  status: "fought" | "next" | "upcoming";
  province_name?: string;
  map_x?: number;
  map_y?: number;
  fort_installation_id?: string | null;
  port_installation_id?: string | null;
  display_name?: string;
};

export type WarCapitalCoords = {
  province_id: number;
  center_x?: number;
  center_z?: number;
  map_x?: number;
  map_y?: number;
};

export type WarLinePoint = {
  province_id: number;
  map_x: number;
  map_y: number;
};

export type WarExport = {
  id: string;
  name?: string;
  war_type?: string;
  goal?: string;
  status?: string;
  attacker_leader_id?: string;
  defender_leader_id?: string;
  belligerents?: string[];
  campaign_provinces?: number[];
  cursor_index?: number;
  objective_province_id?: number;
  push_target?: string;
  campaign_schedule_index?: number;
  campaign_counter_schedule_index?: number;
  campaign_battle_schedule?: WarScheduleSlot[];
  campaign_counter_schedule?: WarScheduleSlot[];
  attacker_capital?: WarCapitalCoords;
  defender_capital?: WarCapitalCoords;
  campaign_line_points?: WarLinePoint[];
  occupied_by_attacker?: number[];
  occupied_by_defender?: number[];
};

export type MapMarkersResponse = {
  map_id: string;
  exported_at: string | null;
  settlement_large_population_threshold?: number;
  settlements: SettlementMarker[];
  installations: InstallationMarker[];
  forts: FortMarker[];
  wars?: WarExport[];
};

export const DEFAULT_MAP_BOUNDS = 6400;

export const MAP_BOUNDS: Record<string, number> = {
  main: DEFAULT_MAP_BOUNDS,
  dev: DEFAULT_MAP_BOUNDS,
};

/** Known maps keep their authored square; anything else waits for the image. */
export function mapFallbackSize(mapId: MapId): number {
  return MAP_BOUNDS[mapId] ?? DEFAULT_MAP_BOUNDS;
}

export const MAP_DISPLAY_NAMES: Record<string, string> = {
  main: "Adavaar",
  dev: "Adavaar",
};

/** Accessible-list name when known, then the static main/dev labels, else the id. */
export function mapDisplayName(
  mapId: MapId,
  maps?: { id: string; display_name: string }[] | null
): string {
  const fromList = maps?.find((entry) => entry.id === mapId)?.display_name.trim();
  if (fromList) return fromList;
  return MAP_DISPLAY_NAMES[mapId] ?? mapId;
}

export function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "";
}
