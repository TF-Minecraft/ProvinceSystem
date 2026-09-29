/**
 * Chart geometry for the ledger panels. Lives here rather than in the
 * component because vitest is node-env (`app/**\/*.test.ts`, no jsdom) — this
 * is the only place this math gets covered by a test at all.
 */

import { cleanRegionName } from "../mapLabels";
import type {
  LedgerBreakdownSeries,
  LedgerFactionField,
  LedgerNumericSeries,
  LedgerRegistryFaction,
  LedgerSeries,
} from "./ledgerData";

export type Point = { x: number; y: number };

/** Half-open `[start, end)` index range into a `days[]` axis. */
export type RangeSlice = { start: number; end: number };

function toUtcDayNumber(day: string): number {
  // `days[]` entries are UTC `YYYY-MM-DD` — parse as UTC midnight explicitly so
  // this doesn't drift with the host's local timezone.
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000;
}

/**
 * Finds the slice of `days` covering `[start, end]` (inclusive, `YYYY-MM-DD`
 * strings). `days` is assumed sorted ascending. Omitted bounds run to the edge.
 */
export function sliceToRange(days: string[], start?: string | null, end?: string | null): RangeSlice {
  let from = 0;
  let to = days.length;
  if (start) {
    from = days.findIndex((day) => day >= start);
    if (from === -1) from = days.length;
  }
  if (end) {
    let last = -1;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i]! <= end) {
        last = i;
        break;
      }
    }
    to = last === -1 ? 0 : last + 1;
  }
  return { start: Math.min(from, days.length), end: Math.max(to, from) };
}

/**
 * Day-over-day delta. Never differences across a gap: a `null` in either
 * neighbour, or a calendar hole between consecutive `days[]` entries (a day
 * with no snapshot at all, so it's simply missing from the axis), both yield
 * `null` rather than a value spanning days that were never adjacent.
 */
export function diffConsecutive(days: string[], values: Array<number | null>): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if (prev == null || curr == null) continue;
    const prevDay = days[i - 1];
    const currDay = days[i];
    if (prevDay == null || currDay == null) continue;
    if (toUtcDayNumber(currDay) - toUtcDayNumber(prevDay) !== 1) continue;
    out[i] = curr - prev;
  }
  return out;
}

export type StackedBreakdown = {
  /** Stable, caller-chosen order — never `Object.keys` insertion order, which
   * can reshuffle between days as new breakdown keys appear. */
  keys: string[];
  /** `baselines[dayIndex][keyIndex]` — bottom of that band's slice that day.
   * `null` at every index for a day means the faction had no row at all that
   * day (a gap), as opposed to a component that is genuinely `0`. */
  baselines: Array<Array<number | null>>;
  /** `tops[dayIndex][keyIndex]` — top of that band's slice that day. Same
   * `null`-means-gap rule as `baselines`. */
  tops: Array<Array<number | null>>;
};

/**
 * Most real bands a stacked breakdown chart will ever render. The breakdown
 * key set arrives from the server, which gets it from whatever the game plugin
 * posted — it is not a closed vocabulary, and a hostile (or merely broken)
 * uploader can put tens of thousands of distinct keys in one payload. Every
 * key becomes a `<path>` and a legend `<span>` per card, and `stackBreakdown`
 * itself allocates two `Array(keys.length)` per day, so an uncapped key set
 * hangs the tab for as long as the rows are stored. The backend caps this too;
 * the client must not trust the response length either.
 */
export const LEDGER_MAX_BREAKDOWN_BANDS = 12;

/** Key of the synthetic band the over-cap remainder is folded into, so the
 * stack still sums to the same per-day total it did uncapped. */
export const LEDGER_OTHER_BAND_KEY = "other";

/** Largest absolute value a band reaches over the charted days — the ranking
 * used to decide which bands survive the cap, so the ones actually visible in
 * the chart are the ones kept. */
function peakMagnitude(values: Array<number | null> | undefined, dayCount: number): number {
  if (!values) return 0;
  let peak = 0;
  const end = Math.min(dayCount, values.length);
  for (let day = 0; day < end; day++) {
    const value = values[day];
    if (value == null || !Number.isFinite(value)) continue;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

/** A band name for the remainder that cannot collide with a real key — the
 * server could perfectly well have sent a band literally called `other`. */
function uniqueOtherKey(taken: Set<string>): string {
  let key = LEDGER_OTHER_BAND_KEY;
  let n = 2;
  while (taken.has(key)) key = `${LEDGER_OTHER_BAND_KEY} (${n++})`;
  return key;
}

/**
 * Trims a band list to `LEDGER_MAX_BREAKDOWN_BANDS` real bands plus one
 * folded `other`. Kept bands stay in the caller's original order (the cap
 * decides *which* bands survive, never how they are ordered), and the folded
 * band is appended last. A remainder day where every folded band is `null`
 * stays `null`, so the whole-day-is-a-gap test below sees exactly what it
 * would have seen uncapped.
 */
function capBreakdownBands(
  breakdown: Record<string, Array<number | null>>,
  requested: string[],
  dayCount: number
): { keys: string[]; values: Record<string, Array<number | null> | undefined> } {
  const values: Record<string, Array<number | null> | undefined> = Object.create(null);
  if (requested.length <= LEDGER_MAX_BREAKDOWN_BANDS) {
    for (const key of requested) values[key] = breakdown[key];
    return { keys: [...requested], values };
  }
  const ranked = requested
    .map((key, index) => ({ key, index, peak: peakMagnitude(breakdown[key], dayCount) }))
    .sort((a, b) => b.peak - a.peak || a.index - b.index);
  const kept = new Set(
    ranked.slice(0, LEDGER_MAX_BREAKDOWN_BANDS).map((entry) => entry.key)
  );
  const keys: string[] = [];
  for (const key of requested) {
    if (!kept.has(key)) continue;
    keys.push(key);
    values[key] = breakdown[key];
  }
  const other: Array<number | null> = new Array(dayCount).fill(null);
  for (const key of requested) {
    if (kept.has(key)) continue;
    const band = breakdown[key];
    if (!band) continue;
    for (let day = 0; day < dayCount; day++) {
      const value = band[day];
      if (value == null) continue;
      other[day] = (other[day] ?? 0) + value;
    }
  }
  const otherKey = uniqueOtherKey(kept);
  keys.push(otherKey);
  values[otherKey] = other;
  return { keys, values };
}

/**
 * Stacks a wealth/prestige breakdown into per-day band baselines and tops for
 * an area chart.
 *
 * At most `LEDGER_MAX_BREAKDOWN_BANDS` bands come back, plus an `other` band
 * carrying everything the cap dropped — the returned `keys` is the authority
 * on what the caller renders, and it is never longer than the cap + 1
 * regardless of how many keys the server sent.
 *
 * A day where every key is `null` means the faction has no row at all that
 * day — the breakdown is absent, not zeroed — so the whole day comes out
 * `null` for every band, letting `buildAreaPath` render it as a gap rather
 * than a dip to zero. A day where at least one key is present treats any
 * still-missing key as a zero-width band (the component just doesn't
 * contribute that day), which keeps neighbouring bands from jumping.
 */
export function stackBreakdown(
  breakdown: Record<string, Array<number | null>>,
  dayCount: number,
  order?: string[]
): StackedBreakdown {
  const requested = order ?? Object.keys(breakdown).sort();
  const { keys, values } = capBreakdownBands(breakdown, requested, dayCount);
  const baselines: Array<Array<number | null>> = [];
  const tops: Array<Array<number | null>> = [];
  for (let day = 0; day < dayCount; day++) {
    const dayIsGap = keys.length === 0 || keys.every((key) => values[key]?.[day] == null);
    if (dayIsGap) {
      baselines.push(keys.map(() => null));
      tops.push(keys.map(() => null));
      continue;
    }
    let running = 0;
    const dayBaselines: Array<number | null> = [];
    const dayTops: Array<number | null> = [];
    for (const key of keys) {
      dayBaselines.push(running);
      running += values[key]?.[day] ?? 0;
      dayTops.push(running);
    }
    baselines.push(dayBaselines);
    tops.push(dayTops);
  }
  return { keys, baselines, tops };
}

/**
 * Number of calendar days two inclusive `YYYY-MM-DD` ranges share, `0` when
 * they don't overlap at all. Used to rank candidate registry rows by how much
 * of the requested range they actually cover, rather than a 0/1 "does it
 * overlap" flag that can't break a tie between two rows that both overlap.
 */
export function overlapDayCount(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (start > end) return 0;
  return toUtcDayNumber(end) - toUtcDayNumber(start) + 1;
}

/** `part / whole`, guarded against a zero or missing denominator. */
export function wealthShare(part: number | null, whole: number | null): number | null {
  if (part == null || whole == null || whole === 0) return null;
  return part / whole;
}

/**
 * Classic "nice numbers" tick spacing (Heckbert), so axis labels land on
 * round values (10, 25, 50...) instead of whatever `(max - min) / count` gives.
 */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count <= 0) return [];
  if (min === max) return [min];
  const span = niceNumber(max - min, false);
  const step = niceNumber(span / Math.max(count - 1, 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return ticks;
}

function niceNumber(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

/**
 * Builds an SVG `d` for a line through `values`, breaking into a fresh `M`
 * after every `null` so a gap renders as a gap rather than a straight line
 * across missing days.
 */
export function buildLinePath(
  values: Array<number | null>,
  xScale: (index: number) => number,
  yScale: (value: number) => number
): string {
  let d = "";
  let penDown = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      penDown = false;
      continue;
    }
    const x = xScale(i);
    const y = yScale(v);
    d += penDown ? ` L ${x} ${y}` : `${d ? " " : ""}M ${x} ${y}`;
    penDown = true;
  }
  return d;
}

/**
 * Builds an SVG `d` for a filled band between `tops` and `baselines`, one
 * closed sub-path per contiguous run of non-null days (same gap handling as
 * `buildLinePath`).
 */
export function buildAreaPath(
  tops: Array<number | null>,
  baselines: Array<number | null>,
  xScale: (index: number) => number,
  yScale: (value: number) => number
): string {
  const runs: Array<Array<number>> = [];
  let current: number[] = [];
  for (let i = 0; i < tops.length; i++) {
    const top = tops[i];
    const base = baselines[i];
    // Either endpoint missing ends the run — a `null` baseline shows up
    // paired with a `null` top on a gap day (see `stackBreakdown`), but the
    // check is symmetric so a lone-null baseline can't get silently coerced
    // to 0 and stitch a run across what should be a break.
    if (top == null || base == null) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    current.push(i);
  }
  if (current.length > 0) runs.push(current);

  let d = "";
  for (const run of runs) {
    const topPoints = run.map((i) => ({ x: xScale(i), y: yScale(tops[i] as number) }));
    const basePoints = run
      .map((i) => ({ x: xScale(i), y: yScale(baselines[i] as number) }))
      .reverse();
    d += pathFromRing([...topPoints, ...basePoints]);
  }
  return d.trim();
}

/**
 * Builds an SVG `d` for a "step-after" line: the value at day `i` holds flat
 * until day `i + 1`, where it jumps to the new value — the right shape for a
 * threshold that is fixed for the day and only moves when the server
 * recomputes it, as opposed to `buildLinePath`'s straight interpolation
 * between two numbers that were never actually connected day-to-day.
 *
 * Same gap handling as `buildLinePath`: a `null` ends the current step run
 * (no horizontal segment is drawn across it) and the next non-null value
 * starts a fresh one with a plain move, never an interpolated line.
 */
export function buildStepPath(
  values: Array<number | null>,
  xScale: (index: number) => number,
  yScale: (value: number) => number
): string {
  let d = "";
  let penDown = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      penDown = false;
      continue;
    }
    const x = xScale(i);
    const y = yScale(v);
    if (penDown) {
      d += ` H ${x} V ${y}`;
    } else {
      d += `${d ? " " : ""}M ${x} ${y}`;
    }
    penDown = true;
  }
  return d;
}

function pathFromRing(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const segments = rest.map((p) => `L ${p.x} ${p.y}`);
  return ` M ${first!.x} ${first!.y} ${segments.join(" ")} Z`;
}

/**
 * One selectable entry in a ledger nation dropdown — one per exact registry
 * `name`, merging every `(id, founded_at)` lifetime sharing that name (e.g. a
 * deleted-and-refounded faction) into a single option. Storage keeps the two
 * lifetimes distinct (`(id, founded_at)` identity, unchanged); this is purely
 * a presentation-layer merge, so `keys`/`foundedAt` (parallel arrays, same
 * order) carry every underlying registry key forward so the chart-splicing
 * helpers below can still tell the lifetimes apart per day. Two lifetimes
 * with *different* names always stay separate options, even if they happen
 * to share an `id`; two lifetimes sharing a name merge into one option even
 * though their `founded_at` (and possibly `id`) differ.
 */
export type LedgerFactionOption = {
  /** Exact registry name — also this option's selection identity, since a
   * single `key` can no longer stand in for the (possibly multi-lifetime)
   * history now being charted under one option. */
  name: string;
  /** Every underlying `faction_key` for this name, in ascending `founded_at`
   * order. */
  keys: string[];
  /** `founded_at` for each entry in `keys`, same index — parallel array
   * rather than a map so ordering is explicit and stable. */
  foundedAt: string[];
  /** Bare nation name. No date span and no "ended" marker: a merged option
   * stands for the name's whole history, so there is no single lifetime span
   * left to show, and every option's label is just the name it represents. */
  label: string;
};

/** Bare nation name — every dropdown option's label is just the name it
 * represents, merged or not. */
export function formatLedgerFactionLabel(faction: LedgerRegistryFaction): string {
  return cleanRegionName(faction.name);
}

/** Wealth/prestige stack legend: guild ids and leftover colored names. */
export function formatBreakdownBandLabel(key: string): string {
  let label = cleanRegionName(key).trim();
  label = label.replace(/\s*\(.*[Gg]uild.*\)\s*$/, "").trim();
  return label.replace(/_/g, " ");
}

/**
 * Registry rows whose `[first_seen_day, last_seen_day]` overlaps the built
 * range. The registry is cumulative and survives a chronicle wipe, so without
 * this a new season's dropdown still lists every nation from the seasons
 * before it. Nations deleted *within* the range keep their option.
 */
export function factionsInRange(
  factions: LedgerRegistryFaction[],
  firstDay: string,
  lastDay: string
): LedgerRegistryFaction[] {
  return factions.filter(
    (faction) =>
      overlapDayCount(faction.first_seen_day, faction.last_seen_day, firstDay, lastDay) > 0
  );
}

/**
 * Every registry row folded into one dropdown option per exact name —
 * deleted nations included, since the entire point of keeping them in the
 * registry is to still chart them. A name backed by more than one registry
 * row (the deleted-and-refounded case) becomes a single option whose `keys`
 * carries all of them, sorted by `founded_at` ascending. Options themselves
 * are sorted by name for a stable order across renders.
 */
export function buildLedgerFactionOptions(
  factions: LedgerRegistryFaction[]
): LedgerFactionOption[] {
  const byName = new Map<string, LedgerRegistryFaction[]>();
  for (const faction of factions) {
    const rows = byName.get(faction.name);
    if (rows) rows.push(faction);
    else byName.set(faction.name, [faction]);
  }
  const options: LedgerFactionOption[] = [];
  for (const [name, rows] of byName) {
    const sorted = [...rows].sort((a, b) => a.founded_at.localeCompare(b.founded_at));
    options.push({
      name,
      keys: sorted.map((row) => row.key),
      foundedAt: sorted.map((row) => row.founded_at),
      label: formatLedgerFactionLabel(sorted[0]!),
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
}

/**
 * Picks the registry row to chart when a faction id has more than one — a
 * deleted-and-recreated faction reusing the same id. Prefers whichever row's
 * `[first_seen_day, last_seen_day]` overlaps the requested range in the most
 * *days* (via `overlapDayCount`, not a 0/1 flag — two rows can both overlap
 * the range and still cover very different amounts of it); falls back to the
 * most recently founded row when none overlap at all (e.g. the range is
 * entirely before the faction was ever seen). `null` when `candidates` is
 * empty.
 */
export function resolveFactionKey(
  candidates: LedgerRegistryFaction[],
  firstDay: string,
  lastDay: string
): string | null {
  if (candidates.length === 0) return null;
  let best: LedgerRegistryFaction | null = null;
  let bestOverlap = -1;
  for (const candidate of candidates) {
    const overlap = overlapDayCount(
      candidate.first_seen_day,
      candidate.last_seen_day,
      firstDay,
      lastDay
    );
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = candidate;
    } else if (overlap === bestOverlap && best) {
      if (candidate.founded_at > best.founded_at) best = candidate;
    }
  }
  return (best ?? candidates[candidates.length - 1]!).key;
}

/**
 * A chart card's default selection: the composer's focused nation's own name
 * (resolved to a specific lifetime the same way `resolveFactionKey` always
 * has, by overlap with the built range, then mapped back to that lifetime's
 * name) when one is focused and present in the registry, otherwise the first
 * option in `buildLedgerFactionOptions` order. `null` only when the registry
 * has no factions at all.
 *
 * Returns a *name* (a `LedgerFactionOption.name`), not a `faction_key` — the
 * merge means a single key can no longer identify a card's selection.
 */
export function defaultLedgerFactionOption(
  factions: LedgerRegistryFaction[],
  focusNationId: string | null,
  firstDay: string,
  lastDay: string
): string | null {
  if (focusNationId) {
    const candidates = factions.filter((faction) => faction.id === focusNationId);
    const resolvedKey = resolveFactionKey(candidates, firstDay, lastDay);
    const resolvedFaction = resolvedKey
      ? factions.find((faction) => faction.key === resolvedKey)
      : null;
    if (resolvedFaction) return resolvedFaction.name;
  }
  return buildLedgerFactionOptions(factions)[0]?.name ?? null;
}

/** One underlying registry lifetime backing a merged option, as the splicing
 * helpers below need it: just enough to pick a per-day winner. */
export type FoundedEntry = { key: string; founded_at: string };

/**
 * Splices one field's per-lifetime arrays into a single array over the
 * panel's day axis: on each day, takes the value from whichever entry has a
 * non-null row that day. A day where every entry is `null` stays `null` —
 * that's the requested gap, and it reuses the same null-means-break contract
 * `buildLinePath`/`buildAreaPath`/`stackBreakdown` already draw on, so it
 * must never be filled with `?? 0`. When two entries both have a row on the
 * same day (should not happen — the two lifetimes are meant to be mutually
 * exclusive in time — but the data doesn't forbid it), the entry with the
 * later `founded_at` wins; the values are never summed or averaged.
 */
export function spliceByFoundedAt<T>(
  entries: FoundedEntry[],
  valuesByKey: Record<string, Array<T | null> | undefined>,
  dayCount: number
): Array<T | null> {
  const out: Array<T | null> = new Array(dayCount).fill(null);
  for (let day = 0; day < dayCount; day++) {
    let winnerFoundedAt: string | null = null;
    let winnerValue: T | null = null;
    for (const entry of entries) {
      const value = valuesByKey[entry.key]?.[day];
      if (value == null) continue;
      if (winnerFoundedAt == null || entry.founded_at > winnerFoundedAt) {
        winnerFoundedAt = entry.founded_at;
        winnerValue = value;
      }
    }
    out[day] = winnerValue;
  }
  return out;
}

/**
 * Same splice as `spliceByFoundedAt`, applied to a wealth/prestige breakdown:
 * unions every band key that appears in any entry's breakdown, then splices
 * each band independently. A lifetime that never reported a given band is
 * treated as having no rows for it (rather than an error), which is exactly
 * what `spliceByFoundedAt` already does with a missing array.
 */
export function spliceBreakdownByFoundedAt(
  entries: FoundedEntry[],
  breakdownByKey: Record<string, Record<string, Array<number | null>> | undefined>,
  dayCount: number
): Record<string, Array<number | null>> {
  const bandKeys = new Set<string>();
  for (const entry of entries) {
    for (const bandKey of Object.keys(breakdownByKey[entry.key] ?? {})) bandKeys.add(bandKey);
  }
  // `Object.create(null)`, not `{}`: `bandKey` is an arbitrary server string
  // (`Object.keys` over JSON-parsed payload data), so a band literally named
  // `__proto__` would otherwise hit `Object.prototype`'s setter — the write
  // silently succeeds, the band never becomes an own key, and `result` sails
  // on with a replaced prototype. Same hardening as `chronicleLayers.ts`,
  // `chronicleOwnership.ts`, `chronicleFocus.ts` and `chronicleInfestation.ts`.
  const result: Record<string, Array<number | null>> = Object.create(null);
  for (const bandKey of bandKeys) {
    // Keys here are faction keys rather than band names, but they come off the
    // same untrusted response — no reason for this one to be the exception.
    const valuesByKey: Record<string, Array<number | null>> = Object.create(null);
    for (const entry of entries) {
      valuesByKey[entry.key] = breakdownByKey[entry.key]?.[bandKey] ?? [];
    }
    result[bandKey] = spliceByFoundedAt(entries, valuesByKey, dayCount);
  }
  return result;
}

const LEDGER_FACTION_SPLICE_FIELDS: LedgerFactionField[] = [
  "wealth",
  "bank",
  "vassal_wealth",
  "net_income",
  "inflation_delta",
  "trade_power",
  "prestige",
  "rank_up_at",
  "rank_down_at",
  "prestige_position",
  "wealth_position",
  "provinces",
  "realm_size",
  "members",
  "members_with_vassals",
  "settlements",
  "population",
  "installations",
  "forts",
];

/** A merged option's charted data — the shape `LedgerChartsPanel.tsx` reads,
 * spliced from every underlying lifetime present in a `/series` response. No
 * `key`/`id`/`founded_at` here on purpose: those all belong to one lifetime,
 * and this can represent several. */
export type MergedLedgerFaction = {
  name: string;
  /** The latest lifetime's colour — as good a single choice as any, since a
   * merged option has no single "current" colour by construction. */
  rgb: string;
  series: LedgerNumericSeries;
  rank: Array<string | null>;
  tier: Array<string | null>;
  breakdowns: LedgerBreakdownSeries;
};

/**
 * Splices a `LedgerFactionOption`'s underlying lifetimes into one
 * `MergedLedgerFaction` over `series.days`. `null` when none of the option's
 * keys are actually present in `series` yet (e.g. the selection just changed
 * and the union fetch for it hasn't landed) — same "not there yet" contract
 * `factionForKey` always had for a single key.
 */
export function spliceLedgerFaction(
  option: LedgerFactionOption,
  series: LedgerSeries
): MergedLedgerFaction | null {
  const byKey = new Map(series.factions.map((faction) => [faction.key, faction]));
  const entries: FoundedEntry[] = option.keys
    .map((key, i) => ({ key, founded_at: option.foundedAt[i]! }))
    .filter((entry) => byKey.has(entry.key));
  if (entries.length === 0) return null;

  const dayCount = series.days.length;

  const mergedSeries: LedgerNumericSeries = {};
  for (const field of LEDGER_FACTION_SPLICE_FIELDS) {
    // Null-prototype for every server-keyed map below — `entry.key` is a
    // response string, and `__proto__` must land as an own key or not at all.
    const valuesByKey: Record<string, Array<number | null>> = Object.create(null);
    for (const entry of entries) {
      valuesByKey[entry.key] = byKey.get(entry.key)!.series[field] ?? [];
    }
    mergedSeries[field] = spliceByFoundedAt(entries, valuesByKey, dayCount);
  }

  const rankByKey: Record<string, Array<string | null>> = Object.create(null);
  const tierByKey: Record<string, Array<string | null>> = Object.create(null);
  const wealthBreakdownByKey: Record<string, Record<string, Array<number | null>>> =
    Object.create(null);
  const prestigeBreakdownByKey: Record<string, Record<string, Array<number | null>>> =
    Object.create(null);
  for (const entry of entries) {
    const faction = byKey.get(entry.key)!;
    rankByKey[entry.key] = faction.rank;
    tierByKey[entry.key] = faction.tier;
    wealthBreakdownByKey[entry.key] = faction.breakdowns.wealth;
    prestigeBreakdownByKey[entry.key] = faction.breakdowns.prestige;
  }

  const latest = entries.reduce((a, b) => (b.founded_at > a.founded_at ? b : a));

  return {
    name: option.name,
    rgb: byKey.get(latest.key)!.rgb,
    series: mergedSeries,
    rank: spliceByFoundedAt(entries, rankByKey, dayCount),
    tier: spliceByFoundedAt(entries, tierByKey, dayCount),
    breakdowns: {
      wealth: spliceBreakdownByFoundedAt(entries, wealthBreakdownByKey, dayCount),
      prestige: spliceBreakdownByFoundedAt(entries, prestigeBreakdownByKey, dayCount),
    },
  };
}

/**
 * The cursor-day readout shown under each ledger chart card, unifying the two
 * different kinds of "missing" the panel can hit on the playhead's day:
 *
 *  - the day exists in `series.days` but the selected nation has no row for
 *    it (e.g. disbanded that day) — `cursorIndex` resolves, but the row's
 *    fields are `null`;
 *  - the day doesn't exist in the ledger at all (no snapshot captured
 *    server-wide) — `cursorIndex` finds no exact match, so there's no index
 *    to read a row from in the first place.
 *
 * Both must render the same short line, `"{day}: no data"`. This returns
 * `null` only when there's no cursor day to name at all (`cursorDay` itself
 * is `null`, e.g. before the playhead has landed anywhere) — the caller
 * renders nothing in that case, same as before this existed.
 *
 * `wealth` is deliberately used as the presence signal for every card, not
 * just the wealth card's own readout: a day the nation has no row for at all
 * comes out of `spliceLedgerFaction`/`spliceByFoundedAt` with *every* field
 * null together (the whole-row-null gap convention `stackBreakdown` already
 * relies on), and wealth is the one field guaranteed to be requested for
 * every card. A real value of `0` is not missing — this checks `!= null`,
 * never falsiness, so a genuinely zero-wealth day still reads as data.
 */
export function ledgerCursorReadout(
  cursorDay: string | null,
  cursorIndex: number | null,
  wealth: Array<number | null>
): { day: string; hasData: boolean } | null {
  if (cursorDay == null) return null;
  const hasData = cursorIndex != null && wealth[cursorIndex] != null;
  return { day: cursorDay, hasData };
}

/** Compact money formatting for axis labels and readouts: `1.2M`, `340K`, `—`. */
export function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

/** Same as `formatMoney`, but positive values carry an explicit leading
 * `+` (e.g. `+43`, `+2.9K`). Negative values are unchanged — `formatMoney`
 * already emits their `-` — and zero renders as plain `0` with no sign. */
export function formatSignedMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const formatted = formatMoney(value);
  return value > 0 ? `+${formatted}` : formatted;
}
