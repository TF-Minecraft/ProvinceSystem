/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapEngineProvider } from "../core/MapEngineContext";
import MapViewer from "./MapViewer";
import type { ProvinceIdGrid } from "../lib/map/chroniclePaint";

const mocks = vi.hoisted(() => ({
  hover: vi.fn(),
  grid: vi.fn(),
  runs: vi.fn(),
  compiled: vi.fn(),
  token: null as string | null,
  maps: [] as { id: string; display_name: string; public: boolean }[],
  mode: { loading: true, regionData: null as Record<string, unknown> | null },
}));
vi.mock("../hooks/useMapGeometry", () => ({
  useMapGeometry: () => ({ ready: false, neighbors: null, labelNeighbors: null, centroids: null, labelGrid: null }),
}));
vi.mock("../hooks/useMapModeData", () => ({ useMapModeData: () => mocks.mode }));
vi.mock("../hooks/useAccessibleMaps", () => ({ useAccessibleMaps: () => ({ maps: mocks.maps }) }));
vi.mock("../hooks/useCharacterSessionToken", () => ({ useCharacterSessionToken: () => mocks.token }));
vi.mock("@/app/lib/map/chronicleData", async (original) => ({
  ...(await original<typeof import("@/app/lib/map/chronicleData")>()),
  fetchProvinceIdGridQ4: mocks.grid,
}));
vi.mock("@/app/lib/map/provinceRuns", () => ({ fetchProvinceRunIndex: mocks.runs }));
vi.mock("@/app/lib/map/compiledProvinces", () => ({ fetchCompiledProvinces: mocks.compiled }));
vi.mock("../hooks/useMapHover", () => ({
  useMapHover: (props: unknown) => {
    mocks.hover(props);
    return { onMouseMove: vi.fn(), onMouseLeave: vi.fn(), pickRegionAtEvent: vi.fn(), pickMarkerAtEvent: vi.fn() };
  },
}));
vi.mock("./map/MapCanvas", () => ({
  default: function Canvas() {
    return <div data-testid="terrain" />;
  },
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://map.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  } as unknown as CanvasRenderingContext2D);
  mocks.mode = { loading: true, regionData: null };
  mocks.hover.mockClear();
  mocks.grid.mockReset();
  mocks.runs.mockReset();
  mocks.runs.mockImplementation(() => new Promise(() => {}));
  mocks.compiled.mockReset();
  mocks.compiled.mockImplementation(() => new Promise(() => {}));
  mocks.token = null;
  mocks.maps = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function viewer(mapId = "main", day: string | null = null) {
  return (
    <MapEngineProvider>
      <MapViewer mapId={mapId} day={day} />
    </MapEngineProvider>
  );
}

describe("MapViewer terrain and picking readiness", () => {
  it("mounts terrain while geometry and region metadata are still loading", () => {
    render(viewer());
    expect(screen.getByTestId("terrain")).toBeTruthy();
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(true);
  });

  it("does not carry public access across a switch to a protected map", () => {
    const { rerender } = render(viewer());
    expect(screen.getByTestId("terrain")).toBeTruthy();
    rerender(viewer("dev"));
    expect(screen.queryByTestId("terrain")).toBeNull();
  });

  it("live nation picks from province runs and never downloads the nation pick image", async () => {
    mocks.mode = { loading: false, regionData: {} };
    let finishRuns!: (index: unknown) => void;
    mocks.runs.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRuns = resolve;
        }),
    );
    render(viewer());
    // Hover is not held hostage while geometry loads; geographic picking
    // reports not-ready instead.
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(false);
    expect(mocks.hover.mock.lastCall?.[0].provincePickReady).toBe(false);
    expect(mocks.hover.mock.lastCall?.[0].provinceRunIndexRef.current).toBeNull();
    await act(async () => finishRuns({ width: 6400, height: 6400 }));
    expect(mocks.hover.mock.lastCall?.[0].provincePickReady).toBe(true);
    expect(mocks.hover.mock.lastCall?.[0].provinceRunIndexRef.current).toMatchObject({ width: 6400, height: 6400 });
    const fetched = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
    expect(fetched.some((url) => url.includes("/mapdata/nation"))).toBe(false);
  });

  it("shows a retryable banner when province geometry fails to load", async () => {
    mocks.mode = { loading: false, regionData: {} };
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runs.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ width: 6400, height: 6400 });
    render(viewer());
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText(/Picking is unavailable/)).toBeTruthy();
    expect(mocks.hover.mock.lastCall?.[0].provincePickReady).toBe(false);
    await act(async () => fireEvent.click(retry));
    expect(mocks.runs).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Picking is unavailable/)).toBeNull();
    expect(mocks.hover.mock.lastCall?.[0].provincePickReady).toBe(true);
  });

  it("trade membership withholds water provinces until terrains load, then excludes them", async () => {
    mocks.mode = {
      loading: false,
      regionData: { GuildA: { rgb: "1,2,3", name: "GuildA", provinces: [1, 2] } },
    };
    mocks.runs.mockResolvedValue({ width: 6400, height: 6400 });
    mocks.grid.mockImplementation(() => new Promise(() => {}));
    let finishCompiled!: (payload: unknown) => void;
    mocks.compiled.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCompiled = resolve;
        }),
    );
    render(viewer());
    await act(async () => {});
    fireEvent.click(screen.getAllByRole("button", { name: "Layers" })[0]);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Map layers" })).getByRole("button", { name: "Trade" }));
    // Geometry is ready but terrains are not: membership is active-empty, so
    // trade picking misses rather than claiming the water.
    expect(mocks.hover.mock.lastCall?.[0].provinceRegionIndex.size).toBe(0);
    await act(async () => finishCompiled({ 1: { terrain: "plains" }, 2: { terrain: "sea" } }));
    const index = mocks.hover.mock.lastCall?.[0].provinceRegionIndex;
    expect(index.get(1)).toBe("GuildA");
    expect(index.get(2)).toBeUndefined();
    const fetched = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
    expect(fetched.some((url) => url.includes("/mapdata/trade"))).toBe(false);
  });

  it("shows the retryable banner when trade terrains fail to load", async () => {
    mocks.mode = {
      loading: false,
      regionData: { GuildA: { rgb: "1,2,3", name: "GuildA", provinces: [1] } },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runs.mockResolvedValue({ width: 6400, height: 6400 });
    mocks.grid.mockImplementation(() => new Promise(() => {}));
    mocks.compiled.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ 1: { terrain: "plains" } });
    render(viewer());
    await act(async () => {});
    fireEvent.click(screen.getAllByRole("button", { name: "Layers" })[0]);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Map layers" })).getByRole("button", { name: "Trade" }));
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(mocks.hover.mock.lastCall?.[0].provinceRegionIndex.size).toBe(0);
    await act(async () => fireEvent.click(retry));
    expect(screen.queryByText(/Picking is unavailable/)).toBeNull();
    expect(mocks.hover.mock.lastCall?.[0].provinceRegionIndex.get(1)).toBe("GuildA");
  });

  it("county picks by province id without downloading the county pick image", async () => {
    mocks.mode = {
      loading: false,
      regionData: { CountyA: { rgb: "1,2,3", name: "CountyA", provinces: [5, 6] } },
    };
    mocks.runs.mockResolvedValue({ width: 6400, height: 6400 });
    render(viewer());
    await act(async () => {});
    fireEvent.click(screen.getAllByRole("button", { name: "Layers" })[0]);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Map layers" })).getByRole("button", { name: "Counties" }),
    );
    await act(async () => {});
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(false);
    expect(mocks.hover.mock.lastCall?.[0].provinceRegionIndex.get(5)).toBe("CountyA");
    const fetched = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
    expect(fetched.some((url) => url.includes("/mapdata/county"))).toBe(false);
  });

  it("duchy membership follows county titles once the county tier loads", async () => {
    mocks.mode = {
      loading: false,
      regionData: { DuchyA: { rgb: "1,2,3", name: "DuchyA", titles: ["CountyA"] } },
    };
    mocks.runs.mockResolvedValue({ width: 6400, height: 6400 });
    let finishCounty!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      (url) =>
        new Promise((resolve) => {
          if (String(url).endsWith("/data/county")) finishCounty = resolve;
        }),
    );
    render(viewer());
    await act(async () => {});
    fireEvent.click(screen.getAllByRole("button", { name: "Layers" })[0]);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Map layers" })).getByRole("button", { name: "Duchies" }),
    );
    // The county tier has not landed: membership is active-empty.
    expect(mocks.hover.mock.lastCall?.[0].provinceRegionIndex.size).toBe(0);
    await act(async () =>
      finishCounty(new Response(JSON.stringify({ CountyA: { rgb: "9,9,9", provinces: [5, 6] } }), { status: 200 })),
    );
    expect(mocks.hover.mock.lastCall?.[0].provinceRegionIndex.get(6)).toBe("DuchyA");
    const fetched = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
    expect(fetched.some((url) => url.includes("/mapdata/duchy"))).toBe(false);
  });
});

describe("chronicle pick grids", () => {
  it.each(["map", "token"])(
    "waits for matching geometry after a %s change, including a failed request",
    async (change) => {
      mocks.mode = { loading: false, regionData: {} };
      mocks.maps = [
        { id: "main", display_name: "Main", public: false },
        { id: "dev", display_name: "Dev", public: false },
      ];
      mocks.token = "first-token";
      vi.mocked(fetch).mockImplementation(
        async () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
      );
      const oldGrid: ProvinceIdGrid = { width: 1, height: 1, ids: new Uint16Array([1]) };
      let rejectGrid!: (error: Error) => void;
      mocks.grid.mockResolvedValueOnce(oldGrid).mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectGrid = reject;
        }),
      );
      const { rerender } = render(viewer("main", "2026-10-01"));
      await act(async () => {});
      expect(mocks.hover.mock.lastCall?.[0].loading).toBe(false);
      expect(mocks.hover.mock.lastCall?.[0].pickSurfaceRef.current).toMatchObject({ width: 1, height: 1 });
      if (change === "token") mocks.token = "second-token";
      rerender(viewer(change === "map" ? "dev" : "main", "2026-10-01"));
      await act(async () => {});
      expect(mocks.hover.mock.lastCall?.[0].chronicleGrid).toBeNull();
      expect(mocks.hover.mock.lastCall?.[0].loading).toBe(true);
      expect(mocks.hover.mock.lastCall?.[0].pickSurfaceRef.current).toBeNull();
      vi.spyOn(console, "error").mockImplementation(() => {});
      await act(async () => rejectGrid(new Error("offline")));
      expect(mocks.hover.mock.lastCall?.[0].loading).toBe(true);
      expect(mocks.hover.mock.lastCall?.[0].pickSurfaceRef.current).toBeNull();
    },
  );
});
