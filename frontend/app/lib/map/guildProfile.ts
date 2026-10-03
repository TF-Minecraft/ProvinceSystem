import type { RegionRecord, SettlementMarker } from "@/app/components/map/types";
import { cleanRegionName } from "@/app/lib/mapLabels";

import { leaderCharacterName } from "./realmProfile";

/**
 * What the map shows about a guild, read from the `guilds` list inside each
 * realm of `/data/nation`.
 *
 * The same allowlist rule as `RealmProfile`: those entries also carry bank
 * balances, loans, ledgers, dividend lists and member usernames, none of
 * which this reads. Members are a count, the leader is their character name
 * (never the account), and branches are names and levels.
 */
export type GuildProfile = {
  /** `factionId/guildId`, unique across the map. */
  key: string;
  id: string;
  factionId: string;
  name: string;
  /** SimpleFactions' guild type, e.g. "realm" or "guild". */
  type: string;
  typeLabel: string;
  rgb: string | null;
  leader: string | null;
  members: number;
  /** Province the guild is based in. */
  homeProvince: number | null;
  branches: { id: string; label: string; level: number }[];
};

type RawGuild = Record<string, unknown>;

export function guildKey(factionId: string, guildId: string): string {
  return `${factionId}/${guildId}`;
}

function words(id: string): string {
  const spaced = id.replace(/_/g, " ").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : id;
}

export function guildTypeLabel(type: string): string {
  if (type === "realm") return "Realm guild";
  if (type === "guild") return "Guild";
  return words(type);
}

export function buildGuildProfile(factionId: string, raw: RawGuild): GuildProfile | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) return null;
  const type = typeof raw.type === "string" ? raw.type : "guild";
  const capital = typeof raw.capital === "number" && raw.capital >= 0 ? raw.capital : null;
  const members = Array.isArray(raw.members)
    ? raw.members.length
    : typeof raw.members === "number"
      ? raw.members
      : 0;
  const branches = Array.isArray(raw.branches)
    ? raw.branches.flatMap((branch) => {
        if (!branch || typeof branch !== "object") return [];
        const { id: branchId, level } = branch as { id?: unknown; level?: unknown };
        if (typeof branchId !== "string" || typeof level !== "number") return [];
        return [{ id: branchId, label: words(branchId), level }];
      })
    : [];
  return {
    key: guildKey(factionId, id),
    id,
    factionId,
    name: (typeof raw.name === "string" && cleanRegionName(raw.name)) || words(id),
    type,
    typeLabel: guildTypeLabel(type),
    rgb: typeof raw.rgb === "string" ? raw.rgb : null,
    leader: leaderCharacterName(raw),
    members,
    homeProvince: capital,
    branches,
  };
}

/**
 * A realm's guilds other than its own realm guild (which is the realm itself
 * in guild form, and would only repeat the realm panel), largest first.
 */
export function realmGuilds(factionId: string, region: unknown): GuildProfile[] {
  const raw = (region as { guilds?: unknown } | undefined)?.guilds;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (entry && typeof entry === "object" ? buildGuildProfile(factionId, entry as RawGuild) : null))
    .filter((guild): guild is GuildProfile => guild !== null && guild.type !== "realm")
    .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
}

export function allGuilds(regionData: RegionRecord | null): GuildProfile[] {
  return Object.entries(regionData ?? {}).flatMap(([factionId, region]) =>
    realmGuilds(factionId, region)
  );
}

/** Every guild of a realm, its own realm guild included. */
function everyGuildOf(factionId: string, region: unknown): GuildProfile[] {
  const raw = (region as { guilds?: unknown } | undefined)?.guilds;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (entry && typeof entry === "object" ? buildGuildProfile(factionId, entry as RawGuild) : null))
    .filter((guild): guild is GuildProfile => guild !== null);
}

/** A guild by `factionId/guildId`, realm guilds included. */
export function findGuild(regionData: RegionRecord | null, key: string): GuildProfile | null {
  const slash = key.indexOf("/");
  if (slash <= 0) return null;
  const factionId = key.slice(0, slash);
  return everyGuildOf(factionId, regionData?.[factionId]).find((guild) => guild.key === key) ?? null;
}

/**
 * The key of the guild with this id, in any realm. The trade map's areas are
 * keyed by the id of the guild that dominates them.
 */
export function guildKeyForId(regionData: RegionRecord | null, guildId: string): string | null {
  for (const [factionId, region] of Object.entries(regionData ?? {})) {
    const match = everyGuildOf(factionId, region).find((guild) => guild.id === guildId);
    if (match) return match.key;
  }
  return null;
}

/** Guilds based in a province, e.g. the one a settlement sits in. */
export function guildsInProvince(regionData: RegionRecord | null, province: number): GuildProfile[] {
  return allGuilds(regionData).filter((guild) => guild.homeProvince === province);
}

/** The settlement a guild is based in, matched by province. */
export function guildSeat(
  guild: Pick<GuildProfile, "homeProvince" | "factionId">,
  settlements: SettlementMarker[]
): SettlementMarker | null {
  if (guild.homeProvince === null) return null;
  const here = settlements.filter((settlement) => settlement.province_id === guild.homeProvince);
  return here.find((settlement) => settlement.faction_id === guild.factionId) ?? here[0] ?? null;
}
