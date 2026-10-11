import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MapAccessError } from "@/lib/map/api";

import {
  LEDGER_DEFAULT_FACTION_COUNT,
  LEDGER_MAX_FACTION_KEYS,
  LEDGER_MAX_RANGE_DAYS,
  fetchLedgerFaction,
  fetchLedgerIndex,
  fetchLedgerSeries,
  ledgerDayPath,
  ledgerFactionPath,
  ledgerIndexPath,
  ledgerSeriesPath,
  uniqueFactionKeys,
  type LedgerIndex,
  type LedgerSeries,
} from "./ledgerData";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("ledger data paths", () => {
  it("builds the index path", () => {
    expect(ledgerIndexPath("dev")).toBe("/dev/ledger/index");
  });

  it("builds a bare series path with no query", () => {
    expect(ledgerSeriesPath("dev")).toBe("/dev/ledger/series");
  });

  it("builds a series path with range, factions and fields", () => {
    const path = ledgerSeriesPath("dev", {
      start: "2026-08-01",
      end: "2026-08-31",
      factions: ["abc123", "def456"],
      fields: "full",
    });
    expect(path).toBe("/dev/ledger/series?start=2026-08-01&end=2026-08-31&factions=abc123%2Cdef456&fields=full");
  });

  it("omits factions/fields entirely when not requested", () => {
    const path = ledgerSeriesPath("dev", { start: "2026-08-01" });
    expect(path).toBe("/dev/ledger/series?start=2026-08-01");
  });

  it("builds a faction path with the key encoded", () => {
    expect(ledgerFactionPath("dev", "a b/c")).toBe("/dev/ledger/faction/a%20b%2Fc");
    expect(ledgerFactionPath("dev", "key1", { start: "2026-08-01", end: "2026-08-31" })).toBe(
      "/dev/ledger/faction/key1?start=2026-08-01&end=2026-08-31",
    );
  });

  it("builds a day path with the day encoded", () => {
    expect(ledgerDayPath("dev", "2026-08-31")).toBe("/dev/ledger/day/2026-08-31");
  });

  it("exposes the plan's caps as constants", () => {
    expect(LEDGER_MAX_RANGE_DAYS).toBe(730);
    expect(LEDGER_MAX_FACTION_KEYS).toBe(40);
    expect(LEDGER_DEFAULT_FACTION_COUNT).toBe(12);
  });
});

describe("uniqueFactionKeys", () => {
  it("de-duplicates while keeping first-occurrence order", () => {
    expect(uniqueFactionKeys(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("drops null/undefined/empty selections", () => {
    expect(uniqueFactionKeys(["a", null, undefined, "", "b"])).toEqual(["a", "b"]);
  });

  it("caps the result at LEDGER_MAX_FACTION_KEYS", () => {
    const many = Array.from({ length: LEDGER_MAX_FACTION_KEYS + 10 }, (_, i) => `k${i}`);
    expect(uniqueFactionKeys(many)).toHaveLength(LEDGER_MAX_FACTION_KEYS);
  });
});

describe("ledger data fetches", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetchLedgerIndex hits the index route and returns the parsed body", async () => {
    const index: LedgerIndex = {
      days: ["2026-08-30", "2026-08-31"],
      first: "2026-08-30",
      last: "2026-08-31",
      latest_complete_day: "2026-08-31",
      incomplete_days: [],
      server_day_first: 100,
      server_day_last: 101,
      factions: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(index));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLedgerIndex("dev", "tok")).resolves.toEqual(index);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/dev/ledger/index");
  });

  it("fetchLedgerSeries passes an abort signal through to fetch", async () => {
    const series: LedgerSeries = {
      days: [],
      server_day: [],
      captured_at: [],
      complete: [],
      global: {},
      factions: [],
      truncated: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(series));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchLedgerSeries("dev", { fields: "core" }, "tok", controller.signal);

    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/dev/ledger/series?fields=core");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  });

  it("surfaces a non-OK response as MapAccessError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "range too large" }, 400)));

    const err = await fetchLedgerSeries("dev", { start: "2000-01-01" }, "tok").catch((caught: unknown) => caught);

    expect(err).toBeInstanceOf(MapAccessError);
    expect((err as MapAccessError).status).toBe(400);
    expect((err as MapAccessError).detail).toBe("range too large");
  });

  it("fetchLedgerFaction hits the per-faction route", async () => {
    const detail = {
      key: "k1",
      id: "f1",
      founded_at: "2026-01-01T00:00:00Z",
      name: "Testia",
      rgb: "10,20,30",
      series: {},
      rank: [],
      tier: [],
      breakdowns: { wealth: {}, prestige: {} },
      days: [],
      server_day: [],
      captured_at: [],
      complete: [],
      overlord: [],
      subjects: [],
      wars: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detail));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLedgerFaction("dev", "k1", {}, "tok")).resolves.toEqual(detail);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/dev/ledger/faction/k1");
  });
});
