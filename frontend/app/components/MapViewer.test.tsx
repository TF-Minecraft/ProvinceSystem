/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapEngineProvider } from "../core/MapEngineContext";
import type MapCanvas from "./map/MapCanvas";
import MapViewer from "./MapViewer";

const mocks = vi.hoisted(() => ({
  hover: vi.fn(),
  mode: { loading: true, regionData: null as Record<string, unknown> | null },
}));
vi.mock("../hooks/useMapGeometry", () => ({
  useMapGeometry: () => ({ ready: false, neighbors: null, labelNeighbors: null, centroids: null, labelGrid: null }),
}));
vi.mock("../hooks/useMapModeData", () => ({ useMapModeData: () => mocks.mode }));
vi.mock("../hooks/useAccessibleMaps", () => ({ useAccessibleMaps: () => ({ maps: [] }) }));
vi.mock("../hooks/useMapHover", () => ({
  useMapHover: (props: unknown) => {
    mocks.hover(props);
    return { onMouseMove: vi.fn(), onMouseLeave: vi.fn(), pickRegionAtEvent: vi.fn(), pickMarkerAtEvent: vi.fn() };
  },
}));
vi.mock("./map/MapCanvas", () => ({
  default: function Canvas({ canvasRef }: ComponentProps<typeof MapCanvas>) {
    useLayoutEffect(() => {
      canvasRef.current = document.createElement("canvas");
      return () => { canvasRef.current = null; };
    }, [canvasRef]);
    return <div data-testid="terrain" />;
  },
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://map.test");
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  mocks.mode = { loading: true, regionData: null };
  mocks.hover.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function viewer(mapId = "main") {
  return <MapEngineProvider><MapViewer mapId={mapId} /></MapEngineProvider>;
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
    const bitmap = { width: 512, height: 512, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    render(viewer());
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(true);
    await act(async () => finishFetch(new Response()));
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(true);
    // Two 256-row bands, each yielding before the canvas can be read.
    await act(async () => frames.shift()!(0));
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(true);
    await act(async () => frames.shift()!(16));
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(false);
    expect(bitmap.close).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: /Layers/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Counties" }));
    expect(mocks.hover.mock.lastCall?.[0].loading).toBe(true);
  });
});
