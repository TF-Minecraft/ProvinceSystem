import { describe, expect, it } from "vitest";

import type { LedgerFactionSeries, LedgerRegistryFaction, LedgerSeries } from "./ledgerData";
import {
  buildAreaPath,
  buildLedgerFactionOptions,
  buildLinePath,
  buildStepPath,
  defaultLedgerFactionOption,
  diffConsecutive,
  factionsInRange,
  formatBreakdownBandLabel,
  formatLedgerFactionLabel,
  formatMoney,
  formatSignedMoney,
  ledgerCursorReadout,
  LEDGER_MAX_BREAKDOWN_BANDS,
  LEDGER_OTHER_BAND_KEY,
  niceTicks,
  overlapDayCount,
  resolveFactionKey,
  spliceBreakdownByFoundedAt,
  spliceByFoundedAt,
  spliceLedgerFaction,
  sliceToRange,
  stackBreakdown,
  wealthShare,
} from "./ledgerSeries";

/** Builds a minimal registry row, letting each test override only what it cares about. */
function faction(overrides: Partial<LedgerRegistryFaction> & { key: string }): LedgerRegistryFaction {
  return {
    id: overrides.id ?? overrides.key,
    founded_at: "2026-08-01T00:00:00Z",
    name: "Brume",
    rgb: "10,20,30",
    first_seen_day: "2026-08-01",
    first_seen_at: "2026-08-01T00:00:00Z",
    last_seen_day: "2026-08-31",
    last_seen_at: "2026-08-31T00:00:00Z",
    deleted_day: null,
    deleted_at: null,
    ...overrides,
  };
}

describe("sliceToRange", () => {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-05"];

  it("covers everything with no bounds", () => {
    expect(sliceToRange(days)).toEqual({ start: 0, end: 4 });
  });

  it("clamps to the requested start/end", () => {
    expect(sliceToRange(days, "2026-08-02", "2026-08-03")).toEqual({ start: 1, end: 3 });
  });

  it("runs to the end when only start is given", () => {
    expect(sliceToRange(days, "2026-08-02")).toEqual({ start: 1, end: 4 });
  });

  it("runs from the start when only end is given", () => {
    expect(sliceToRange(days, undefined, "2026-08-02")).toEqual({ start: 0, end: 2 });
  });

  it("returns an empty slice when start is past every day", () => {
    expect(sliceToRange(days, "2026-09-01")).toEqual({ start: 4, end: 4 });
  });

  it("returns an empty slice when end is before every day", () => {
    expect(sliceToRange(days, undefined, "2026-07-01")).toEqual({ start: 0, end: 0 });
  });
});

describe("diffConsecutive", () => {
  it("has no delta on the first day", () => {
    expect(diffConsecutive(["2026-08-01"], [100])).toEqual([null]);
  });

  it("diffs consecutive calendar days", () => {
    const days = ["2026-08-01", "2026-08-02", "2026-08-03"];
    expect(diffConsecutive(days, [100, 150, 120])).toEqual([null, 50, -30]);
  });

  it("never diffs across a calendar gap even when array indices are adjacent", () => {
    // 08-02 is missing entirely from the axis — 08-01 and 08-03 are neighbours
    // in the array but two days apart on the calendar.
    const days = ["2026-08-01", "2026-08-03"];
    expect(diffConsecutive(days, [100, 150])).toEqual([null, null]);
  });

  it("never diffs across a null neighbour (faction absent that day)", () => {
    const days = ["2026-08-01", "2026-08-02", "2026-08-03"];
    expect(diffConsecutive(days, [100, null, 120])).toEqual([null, null, null]);
  });

  it("resumes diffing once both neighbours are present again", () => {
    const days = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"];
    expect(diffConsecutive(days, [100, null, 120, 130])).toEqual([null, null, null, 10]);
  });
});

describe("stackBreakdown", () => {
  it("stacks bands in the given key order with running baselines/tops", () => {
    const breakdown = {
      trade: [10, 20],
      tax: [5, 5],
    };
    const result = stackBreakdown(breakdown, 2, ["trade", "tax"]);
    expect(result.keys).toEqual(["trade", "tax"]);
    expect(result.baselines).toEqual([
      [0, 10],
      [0, 20],
    ]);
    expect(result.tops).toEqual([
      [10, 15],
      [20, 25],
    ]);
  });

  it("sorts keys when no order is given, for determinism", () => {
    const breakdown = { z: [1], a: [2] };
    const result = stackBreakdown(breakdown, 1);
    expect(result.keys).toEqual(["a", "z"]);
  });

  it("treats a missing value for a day as a zero-width band, not a gap", () => {
    const breakdown = { a: [10, null], b: [5, 5] };
    const result = stackBreakdown(breakdown, 2, ["a", "b"]);
    expect(result.tops[1]).toEqual([0, 5]);
  });

  it("emits null tops/baselines for a day the faction has no row for at all", () => {
    // Day 1: every key is null — the faction was absent that day, not a
    // component that fell to zero. Day 0 and day 2 have at least one real
    // value and should stack normally.
    const breakdown = { a: [10, null, 30], b: [5, null, 15] };
    const result = stackBreakdown(breakdown, 3, ["a", "b"]);
    expect(result.tops[1]).toEqual([null, null]);
    expect(result.baselines[1]).toEqual([null, null]);
    expect(result.tops[0]).toEqual([10, 15]);
    expect(result.tops[2]).toEqual([30, 45]);
  });

  it("treats a day with no keys at all as a gap, not a zero-height stack", () => {
    const result = stackBreakdown({}, 1, []);
    expect(result.tops[0]).toEqual([]);
    expect(result.baselines[0]).toEqual([]);
  });
});

describe("wealthShare", () => {
  it("divides part by whole", () => {
    expect(wealthShare(25, 100)).toBe(0.25);
  });

  it("guards a zero denominator", () => {
    expect(wealthShare(25, 0)).toBeNull();
  });

  it("guards a null denominator or numerator", () => {
    expect(wealthShare(25, null)).toBeNull();
    expect(wealthShare(null, 100)).toBeNull();
  });
});

describe("niceTicks", () => {
  it("returns round numbers spanning the range", () => {
    const ticks = niceTicks(0, 97, 5);
    expect(ticks[0]).toBeLessThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(97);
    // every step should be the same round increment
    const steps = new Set<number>();
    for (let i = 1; i < ticks.length; i++) {
      steps.add(Math.round((ticks[i]! - ticks[i - 1]!) * 1e6) / 1e6);
    }
    expect(steps.size).toBe(1);
  });

  it("collapses to a single tick when min equals max", () => {
    expect(niceTicks(5, 5, 4)).toEqual([5]);
  });

  it("returns nothing for a non-finite or zero count input", () => {
    expect(niceTicks(NaN, 10, 4)).toEqual([]);
    expect(niceTicks(0, 10, 0)).toEqual([]);
  });
});

describe("buildLinePath", () => {
  const xScale = (i: number) => i * 10;
  const yScale = (v: number) => 100 - v;

  it("draws one continuous path with no gaps", () => {
    const d = buildLinePath([10, 20, 30], xScale, yScale);
    expect(d).toBe("M 0 90 L 10 80 L 20 70");
  });

  it("breaks into a new M after a null", () => {
    const d = buildLinePath([10, null, 30], xScale, yScale);
    expect(d).toBe("M 0 90 M 20 70");
  });

  it("returns an empty string when every value is null", () => {
    expect(buildLinePath([null, null], xScale, yScale)).toBe("");
  });
});

describe("buildAreaPath", () => {
  const xScale = (i: number) => i * 10;
  const yScale = (v: number) => 100 - v;

  it("builds one closed ring for a contiguous run", () => {
    const d = buildAreaPath([50, 60], [0, 0], xScale, yScale);
    expect(d).toBe("M 0 50 L 10 40 L 10 100 L 0 100 Z");
  });

  it("splits into separate rings across a gap in the top series", () => {
    const d = buildAreaPath([50, null, 60], [0, 0, 0], xScale, yScale);
    expect(d).toContain("Z");
    // two independent single-point degenerate rings, one per side of the gap
    expect(d.match(/Z/g)?.length).toBe(2);
  });

  it("also breaks the run on a null baseline even when the top is non-null", () => {
    // Regression: a stray null baseline used to be silently coerced to 0
    // (`baselines[i] ?? 0`) and stitched into the surrounding run instead of
    // breaking it — this is the day-is-a-gap case `stackBreakdown` now
    // produces (both top and baseline null together), but the check must be
    // symmetric so a null in either array ends the run.
    const d = buildAreaPath([50, 60, 70], [0, null, 0], xScale, yScale);
    expect(d.match(/Z/g)?.length).toBe(2);
  });

  it("renders nothing for a day the faction has no row for at all", () => {
    // End-to-end null-gap contract: stackBreakdown's gap day (both null) must
    // not draw as a dip to zero.
    const stacked = stackBreakdown({ a: [10, null, 30] }, 3, ["a"]);
    const tops = stacked.tops.map((row) => row[0] ?? null);
    const baselines = stacked.baselines.map((row) => row[0] ?? null);
    const d = buildAreaPath(tops, baselines, xScale, yScale);
    expect(d.match(/Z/g)?.length).toBe(2);
  });
});

describe("overlapDayCount", () => {
  it("counts the shared inclusive days between two ranges", () => {
    expect(overlapDayCount("2026-08-01", "2026-08-10", "2026-08-05", "2026-08-20")).toBe(6);
  });

  it("returns the full range when one contains the other", () => {
    expect(overlapDayCount("2026-08-01", "2026-08-31", "2026-08-05", "2026-08-10")).toBe(6);
  });

  it("returns 0 for disjoint ranges", () => {
    expect(overlapDayCount("2026-08-01", "2026-08-05", "2026-08-10", "2026-08-20")).toBe(0);
  });

  it("returns 1 for a single shared day", () => {
    expect(overlapDayCount("2026-08-01", "2026-08-05", "2026-08-05", "2026-08-10")).toBe(1);
  });

  it("breaks a tie between two overlapping candidates by actual day count, not a 0/1 flag", () => {
    // Both candidates overlap the requested range, but B covers far more of
    // it — B must win even though a boolean "does it overlap" check would
    // have called this a tie.
    const requested = { start: "2026-08-01", end: "2026-08-31" };
    const a = overlapDayCount("2026-07-30", "2026-08-02", requested.start, requested.end);
    const b = overlapDayCount("2026-08-01", "2026-08-31", requested.start, requested.end);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });
});

describe("buildStepPath", () => {
  const xScale = (i: number) => i * 10;
  const yScale = (v: number) => 100 - v;

  it("holds the value flat until the next day, then jumps", () => {
    const d = buildStepPath([10, 10, 30], xScale, yScale);
    expect(d).toBe("M 0 90 H 10 V 90 H 20 V 70");
  });

  it("breaks into a new M after a null instead of interpolating across it", () => {
    const d = buildStepPath([10, null, 30], xScale, yScale);
    expect(d).toBe("M 0 90 M 20 70");
  });

  it("returns an empty string when every value is null", () => {
    expect(buildStepPath([null, null], xScale, yScale)).toBe("");
  });

  it("draws a single point with no segment when only one value is present", () => {
    expect(buildStepPath([null, 42], xScale, yScale)).toBe("M 10 58");
  });
});

describe("formatBreakdownBandLabel", () => {
  it("turns a guild id into a readable name", () => {
    expect(formatBreakdownBandLabel("The_Betriebsrat")).toBe("The Betriebsrat");
  });

  it("strips Minecraft color and a leftover (Guild) suffix", () => {
    expect(
      formatBreakdownBandLabel(
        "§x§a§3§a§1§8§4The Betriebsrat #a39ba8(§x§b§d§a§4§6§4Guild#a39ba8)"
      )
    ).toBe("The Betriebsrat");
  });

  it("leaves component keys alone", () => {
    expect(formatBreakdownBandLabel("Bank")).toBe("Bank");
    expect(formatBreakdownBandLabel("Nodes")).toBe("Nodes");
  });
});

describe("formatLedgerFactionLabel", () => {
  it.each([
    ["§x§a§3§a§1§8§4Prospero", "Prospero"],
    ["§cAzur §lClan§r", "Azur Clan"],
    ["§x§a§3§a§1§8§44123", "4123"],
  ])("removes Minecraft formatting from %s", (name, label) => {
    expect(formatLedgerFactionLabel(faction({ key: "formatted", name }))).toBe(label);
  });

  it("is the bare nation name, with no date span or ended marker", () => {
    const f = faction({
      key: "brume-1",
      first_seen_day: "2026-08-18",
      last_seen_day: "2026-08-21",
    });
    expect(formatLedgerFactionLabel(f)).toBe("Brume");
  });

  it("is still the bare name for a deleted row", () => {
    const f = faction({
      key: "brume-1",
      deleted_day: "2026-08-21",
      deleted_at: "2026-08-21T00:00:00Z",
    });
    expect(formatLedgerFactionLabel(f)).toBe("Brume");
  });
});

describe("buildLedgerFactionOptions", () => {
  it("cleans and sorts visible labels while preserving selection names and faction keys", () => {
    const azur = "§cAzur Clan";
    const prospero = "§aProspero";
    const options = buildLedgerFactionOptions([
      faction({ key: "prospero", name: prospero }),
      faction({ key: "azur", name: azur }),
    ]);
    expect(options.map(({ name, label, keys }) => ({ name, label, keys }))).toEqual([
      { name: azur, label: "Azur Clan", keys: ["azur"] },
      { name: prospero, label: "Prospero", keys: ["prospero"] },
    ]);
  });

  it("emits one option per distinct name, deleted rows included", () => {
    const rows = [
      faction({
        key: "brume-1",
        id: "brume",
        founded_at: "2026-08-18T00:00:00Z",
        first_seen_day: "2026-08-18",
        last_seen_day: "2026-08-21",
        deleted_day: "2026-08-21",
      }),
      faction({
        key: "brume-2",
        id: "brume",
        founded_at: "2026-08-24T00:00:00Z",
        first_seen_day: "2026-08-24",
        last_seen_day: "2026-08-31",
      }),
      faction({ key: "karsk", id: "karsk", name: "Karsk" }),
    ];
    const options = buildLedgerFactionOptions(rows);
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.name)).toEqual(
      expect.arrayContaining(["Brume", "Karsk"])
    );
  });

  it("merges a reused id's two lifetimes sharing a name into one option", () => {
    const rows = [
      faction({
        key: "brume-1",
        id: "brume",
        founded_at: "2026-08-18T00:00:00Z",
        first_seen_day: "2026-08-18",
        last_seen_day: "2026-08-21",
        deleted_day: "2026-08-21",
      }),
      faction({
        key: "brume-2",
        id: "brume",
        founded_at: "2026-08-24T00:00:00Z",
        first_seen_day: "2026-08-24",
        last_seen_day: "2026-08-31",
      }),
    ];
    const options = buildLedgerFactionOptions(rows);
    expect(options).toHaveLength(1);
    const brume = options[0]!;
    expect(brume.label).toBe("Brume");
    // Both underlying keys carried forward, oldest founded_at first, so the
    // splicing helpers can still tell the two lifetimes apart per day.
    expect(brume.keys).toEqual(["brume-1", "brume-2"]);
    expect(brume.foundedAt).toEqual(["2026-08-18T00:00:00Z", "2026-08-24T00:00:00Z"]);
  });

  it("keeps two different names separate even when they happen to share an id", () => {
    const rows = [
      faction({ key: "a", id: "shared-id", name: "Brume" }),
      faction({ key: "b", id: "shared-id", name: "Karsk" }),
    ];
    const options = buildLedgerFactionOptions(rows);
    expect(options.map((o) => o.name)).toEqual(["Brume", "Karsk"]);
  });

  it("sorts options by name for a stable order across renders", () => {
    const rows = [
      faction({ key: "z", id: "z", name: "Velin" }),
      faction({ key: "a", id: "a", name: "Karsk" }),
    ];
    const options = buildLedgerFactionOptions(rows);
    expect(options.map((o) => o.name)).toEqual(["Karsk", "Velin"]);
  });
});

describe("factionsInRange", () => {
  it("drops nations last seen before the range, keeping ones deleted within it", () => {
    const rows = [
      faction({ key: "old", first_seen_day: "2026-09-13", last_seen_day: "2026-09-15", deleted_day: "2026-09-19" }),
      faction({ key: "short", first_seen_day: "2026-09-19", last_seen_day: "2026-09-19", deleted_day: "2026-09-21" }),
      faction({ key: "live", first_seen_day: "2026-09-19", last_seen_day: "2026-09-29" }),
    ];
    expect(factionsInRange(rows, "2026-09-19", "2026-09-29").map((f) => f.key)).toEqual([
      "short",
      "live",
    ]);
  });
});

describe("resolveFactionKey", () => {
  const older = faction({
    key: "brume-1",
    id: "brume",
    founded_at: "2026-08-18T00:00:00Z",
    first_seen_day: "2026-08-18",
    last_seen_day: "2026-08-21",
    deleted_day: "2026-08-21",
  });
  const newer = faction({
    key: "brume-2",
    id: "brume",
    founded_at: "2026-08-24T00:00:00Z",
    first_seen_day: "2026-08-24",
    last_seen_day: "2026-08-31",
  });

  it("returns null for an empty candidate list", () => {
    expect(resolveFactionKey([], "2026-08-01", "2026-08-31")).toBeNull();
  });

  it("picks whichever lifetime overlaps the requested range the most", () => {
    expect(resolveFactionKey([older, newer], "2026-08-24", "2026-08-31")).toBe("brume-2");
    expect(resolveFactionKey([older, newer], "2026-08-18", "2026-08-21")).toBe("brume-1");
  });

  it("falls back to the most recently founded row when neither overlaps", () => {
    expect(resolveFactionKey([older, newer], "2026-01-01", "2026-01-05")).toBe("brume-2");
  });
});

describe("defaultLedgerFactionOption", () => {
  const brumeOld = faction({
    key: "brume-1",
    id: "brume",
    founded_at: "2026-08-18T00:00:00Z",
    name: "Brume",
    first_seen_day: "2026-08-18",
    last_seen_day: "2026-08-21",
    deleted_day: "2026-08-21",
  });
  const brumeNew = faction({
    key: "brume-2",
    id: "brume",
    founded_at: "2026-08-24T00:00:00Z",
    name: "Brume",
    first_seen_day: "2026-08-24",
    last_seen_day: "2026-08-31",
  });
  const karsk = faction({
    key: "karsk",
    id: "karsk",
    name: "Karsk",
    first_seen_day: "2026-08-18",
    last_seen_day: "2026-08-31",
  });
  const registry = [brumeOld, brumeNew, karsk];

  it("defaults to the focused nation's name, resolved via the lifetime overlapping the built range", () => {
    expect(defaultLedgerFactionOption(registry, "brume", "2026-08-24", "2026-08-31")).toBe(
      "Brume"
    );
    expect(defaultLedgerFactionOption(registry, "brume", "2026-08-18", "2026-08-21")).toBe(
      "Brume"
    );
  });

  it("falls back to the first available option when no nation is focused", () => {
    // Alphabetical: "Brume" sorts before "Karsk".
    expect(defaultLedgerFactionOption(registry, null, "2026-08-18", "2026-08-31")).toBe(
      "Brume"
    );
  });

  it("falls back to the first available option when the focused id isn't in the registry", () => {
    expect(defaultLedgerFactionOption(registry, "lantan", "2026-08-18", "2026-08-31")).toBe(
      "Brume"
    );
  });

  it("returns null when the registry has no factions at all", () => {
    expect(defaultLedgerFactionOption([], "brume", "2026-08-18", "2026-08-31")).toBeNull();
  });
});

describe("spliceByFoundedAt", () => {
  const older = { key: "brume-1", founded_at: "2026-08-18T00:00:00Z" };
  const newer = { key: "brume-2", founded_at: "2026-08-24T00:00:00Z" };

  it("takes the value from whichever entry has a row that day", () => {
    const values = {
      "brume-1": [10, 20, 30, null, null, null, null],
      "brume-2": [null, null, null, null, null, 50, 60],
    };
    expect(spliceByFoundedAt([older, newer], values, 7)).toEqual([
      10, 20, 30, null, null, 50, 60,
    ]);
  });

  it("leaves a day null when no entry has a row that day — the requested gap", () => {
    const values = {
      "brume-1": [10, null],
      "brume-2": [null, null],
    };
    expect(spliceByFoundedAt([older, newer], values, 2)).toEqual([10, null]);
  });

  it("resolves a same-day collision by later founded_at, never summing", () => {
    const values = {
      "brume-1": [100],
      "brume-2": [7],
    };
    // Later founded_at (brume-2) wins outright — not 107, not an average.
    expect(spliceByFoundedAt([older, newer], values, 1)).toEqual([7]);
    // Order of the entries array must not matter.
    expect(spliceByFoundedAt([newer, older], values, 1)).toEqual([7]);
  });

  it("treats a missing array for a key the same as all-null", () => {
    const values = { "brume-1": [10] };
    expect(spliceByFoundedAt([older, newer], values, 1)).toEqual([10]);
  });
});

describe("spliceBreakdownByFoundedAt", () => {
  const older = { key: "brume-1", founded_at: "2026-08-18T00:00:00Z" };
  const newer = { key: "brume-2", founded_at: "2026-08-24T00:00:00Z" };

  it("unions band keys across lifetimes and splices each independently", () => {
    const breakdowns = {
      "brume-1": { trade: [10, null], tax: [1, null] },
      "brume-2": { trade: [null, 20], settlement: [null, 5] },
    };
    const result = spliceBreakdownByFoundedAt([older, newer], breakdowns, 2);
    expect(result.trade).toEqual([10, 20]);
    expect(result.tax).toEqual([1, null]);
    expect(result.settlement).toEqual([null, 5]);
  });
});

/** Minimal `LedgerFactionSeries` fixture for `spliceLedgerFaction` tests. */
function factionSeries(
  overrides: Partial<LedgerFactionSeries> & { key: string; founded_at: string }
): LedgerFactionSeries {
  return {
    id: "brume",
    name: "Brume",
    rgb: "10,20,30",
    series: {},
    rank: [],
    tier: [],
    breakdowns: { wealth: {}, prestige: {} },
    ...overrides,
  };
}

describe("spliceLedgerFaction", () => {
  const days = [
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
    "2026-08-23",
    "2026-08-24",
    "2026-08-25",
  ];

  function baseSeries(factions: LedgerFactionSeries[]): LedgerSeries {
    return {
      days,
      server_day: days.map(() => null),
      captured_at: days.map(() => null),
      complete: days.map(() => null),
      global: {},
      factions,
      truncated: false,
    };
  }

  const option = {
    name: "Brume",
    keys: ["brume-1", "brume-2"],
    foundedAt: ["2026-08-18T00:00:00Z", "2026-08-24T00:00:00Z"],
    label: "Brume",
  };

  it("splices two lifetimes' wealth into one series with a gap across the dead period", () => {
    const lifetime1 = factionSeries({
      key: "brume-1",
      founded_at: "2026-08-18T00:00:00Z",
      series: { wealth: [100, 110, 120, null, null, null, null, null] },
    });
    const lifetime2 = factionSeries({
      key: "brume-2",
      founded_at: "2026-08-24T00:00:00Z",
      series: { wealth: [null, null, null, null, null, null, 500, 510] },
    });
    const series = baseSeries([lifetime1, lifetime2]);
    const merged = spliceLedgerFaction(option, series);
    expect(merged).not.toBeNull();
    expect(merged!.series.wealth).toEqual([
      100, 110, 120, null, null, null, 500, 510,
    ]);
  });

  it("picks the later founded_at on a same-day collision, never summing", () => {
    const lifetime1 = factionSeries({
      key: "brume-1",
      founded_at: "2026-08-18T00:00:00Z",
      series: { wealth: [100, 100, 100, 100, 100, 100, 100, 100] },
    });
    const lifetime2 = factionSeries({
      key: "brume-2",
      founded_at: "2026-08-24T00:00:00Z",
      // Overlaps lifetime1 on day index 6 (2026-08-24), which shouldn't
      // happen in real data but must resolve deterministically if it does.
      series: { wealth: [null, null, null, null, null, null, 9, 10] },
    });
    const series = baseSeries([lifetime1, lifetime2]);
    const merged = spliceLedgerFaction(option, series);
    expect(merged!.series.wealth![6]).toBe(9);
    expect(merged!.series.wealth![6]).not.toBe(109);
  });

  it("splices breakdowns and rank the same way", () => {
    const lifetime1 = factionSeries({
      key: "brume-1",
      founded_at: "2026-08-18T00:00:00Z",
      rank: ["duchy", "duchy", "duchy", null, null, null, null, null],
      breakdowns: {
        wealth: { trade: [10, 10, 10, null, null, null, null, null] },
        prestige: {},
      },
    });
    const lifetime2 = factionSeries({
      key: "brume-2",
      founded_at: "2026-08-24T00:00:00Z",
      rank: [null, null, null, null, null, null, "kingdom", "kingdom"],
      breakdowns: {
        wealth: { trade: [null, null, null, null, null, null, 40, 40] },
        prestige: {},
      },
    });
    const series = baseSeries([lifetime1, lifetime2]);
    const merged = spliceLedgerFaction(option, series);
    expect(merged!.rank).toEqual([
      "duchy", "duchy", "duchy", null, null, null, "kingdom", "kingdom",
    ]);
    expect(merged!.breakdowns.wealth.trade).toEqual([
      10, 10, 10, null, null, null, 40, 40,
    ]);
  });

  it("returns null when none of the option's keys are present in the series yet", () => {
    const series = baseSeries([]);
    expect(spliceLedgerFaction(option, series)).toBeNull();
  });

  it("uses the latest present lifetime's colour", () => {
    const lifetime1 = factionSeries({
      key: "brume-1",
      founded_at: "2026-08-18T00:00:00Z",
      rgb: "1,1,1",
    });
    const lifetime2 = factionSeries({
      key: "brume-2",
      founded_at: "2026-08-24T00:00:00Z",
      rgb: "2,2,2",
    });
    const series = baseSeries([lifetime1, lifetime2]);
    expect(spliceLedgerFaction(option, series)!.rgb).toBe("2,2,2");
  });
});

describe("ledgerCursorReadout", () => {
  it("returns null when there is no cursor day to name at all", () => {
    expect(ledgerCursorReadout(null, null, [100])).toBeNull();
    expect(ledgerCursorReadout(null, 0, [100])).toBeNull();
  });

  it("has data when the day exists and the faction has a wealth row", () => {
    expect(ledgerCursorReadout("2026-08-18", 0, [100])).toEqual({
      day: "2026-08-18",
      hasData: true,
    });
  });

  it("is missing when the day exists in the ledger but the faction has no row (disbanded)", () => {
    // cursorIndex resolves (the day is in series.days) but the row is null —
    // e.g. the nation was disbanded that day.
    expect(ledgerCursorReadout("2026-08-22", 1, [100, null])).toEqual({
      day: "2026-08-22",
      hasData: false,
    });
  });

  it("is missing when the day doesn't exist in the ledger at all", () => {
    // No exact match in series.days, so cursorIndex is null — a server-wide
    // gap day, distinct from the disbanded case above but rendered the same.
    expect(ledgerCursorReadout("2026-08-23", null, [100, null])).toEqual({
      day: "2026-08-23",
      hasData: false,
    });
  });

  it("treats a genuine zero wealth value as data, not missing", () => {
    // Falsiness must not be mistaken for absence: 0 is a real value.
    expect(ledgerCursorReadout("2026-08-18", 0, [0])).toEqual({
      day: "2026-08-18",
      hasData: true,
    });
  });
});

describe("formatMoney", () => {
  it("formats null as an em dash", () => {
    expect(formatMoney(null)).toBe("—");
  });

  it("formats small values as whole numbers", () => {
    expect(formatMoney(340)).toBe("340");
  });

  it("formats thousands, millions and billions with one decimal", () => {
    expect(formatMoney(1_500)).toBe("1.5K");
    expect(formatMoney(2_300_000)).toBe("2.3M");
    expect(formatMoney(4_100_000_000)).toBe("4.1B");
  });

  it("preserves sign", () => {
    expect(formatMoney(-2_000)).toBe("-2.0K");
  });
});

describe("formatSignedMoney", () => {
  it("formats null as an em dash", () => {
    expect(formatSignedMoney(null)).toBe("—");
  });

  it("adds a leading plus for positive values", () => {
    expect(formatSignedMoney(43)).toBe("+43");
  });

  it("keeps the existing minus for negative values without doubling it", () => {
    expect(formatSignedMoney(-12)).toBe("-12");
  });

  it("renders zero with no sign", () => {
    expect(formatSignedMoney(0)).toBe("0");
  });

  it("adds a leading plus to large abbreviated values", () => {
    expect(formatSignedMoney(2_900)).toBe("+2.9K");
  });
});

describe("stackBreakdown band cap", () => {
  /** `n` bands, band `i` peaking at `i` so the ranking is unambiguous. */
  function manyBands(n: number, dayCount = 2): Record<string, Array<number | null>> {
    const breakdown: Record<string, Array<number | null>> = {};
    for (let i = 0; i < n; i++) {
      breakdown[`band-${i}`] = new Array(dayCount).fill(i);
    }
    return breakdown;
  }

  it("never renders more than the cap plus one folded band, however many keys the server sent", () => {
    // The hang: the breakdown key set is attacker-controlled, and every key
    // becomes a `<path>` and a legend `<span>` per card.
    const result = stackBreakdown(manyBands(50_000), 2);
    expect(result.keys.length).toBe(LEDGER_MAX_BREAKDOWN_BANDS + 1);
    expect(result.tops[0]!.length).toBe(LEDGER_MAX_BREAKDOWN_BANDS + 1);
    expect(result.baselines[0]!.length).toBe(LEDGER_MAX_BREAKDOWN_BANDS + 1);
  });

  it("caps an explicitly ordered key list too", () => {
    const breakdown = manyBands(40);
    const order = Object.keys(breakdown);
    expect(stackBreakdown(breakdown, 2, order).keys.length).toBe(
      LEDGER_MAX_BREAKDOWN_BANDS + 1
    );
  });

  it("keeps the largest bands by peak magnitude and folds the rest into `other`", () => {
    const result = stackBreakdown(manyBands(20), 1);
    expect(result.keys[result.keys.length - 1]).toBe(LEDGER_OTHER_BAND_KEY);
    // Bands 8..19 are the twelve largest; 0..7 are folded away. The kept
    // bands stay in the caller's own order (here `Object.keys(...).sort()`,
    // which is lexicographic), never re-sorted by magnitude.
    expect(result.keys.slice(0, LEDGER_MAX_BREAKDOWN_BANDS)).toEqual([
      "band-10",
      "band-11",
      "band-12",
      "band-13",
      "band-14",
      "band-15",
      "band-16",
      "band-17",
      "band-18",
      "band-19",
      "band-8",
      "band-9",
    ]);
  });

  it("keeps the stack total identical to the uncapped sum", () => {
    const breakdown = manyBands(20, 1);
    const result = stackBreakdown(breakdown, 1);
    const total = result.tops[0]![result.keys.length - 1];
    // 0 + 1 + ... + 19
    expect(total).toBe(190);
  });

  it("leaves the folded band null on a day no folded component reported", () => {
    const breakdown = manyBands(20, 2);
    for (let i = 0; i < 8; i++) breakdown[`band-${i}`] = [i, null];
    const result = stackBreakdown(breakdown, 2);
    const otherIndex = result.keys.indexOf(LEDGER_OTHER_BAND_KEY);
    // Day 1 still has the kept bands, so it is not a gap day; the folded band
    // just contributes nothing, which must not shift the day's total.
    expect(result.tops[1]![otherIndex]).toBe(result.baselines[1]![otherIndex]);
  });

  it("leaves a whole-gap day null across every band even when capped", () => {
    const breakdown = manyBands(20, 2);
    for (const key of Object.keys(breakdown)) breakdown[key] = [1, null];
    const result = stackBreakdown(breakdown, 2);
    expect(result.tops[1]!.every((v) => v === null)).toBe(true);
  });

  it("does not collide with a real band literally named `other`", () => {
    const breakdown = manyBands(20);
    breakdown[LEDGER_OTHER_BAND_KEY] = [100, 100];
    const result = stackBreakdown(breakdown, 2);
    expect(result.keys).toContain(LEDGER_OTHER_BAND_KEY);
    expect(new Set(result.keys).size).toBe(result.keys.length);
  });

  it("leaves a breakdown at or under the cap exactly as it was", () => {
    const result = stackBreakdown({ tax: [1], trade: [2] }, 1);
    expect(result.keys).toEqual(["tax", "trade"]);
  });
});

describe("spliceBreakdownByFoundedAt prototype safety", () => {
  const entries = [{ key: "f1", founded_at: "2026-08-01T00:00:00Z" }];

  it("keeps a `__proto__` band as an own key instead of replacing the prototype", () => {
    const breakdownByKey = {
      f1: JSON.parse('{"__proto__": [7], "tax": [3]}') as Record<
        string,
        Array<number | null>
      >,
    };
    const result = spliceBreakdownByFoundedAt(entries, breakdownByKey, 1);
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(Object.keys(result).sort()).toEqual(["__proto__", "tax"]);
    // And the band's data actually survives, rather than being swallowed by
    // `Object.prototype`'s setter.
    expect((result as Record<string, Array<number | null>>)["__proto__"]).toEqual([7]);
  });

  it("keeps a `__proto__` faction key out of the prototype chain when splicing", () => {
    const protoEntries = [{ key: "__proto__", founded_at: "2026-08-01T00:00:00Z" }];
    const breakdownByKey = { ["__proto__"]: { tax: [5] } } as unknown as Record<
      string,
      Record<string, Array<number | null>>
    >;
    const result = spliceBreakdownByFoundedAt(protoEntries, breakdownByKey, 1);
    expect(Object.getPrototypeOf(result)).toBe(null);
  });
});
