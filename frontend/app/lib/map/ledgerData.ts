import { fetchMapJson } from "@/lib/map/api";
import type { MapId } from "@/app/components/map/types";

/**
 * Contract frozen in `docs/planning/...T2` (ingest hook + read API) — this file
 * targets that shape directly rather than whatever the backend happens to
 * return, so a drift shows up as a test failure instead of a silent reshape.
 * `ledger` is the economy series; `chronicle` stays the map timelapse name.
 */

/** Scalar per-day fields on the `global` object, before any faction split. */
export type LedgerGlobalField =
  | "faction_count"
  | "guild_count"
  | "claimed_provinces"
  | "population"
  | "active_wars"
  | "max_wealth_prestige"
  | "faction_wealth"
  | "pouch_wealth"
  | "player_bank_wealth"
  | "liquid_wealth"
  | "guild_liquid_wealth"
  | "node_wealth"
  | "expansion_wealth"
  | "guild_income";

/**
 * Per-faction scalar fields. `net_income`/`inflation_delta` are full-day
 * projections from the game, not a client-computed stock delta — keep them in
 * their own series and never merge them with `diffConsecutive(wealth)`.
 */
export type LedgerFactionField =
  | "wealth"
  | "bank"
  | "vassal_wealth"
  | "net_income"
  | "inflation_delta"
  | "trade_power"
  | "prestige"
  | "rank_up_at"
  | "rank_down_at"
  | "prestige_position"
  | "wealth_position"
  | "provinces"
  | "realm_size"
  | "members"
  | "members_with_vassals"
  | "settlements"
  | "population"
  | "installations"
  | "forts";

/** `null` at index `i` means the faction was absent from that day's snapshot. */
export type LedgerNumericSeries = Partial<Record<LedgerFactionField, Array<number | null>>>;

export type LedgerBreakdownSeries = {
  wealth: Record<string, Array<number | null>>;
  prestige: Record<string, Array<number | null>>;
};

/** One faction registry row from `/ledger/index` — identity is `(id, founded_at)`. */
export type LedgerRegistryFaction = {
  key: string;
  id: string;
  founded_at: string;
  name: string;
  rgb: string;
  first_seen_day: string;
  first_seen_at: string;
  last_seen_day: string;
  last_seen_at: string;
  /** Only set once a `complete: true` snapshot stopped including this faction. */
  deleted_day: string | null;
  deleted_at: string | null;
};

export type LedgerIndex = {
  /** UTC `YYYY-MM-DD`, ascending. */
  days: string[];
  first: string | null;
  last: string | null;
  latest_complete_day: string | null;
  incomplete_days: string[];
  server_day_first: number | null;
  server_day_last: number | null;
  factions: LedgerRegistryFaction[];
};

/**
 * One faction's slice of `/ledger/series` — `name`/`rgb` are the latest known
 * label (not per-day arrays), everything else shares the response's `days[]`
 * axis. `breakdowns` is only populated when `fields=full` was requested.
 */
export type LedgerFactionSeries = {
  key: string;
  id: string;
  founded_at: string;
  name: string;
  rgb: string;
  series: LedgerNumericSeries;
  rank: Array<string | null>;
  tier: Array<string | null>;
  breakdowns: LedgerBreakdownSeries;
};

export type LedgerSeries = {
  days: string[];
  server_day: Array<number | null>;
  captured_at: Array<string | null>;
  complete: Array<boolean | null>;
  global: Partial<Record<LedgerGlobalField, Array<number | null>>>;
  factions: LedgerFactionSeries[];
  /** True when the faction/day caps trimmed the response below what matched. */
  truncated: boolean;
};

/** `/ledger/faction/{key}` is always the "full" shape, plus overlord/subject history. */
export type LedgerFactionDetail = LedgerFactionSeries & {
  days: string[];
  server_day: Array<number | null>;
  captured_at: Array<string | null>;
  complete: Array<boolean | null>;
  overlord: Array<string | null>;
  subjects: Array<string[]>;
  wars: Array<unknown[]>;
};

/** Server caps from the plan — a request past these gets a 400, not a partial page. */
export const LEDGER_MAX_RANGE_DAYS = 730;
export const LEDGER_MAX_FACTION_KEYS = 40;
export const LEDGER_DEFAULT_FACTION_COUNT = 12;

export type LedgerSeriesFields = "core" | "full";

export type LedgerSeriesParams = {
  start?: string;
  end?: string;
  factions?: string[];
  fields?: LedgerSeriesFields;
};

export type LedgerFactionParams = {
  start?: string;
  end?: string;
};

/**
 * De-duplicates a set of chart-card selections into the key list for one
 * `/series?factions=` request, dropping unset cards and capping at
 * `LEDGER_MAX_FACTION_KEYS` (a request past the cap gets a 400, not a partial
 * page) rather than trimming silently server-side. Order is the first
 * occurrence's — stable across renders as long as the caller's own key order
 * is stable, which keeps the request URL (and the `useEffect` dependency
 * built from it) from churning when nothing actually changed.
 */
export function uniqueFactionKeys(keys: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= LEDGER_MAX_FACTION_KEYS) break;
  }
  return out;
}

export function ledgerIndexPath(mapId: MapId): string {
  return `/${mapId}/ledger/index`;
}

function appendRangeParams(search: URLSearchParams, start?: string, end?: string): void {
  if (start) search.set("start", start);
  if (end) search.set("end", end);
}

export function ledgerSeriesPath(mapId: MapId, params: LedgerSeriesParams = {}): string {
  const search = new URLSearchParams();
  appendRangeParams(search, params.start, params.end);
  if (params.factions && params.factions.length > 0) {
    search.set("factions", params.factions.join(","));
  }
  if (params.fields) search.set("fields", params.fields);
  const query = search.toString();
  return `/${mapId}/ledger/series${query ? `?${query}` : ""}`;
}

export function ledgerFactionPath(mapId: MapId, key: string, params: LedgerFactionParams = {}): string {
  const search = new URLSearchParams();
  appendRangeParams(search, params.start, params.end);
  const query = search.toString();
  return `/${mapId}/ledger/faction/${encodeURIComponent(key)}${query ? `?${query}` : ""}`;
}

export function ledgerDayPath(mapId: MapId, day: string): string {
  return `/${mapId}/ledger/day/${encodeURIComponent(day)}`;
}

export async function fetchLedgerIndex(
  mapId: MapId,
  sessionToken?: string | null,
  signal?: AbortSignal,
): Promise<LedgerIndex> {
  return fetchMapJson<LedgerIndex>(ledgerIndexPath(mapId), { sessionToken, signal });
}

export async function fetchLedgerSeries(
  mapId: MapId,
  params: LedgerSeriesParams = {},
  sessionToken?: string | null,
  signal?: AbortSignal,
): Promise<LedgerSeries> {
  return fetchMapJson<LedgerSeries>(ledgerSeriesPath(mapId, params), { sessionToken, signal });
}

export async function fetchLedgerFaction(
  mapId: MapId,
  key: string,
  params: LedgerFactionParams = {},
  sessionToken?: string | null,
  signal?: AbortSignal,
): Promise<LedgerFactionDetail> {
  return fetchMapJson<LedgerFactionDetail>(ledgerFactionPath(mapId, key, params), {
    sessionToken,
    signal,
  });
}
