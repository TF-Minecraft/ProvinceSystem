/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TileManifest } from "@/app/lib/map/tilePyramid";
import MapCanvas from "./MapCanvas";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), displayScale: 1 }));
vi.mock("@/lib/map/api", async (original) => ({
  ...await original<typeof import("@/lib/map/api")>(), fetchMapJson: mocks.fetch,
}));
vi.mock("../../hooks/useMapAssetUrl", () => ({
  useMapAssetUrl: (_map: string, path: string, _token: string, enabled: boolean) => ({ url: enabled ? path : null }),
}));
vi.mock("../../hooks/useMapViewport", () => ({
  useMapViewport: () => ({
    displayScale: mocks.displayScale, translateX: 0, translateY: 0, viewportSize: { w: 512, h: 512 },
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
  mocks.displayScale = 1;
  // Ready manifests are deliberately cached for a page view.
  props.mapId = `test-map-${++mapNumber}`;
  vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
describe("MapCanvas selection", () => {
  /** The loads `useImageLoaded` starts, finished by hand. */
  class FakeImage {
    static made: FakeImage[] = [];
    crossOrigin = "";
    src = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { FakeImage.made.push(this); }
  }
  beforeEach(() => {
    FakeImage.made = [];
    vi.stubGlobal("Image", FakeImage);
    mocks.fetch.mockResolvedValue(manifest);
  });
  const bbox = { x: 0, y: 0, w: 256, h: 256 };
  function view(realm: string) {
    const shape = `/${props.mapId}/regions/nation/${realm}`;
    return (
      <MapCanvas
        {...props}
        mapType="nation"
        selectedOverlay={{ url: `${shape}_hover`, overlay: bbox }}
        focus={{ shapePath: shape, overlay: bbox, objects: [], lit: true }}
      />
    );
  }
  function loadShape(src: string, failed = false) {
    act(() => FakeImage.made
      .filter((image) => image.src === src)
      .forEach((image) => (failed ? image.onerror : image.onload)?.()));
  }
  // The realm colours under the selection: muted once its highlight is ready.
  const colours = (container: HTMLElement) => container.querySelector<HTMLElement>("div.duration-200")!.style.opacity;
  const selected = (container: HTMLElement) => container.querySelector<HTMLImageElement>('img[alt="Selected region"]')!;

  it("keeps the selection lit and the rest muted while a zoom loads another copy", async () => {
    const { container, rerender } = render(view("realm"));
    await act(async () => {});
    const shape = `/${props.mapId}/regions/nation/realm`;
    loadShape(shape);
    fireEvent.load(selected(container));
    expect(colours(container)).toBe("0.3");
    const lit = selected(container);
    expect(lit.style.opacity).toBe("0.88");

    // Zoomed out to the next reduction, whose copy has not loaded yet.
    mocks.displayScale = 0.5;
    rerender(view("realm"));
    expect(selected(container)).toBe(lit);
    expect(lit.getAttribute("src")).toBe(`${shape}?lod=1`);
    expect(lit.style.opacity).toBe("0.88");
    expect(colours(container)).toBe("0.3");

    // Another realm still waits for its own copy.
    rerender(view("other"));
    expect(selected(container)).not.toBe(lit);
    expect(colours(container)).toBe("0.88");
    loadShape(`/${props.mapId}/regions/nation/other?lod=1`);
    expect(colours(container)).toBe("0.3");
  });

  it("waits again for a realm selected anew, even one loaded before", async () => {
    const { container, rerender } = render(view("realm"));
    await act(async () => {});
    loadShape(`/${props.mapId}/regions/nation/realm`);
    fireEvent.load(selected(container));
    expect(colours(container)).toBe("0.3");

    rerender(view("other"));
    rerender(view("realm"));
    expect(colours(container)).toBe("0.88");
    expect(selected(container).style.opacity).not.toBe("0.88");
  });

  it("brings the colours back when the next reduction fails to load", async () => {
    const { container, rerender } = render(view("realm"));
    await act(async () => {});
    loadShape(`/${props.mapId}/regions/nation/realm`);
    fireEvent.load(selected(container));

    mocks.displayScale = 0.5;
    rerender(view("realm"));
    loadShape(`/${props.mapId}/regions/nation/realm?lod=1`, true);
    fireEvent.error(selected(container));
    expect(colours(container)).toBe("0.88");
  });

  it("settles when the highlight is already loaded from the cache", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(256);
    const { container } = render(view("realm"));
    await act(async () => {});
    expect(selected(container).style.opacity).toBe("0.88");
  });
});
