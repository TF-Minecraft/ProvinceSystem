/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapEngineProvider } from "../core/MapEngineContext";
import MapViewer from "./MapViewer";
import type { ProvinceIdGrid } from "../lib/map/chroniclePaint";

const mocks = vi.hoisted(() => ({
  hover: vi.fn(),
  grid: vi.fn(),
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
  ...await original<typeof import("@/app/lib/map/chronicleData")>(),
  fetchProvinceIdGridQ4: mocks.grid,
}));
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
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  } as unknown as CanvasRenderingContext2D);
  mocks.mode = { loading: true, regionData: null };
  mocks.hover.mockClear();
  mocks.grid.mockReset();
  mocks.token = null;
  mocks.maps = [];
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function viewer(mapId = "main", day: string | null = null) {
  return <MapEngineProvider><MapViewer mapId={mapId} day={day} /></MapEngineProvider>;
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

  it("holds picking until the final image band is copied even if metadata is ready", async () => {
    mocks.mode = { loading: false, regionData: {} };
    let finishFetch!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation((url) => new Promise((resolve) => {
      if (String(url).endsWith("/mapdata/nation")) finishFetch = resolve;
    }));
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 5));
    const bitmap = { width: 512, height: 512, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    render(viewer());
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(true);
    await act(async () => finishFetch(new Response()));
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(true);
    // 64-row bands, each "taking" 5 ms against an 8 ms frame budget: the
    // 512-row map is read over four frames and only then can be picked.
    for (let frame = 0; frame < 3; frame++) {
      await act(async () => frames.shift()!(frame * 16));
      expect(mocks.hover.mock.lastCall?.[0].loading).toBe(true);
    }
    await act(async () => frames.shift()!(48));
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(false);
    expect(mocks.hover.mock.lastCall?.[0].pickSurfaceRef.current).toMatchObject({ width: 512, height: 512 });
    expect(bitmap.close).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Layers" })[0]);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Map layers" })).getByRole("button", { name: "Counties" }));
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(true);
    // The last mode's regions are gone, not merely gated.
    expect(mocks.hover.mock.lastCall?.[0].pickSurfaceRef.current).toBeNull();
  });
});


describe("chronicle pick grids", () => {
  it.each(["map", "token"])("waits for matching geometry after a %s change, including a failed request", async (change) => {
    mocks.mode = { loading: false, regionData: {} };
    mocks.maps = [{ id: "main", display_name: "Main", public: false }, { id: "dev", display_name: "Dev", public: false }];
    mocks.token = "first-token";
    vi.mocked(fetch).mockImplementation(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    const oldGrid: ProvinceIdGrid = { width: 1, height: 1, ids: new Uint16Array([1]) };
    let rejectGrid!: (error: Error) => void;
    mocks.grid.mockResolvedValueOnce(oldGrid).mockReturnValueOnce(new Promise((_, reject) => { rejectGrid = reject; }));
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
  });
});
