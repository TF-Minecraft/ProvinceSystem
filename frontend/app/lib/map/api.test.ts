import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MapAccessError,
  STAFF_MAP_ACCESS_DETAIL,
  STAFF_MAP_PERMISSION_DETAIL,
  fetchAccessibleMaps,
  fetchMapApi,
  fetchMapJson,
  fetchMapMarkers,
  isAbortError,
  mapRequiresAuth,
  postEditorTitles,
  staffMapAccessReason,
} from "@/lib/map/api";

describe("map api", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetchMapApi attaches Bearer when session token provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchMapApi("/dev/data/nation", { sessionToken: "abc-token" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/dev/data/nation",
      expect.objectContaining({
        headers: { Authorization: "Bearer abc-token" },
        cache: "no-cache",
      })
    );
  });

  it.each([
    "/main/data/province_centroids",
    "/main/data/province_id_runs",
    "/main/data/province_id_grid_q4",
    "/main/map/preview",
    "/main/mapdata/nation?scale=1",
    "/main/tiles/base/version/0/0/0.webp",
  ])("lets server freshness apply to %s", async (path) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await fetchMapApi(path);
    expect(fetchMock.mock.calls[0][1].cache).toBe("default");
    await fetchMapApi(path, { cache: "reload" });
    expect(fetchMock.mock.calls[1][1].cache).toBe("reload");
  });

  it.each([
    "/maps/accessible",
    "/main/editor/province-runs",
    "/main/data/nation",
    "/main/tiles/base/manifest",
  ])("continues to revalidate %s", async (path) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await fetchMapApi(path);
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-cache");
  });

  it("fetchMapApi re-throws an abort instead of masking it as a failure", async () => {
    // A user who pressed Cancel was being shown "Request failed. Please try
    // again." The chronicle build compensated by re-checking `signal.aborted`;
    // any other caller would report a deliberate cancel as a transport error.
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    const err = await fetchMapApi("/dev/data/nation", {
      signal: new AbortController().signal,
    }).catch((e: unknown) => e);

    expect(err).toBe(abort);
    expect(err).not.toBeInstanceOf(MapAccessError);
    expect(isAbortError(err)).toBe(true);
  });

  it("fetchMapApi still masks a genuine transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    const err = await fetchMapApi("/dev/data/nation").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MapAccessError);
    expect((err as MapAccessError).status).toBe(0);
    expect((err as MapAccessError).message).toBe(
      "Request failed. Please try again."
    );
    expect(isAbortError(err)).toBe(false);
  });

  it("fetchMapMarkers requests markers endpoint with session token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ map_id: "main", exported_at: null, settlements: [] }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchMapMarkers("main", "token-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/main/data/markers",
      expect.objectContaining({
        headers: { Authorization: "Bearer token-1" },
        cache: "no-cache",
      })
    );
  });

  it("fetchMapJson throws MapAccessError with detail on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: STAFF_MAP_PERMISSION_DETAIL }), {
          status: 403,
        })
      )
    );

    await expect(fetchMapJson("/dev/data/nation")).rejects.toMatchObject({
      name: "MapAccessError",
      status: 403,
      detail: STAFF_MAP_PERMISSION_DETAIL,
    } satisfies Partial<MapAccessError>);
  });

  it("fetchAccessibleMaps returns maps payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            maps: [
              {
                id: "main",
                display_name: "Adavaar",
                public: true,
                archived: false,
              },
            ],
          }),
          { status: 200 }
        )
      )
    );

    const data = await fetchAccessibleMaps();
    expect(data.maps).toHaveLength(1);
    expect(data.maps[0].id).toBe("main");
  });

  it("staffMapAccessReason maps backend detail strings", () => {
    expect(
      staffMapAccessReason(
        new MapAccessError(STAFF_MAP_ACCESS_DETAIL, 403, STAFF_MAP_ACCESS_DETAIL)
      )
    ).toBe("login");
    expect(
      staffMapAccessReason(
        new MapAccessError(
          STAFF_MAP_PERMISSION_DETAIL,
          403,
          STAFF_MAP_PERMISSION_DETAIL
        )
      )
    ).toBe("permission");
    expect(
      staffMapAccessReason(new MapAccessError("Other", 404, "Map not found"))
    ).toBe("unknown");
  });

  it("postEditorTitles sends Bearer and JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, tier: "county", count: 1 }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const body = {
      COUNTY_1: { name: "Test", provinces: [1], rgb: "10,20,30" },
    };
    await postEditorTitles("main", "county", body, "staff-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/main/editor/titles/county",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer staff-token",
        },
      })
    );
  });

  it("mapRequiresAuth uses public from the accessible list when present", () => {
    expect(mapRequiresAuth("main")).toBe(false);
    expect(mapRequiresAuth("calavorn")).toBe(true);
    expect(
      mapRequiresAuth("calavorn", [
        {
          id: "calavorn",
          display_name: "Calavorn",
          public: true,
          archived: true,
        },
      ])
    ).toBe(false);
    expect(
      mapRequiresAuth("dev", [
        {
          id: "dev",
          display_name: "Adavaar",
          public: false,
          archived: false,
        },
      ])
    ).toBe(true);
  });
});
