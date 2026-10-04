/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TileManifest } from "@/app/lib/map/tilePyramid";
import MapCanvas from "./MapCanvas";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/map/api", async (original) => ({
  ...await original<typeof import("@/lib/map/api")>(), fetchMapJson: mocks.fetch,
}));
vi.mock("../../hooks/useMapAssetUrl", () => ({
  useMapAssetUrl: (_map: string, path: string, _token: string, enabled: boolean) => ({ url: enabled ? path : null }),
}));
vi.mock("../../hooks/useMapViewport", () => ({
  useMapViewport: () => ({
    displayScale: 1, translateX: 0, translateY: 0, viewportSize: { w: 512, h: 512 },
    viewportRef: { current: null }, contentRef: { current: null }, zoom: 1,
    resetViewport: vi.fn(),
  }),
}));
const manifest: TileManifest = {
  ready: true, version: "v1", width: 512, height: 512, tile_size: 256,
  max_level: 0, levels: [{ width: 512, height: 512 }],
};
const props = {
  mapId: "main", mapType: "terrain" as const, canvasRef: createRef<HTMLCanvasElement>(),
  mapObjects: [], hoveredOverlay: null, cursorTooltip: null,
  onMouseMove: vi.fn(), onMouseLeave: vi.fn(), onClick: vi.fn(),
};
let mapNumber = 0;
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://map.test");
  mocks.fetch.mockReset();
  // Ready manifests are deliberately cached for a page view.
  props.mapId = `test-map-${++mapNumber}`;
  vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });
function images(container: HTMLElement) {
  return [...container.querySelectorAll("img")].map((image) => image.getAttribute("src"));
}
describe("MapCanvas tile loading", () => {
  it("shows only the preview until manifests answer, then loads tiles without full images", async () => {
    let resolve!: (value: TileManifest) => void;
    const pending = new Promise<TileManifest>((done) => { resolve = done; });
    mocks.fetch.mockReturnValue(pending);
    const { container } = render(<MapCanvas {...props} />);
    expect(images(container)).toEqual([expect.stringContaining(`/${props.mapId}/map/preview`)]);
    await act(async () => resolve(manifest));
    expect(images(container)).toEqual(expect.arrayContaining([expect.stringContaining("/tiles/base/v1/")]));
    expect(images(container)).not.toContain(`/${props.mapId}/map`);
    expect(images(container)).not.toContain(`/${props.mapId}/mapdata/terrain`);
  });
  it.each(["building", "unavailable"])("keeps full-image fallback when tiles are %s", async (status) => {
    if (status === "building") mocks.fetch.mockResolvedValue({ ready: false });
    else mocks.fetch.mockRejectedValue(new Error("no tiles"));
    const { container } = render(<MapCanvas {...props} />);
    await act(async () => {});
    expect(images(container)).toContain(`/${props.mapId}/map`);
    expect(images(container)).toContain(`/${props.mapId}/mapdata/terrain`);
  });
  it("keeps authenticated maps on full images without requesting manifests", () => {
    // Before effects run, a disabled manifest must already be unavailable:
    // otherwise the first render would leak a public preview request.
    expect(renderToStaticMarkup(<MapCanvas {...props} sessionToken="staff-token" />)).not.toContain("Map preview");
    const { container } = render(<MapCanvas {...props} sessionToken="staff-token" />);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(images(container)).toContain(`/${props.mapId}/map`);
    expect(images(container)).toContain(`/${props.mapId}/mapdata/terrain`);
  });
  it("does not fetch unopened modes after the old prefetch delay", async () => {
    mocks.fetch.mockResolvedValue(manifest);
    render(<MapCanvas {...props} />);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(10000));
    expect(mocks.fetch.mock.calls.map(([path]) => path)).toEqual([
      `/${props.mapId}/tiles/base/manifest`, `/${props.mapId}/tiles/mapdata-terrain/manifest`,
    ]);
  });
});
