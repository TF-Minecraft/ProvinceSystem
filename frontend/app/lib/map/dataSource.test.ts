import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MapAccessError } from "@/lib/map/api";
import type { MapMode } from "@/app/components/map/types";

import {
  CHRONICLE_MODE_SOURCE,
  MapModeNotCapturedError,
  fetchGuildNameCache,
  fetchMapModeRegionData,
  fetchMapMarkersForDay,
  filterMapModeRegions,
  isMapModeNotCaptured,
  mapGuildsDataSource,
  mapMarkersDataSource,
  mapModeDataSource,
} from "./dataSource";

const ALL_MODES: MapMode[] = [
  "nation",
  "county",
  "duchy",
  "kingdom",
  "empire",
  "trade",
  "prosperity",
  "terrain",
  "fertility",
  "province",
  "infestation",
];

/** Region modes read out of a stored day's capture. */
const DAY_REGION_MODES: MapMode[] = [
  "nation",
  "trade",
  "empire",
  "county",
  "duchy",
  "kingdom",
];

/**
 * Modes whose live source is also their historical answer: province geometry
 * that does not change day to day.
 */
const STATIC_MODES: MapMode[] = ["terrain", "fertility", "province"];

/**
 * The two that vary per day but are *not* region records: they are per-province
 * measurement lists, painted through `CHRONICLE_PROVINCE_PAINT_SOURCE` instead.
 */
const RASTER_DAY_MODES: MapMode[] = ["prosperity", "infestation"];

function gzipResponse(body: string): Response {
  const gz = gzipSync(Buffer.from(body, "utf-8"));
  return new Response(
    gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer,
    { status: 200, headers: { "Content-Type": "application/gzip" } }
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("map data source routing", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps exactly the day-varying region modes to a captured file", () => {
    expect(CHRONICLE_MODE_SOURCE).toEqual({
      nation: "nation",
      trade: "trade",
      empire: "empire",
      county: "county",
      duchy: "duchy",
      kingdom: "kingdom",
    });
  });

  it("keeps the live path byte-for-byte what useMapModeData built", () => {
    // The whole no-regression constraint in one assertion: with no day, every
    // mode resolves to the exact string the hook has always fetched.
    for (const mode of ALL_MODES) {
      expect(mapModeDataSource("main", mode, null)).toEqual({
        kind: "live",
        path: `/main/data/${mode}`,
      });
      expect(mapModeDataSource("dev", mode, null)).toEqual({
        kind: "live",
        path: `/dev/data/${mode}`,
      });
    }
  });

  it("routes every day-varying region mode to its day file", () => {
    for (const mode of DAY_REGION_MODES) {
      expect(mapModeDataSource("dev", mode, "2026-08-31")).toEqual({
        kind: "day",
        day: "2026-08-31",
        file: mode,
      });
    }
  });

  it("serves the static modes live under a stored day, on the live path", () => {
    // Terrain, fertility and province outline are geometry, which does not
    // vary by day, so the live source *is* the historical answer.
    for (const mode of STATIC_MODES) {
      expect(mapModeDataSource("dev", mode, "2026-08-31")).toEqual({
        kind: "live",
        path: `/dev/data/${mode}`,
      });
    }
  });

  it("reports the raster day modes as unavailable here, never as live", () => {
    // They are answered per day, just not as region records — the day page
    // paints them from `CHRONICLE_PROVINCE_PAINT_SOURCE`. What matters for this
    // module is that neither ever falls through to the live endpoint.
    for (const mode of RASTER_DAY_MODES) {
      expect(mapModeDataSource("dev", mode, "2026-08-31")).toEqual({
        kind: "unavailable",
        day: "2026-08-31",
        mapType: mode,
      });
    }
  });

  it("accounts for every map mode exactly once", () => {
    expect(
      [...DAY_REGION_MODES, ...STATIC_MODES, ...RASTER_DAY_MODES].sort()
    ).toEqual([...ALL_MODES].sort());
  });
});

describe("fetchMapModeRegionData", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the live endpoint unchanged when there is no day", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ A: { rgb: "1,2,3", provinces: [1] } }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await fetchMapModeRegionData({
      mapId: "main",
      mapType: "nation",
      day: null,
      sessionToken: "tok",
    });

    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/main/data/nation");
    expect(data).toEqual({ A: { rgb: "1,2,3", provinces: [1] } });
  });

  it("fetches the gzipped day file for a captured mode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(gzipResponse(JSON.stringify({ A: { rgb: "1,2,3" } })));
    vi.stubGlobal("fetch", fetchMock);

    const data = await fetchMapModeRegionData({
      mapId: "dev",
      mapType: "trade",
      day: "2026-08-31",
      sessionToken: "tok",
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/dev/chronicle/2026-08-31/data/trade"
    );
    expect(data).toEqual({ A: { rgb: "1,2,3" } });
  });

  it("encodes the day before it reaches the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(gzipResponse("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchMapModeRegionData({
      mapId: "dev",
      mapType: "nation",
      day: "../../secrets",
      sessionToken: "tok",
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/dev/chronicle/..%2F..%2Fsecrets/data/nation"
    );
  });

  it("throws MapModeNotCapturedError and never touches the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const mode of RASTER_DAY_MODES) {
      const err = await fetchMapModeRegionData({
        mapId: "dev",
        mapType: mode,
        day: "2026-08-31",
      }).catch((e: unknown) => e);

      expect(isMapModeNotCaptured(err)).toBe(true);
      expect((err as MapModeNotCapturedError).mapType).toBe(mode);
      expect((err as MapModeNotCapturedError).day).toBe("2026-08-31");
    }

    // The product rule: no silent fallback to the live endpoint. If this ever
    // fires, a historical date is showing today's map.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not let a __proto__ key in a day file poison the result", async () => {
    // A realm id of `__proto__` on a plain `{}` target hits
    // Object.prototype's setter: the realm vanishes from labels while still
    // being painted, and the object answers truthily for keys it lacks.
    const payload = '{"__proto__":{"rgb":"9,9,9"},"A":{"rgb":"1,2,3"}}';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gzipResponse(payload)));

    const data = await fetchMapModeRegionData({
      mapId: "dev",
      mapType: "nation",
      day: "2026-08-31",
    });

    expect(Object.getPrototypeOf(data)).toBeNull();
    expect(Object.keys(data).sort()).toEqual(["A", "__proto__"]);
    expect(data["__proto__"]).toEqual({ rgb: "9,9,9" });
    // Nothing leaked onto the global prototype.
    expect(({} as Record<string, unknown>).rgb).toBeUndefined();
    // And an absent key is absent, not inherited.
    expect(data["toString"]).toBeUndefined();
  });

  it("rejects a day payload that is not a region object", async () => {
    for (const payload of ["[1,2,3]", '"nope"', "null", "42"]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gzipResponse(payload)));
      const err = await fetchMapModeRegionData({
        mapId: "dev",
        mapType: "nation",
        day: "2026-08-31",
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(isMapModeNotCaptured(err)).toBe(false);
    }
  });

  it("passes a 403 through untouched so the access gate still fires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ detail: "Staff map access required" }, 403)
      )
    );

    const err = await fetchMapModeRegionData({
      mapId: "dev",
      mapType: "nation",
      day: null,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MapAccessError);
    expect((err as MapAccessError).status).toBe(403);
  });
});

describe("filterMapModeRegions", () => {
  it("keeps the live map's rule: rgb always, provinces for nation", () => {
    const raw = {
      OK: { rgb: "1,2,3", provinces: [1] },
      NO_RGB: { provinces: [1] },
      EMPTY: { rgb: "1,2,3", provinces: [] },
      NOT_ARRAY: { rgb: "1,2,3", provinces: "1" },
    };

    expect(Object.keys(filterMapModeRegions(raw, "nation"))).toEqual(["OK"]);
    // Non-nation modes keep everything with an rgb, geometry or not.
    expect(Object.keys(filterMapModeRegions(raw, "trade")).sort()).toEqual([
      "EMPTY",
      "NOT_ARRAY",
      "OK",
    ]);
  });

  it("returns a null-prototype object", () => {
    const out = filterMapModeRegions({ A: { rgb: "1,2,3" } }, "county");
    expect(Object.getPrototypeOf(out)).toBeNull();
  });

  it("survives a null or non-object region entry", () => {
    const raw = { A: null, B: undefined, C: 7, D: { rgb: "1,2,3" } } as Record<
      string,
      any
    >;
    expect(Object.keys(filterMapModeRegions(raw, "county"))).toEqual(["D"]);
  });
});

describe("markers and guilds day scoping", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the live markers path and adds an encoded day path", () => {
    expect(mapMarkersDataSource("main", null)).toEqual({
      kind: "live",
      path: "/main/data/markers",
    });
    expect(mapMarkersDataSource("dev", "2026-08-31")).toEqual({
      kind: "day",
      day: "2026-08-31",
      path: "/dev/chronicle/2026-08-31/markers",
    });
  });

  it("fetchMapMarkersForDay hits the live route when day is null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ forts: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchMapMarkersForDay({ mapId: "main", day: null });

    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/main/data/markers");
  });

  it("fetchMapMarkersForDay hits the stored day route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ settlements: [], forts: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await fetchMapMarkersForDay({
      mapId: "dev",
      day: "2026-08-31",
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/dev/chronicle/2026-08-31/markers"
    );
    expect(data).toEqual({ settlements: [], forts: [] });
  });

  it("rejects a stored markers payload that is not an object", async () => {
    // `useMapMarkers` reaches straight into `.settlements`; a stored `null`
    // would throw during render, and with no error boundary under `app/` that
    // blanks the page rather than one layer.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchMapMarkersForDay({ mapId: "main", day: "2026-08-31" })
    ).rejects.toThrow(/not a markers object/);
  });

  it("day-scopes the guild cache to the captured trade file", () => {
    expect(mapGuildsDataSource("main", null)).toEqual({
      kind: "live",
      path: "/main/data/trade",
    });
    expect(mapGuildsDataSource("dev", "2026-08-31")).toEqual({
      kind: "day",
      day: "2026-08-31",
      file: "trade",
      path: "/dev/chronicle/2026-08-31/data/trade",
    });
  });

  it("builds guild names on a null prototype and falls back to the id", async () => {
    const payload =
      '{"__proto__":{"name":"evil"},"G1":{"name":"Hansa"},"G2":{},"G3":{"name":7}}';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gzipResponse(payload)));

    const names = await fetchGuildNameCache({ mapId: "dev", day: "2026-08-31" });

    expect(Object.getPrototypeOf(names)).toBeNull();
    expect(names["G1"]).toBe("Hansa");
    expect(names["G2"]).toBe("G2");
    // A non-string name must not reach a tooltip.
    expect(names["G3"]).toBe("G3");
    // A hover for an unknown id must be undefined, not `Object`'s method.
    expect(names["constructor"]).toBeUndefined();
  });

  it("returns an empty cache rather than throwing on a non-object payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gzipResponse("[]")));

    await expect(
      fetchGuildNameCache({ mapId: "dev", day: "2026-08-31" })
    ).resolves.toEqual({});
  });
});
