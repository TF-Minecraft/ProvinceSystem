/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TileManifest, TileView } from "@/app/lib/map/tilePyramid";

import TileLayer from "./TileLayer";

afterEach(cleanup);

/** One 512 px level of four 256 px tiles: the backdrop is the whole pyramid. */
function manifest(version: string): TileManifest {
  return {
    ready: true,
    version,
    width: 512,
    height: 512,
    tile_size: 256,
    max_level: 0,
    levels: [{ width: 512, height: 512 }],
  };
}

const view: TileView = {
  displayScale: 1,
  translateX: 0,
  translateY: 0,
  viewportW: 512,
  viewportH: 512,
};

const tileUrl = (level: number, x: number, y: number) => `/t/${level}/${x}/${y}.webp`;

function loadAll(container: HTMLElement) {
  container.querySelectorAll("img").forEach((img) => fireEvent.load(img));
}

/**
 * Fires every tile's `load` while the layer's commit is still running, before
 * its effects have: what WebKit does with tiles it already has cached.
 */
function LoadedBeforeEffects({ onReady }: { onReady: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Not fireEvent: that would nest an act() inside render's.
    ref.current!.querySelectorAll("img").forEach((img) => img.dispatchEvent(new Event("load")));
  }, []);
  return (
    <div ref={ref}>
      <TileLayer manifest={manifest("v1")} tileUrl={tileUrl} view={view} onReady={onReady} />
    </div>
  );
}

describe("TileLayer", () => {
  it("is ready once every backdrop tile has loaded", () => {
    const onReady = vi.fn();
    const { container } = render(
      <TileLayer manifest={manifest("v1")} tileUrl={tileUrl} view={view} onReady={onReady} />
    );
    expect(container.querySelectorAll("img")).toHaveLength(4);
    expect(onReady).not.toHaveBeenCalled();

    loadAll(container);

    expect(onReady).toHaveBeenCalled();
  });

  it("counts tiles that loaded before its effects ran", () => {
    const onReady = vi.fn();
    render(<LoadedBeforeEffects onReady={onReady} />);

    expect(onReady).toHaveBeenCalled();
  });

  it("waits for a new version's tiles, not the old version's", () => {
    const onReady = vi.fn();
    const { container, rerender } = render(
      <TileLayer manifest={manifest("v1")} tileUrl={tileUrl} view={view} onReady={onReady} />
    );
    loadAll(container);
    onReady.mockClear();

    rerender(
      <TileLayer manifest={manifest("v2")} tileUrl={tileUrl} view={view} onReady={onReady} />
    );
    expect(onReady).not.toHaveBeenCalled();

    loadAll(container);
    expect(onReady).toHaveBeenCalled();
  });

  it("keeps the backdrop up outside the sharp tiles once they load", () => {
    // 2048 px map: backdrop level 0 (4x4 tiles), sharp level 1 (8x8 tiles).
    const pyramid: TileManifest = {
      ready: true,
      version: "v1",
      width: 2048,
      height: 2048,
      tile_size: 256,
      max_level: 1,
      levels: [
        { width: 1024, height: 1024 },
        { width: 2048, height: 2048 },
      ],
    };
    // One sharp tile on screen; with the margin, the sharp tiles cover the
    // top-left 512 px square, which is backdrop tile 0/0.
    const zoomedIn: TileView = {
      displayScale: 1,
      translateX: 0,
      translateY: 0,
      viewportW: 200,
      viewportH: 200,
    };
    const { container, rerender } = render(
      <TileLayer manifest={pyramid} tileUrl={tileUrl} view={zoomedIn} />
    );
    const backdrop = () =>
      [...container.querySelectorAll<HTMLImageElement>('img[src^="/t/0/"]')].filter(
        (img) => img.style.visibility !== "hidden"
      );
    const before = backdrop();
    expect(before).toHaveLength(16);
    const clip = () => before[0].parentElement!.style.clipPath;
    // The same elements, not equal-looking new ones.
    const sameBackdrop = () =>
      backdrop().length === before.length && backdrop().every((img, i) => img === before[i]);
    expect(clip()).toBe("");

    loadAll(container);

    // A gesture scales the layer without a render: past the sharp tiles the
    // backdrop must still be there, and only there. It is clipped, not
    // remounted: a new <img> paints nothing on iOS until it has decoded.
    expect(sameBackdrop()).toBe(true);
    expect(clip()).toBe(
      "polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, " +
        "0% 0%, 0% 25%, 25% 25%, 25% 0%, 0% 0%, 0% 0%)"
    );

    // Zooming out to the backdrop level holds the sharp tiles until it has
    // loaded, on the same elements.
    const sharp = container.querySelector('img[src="/t/1/0/0.webp"]');
    rerender(
      <TileLayer
        manifest={pyramid}
        tileUrl={tileUrl}
        view={{ ...zoomedIn, displayScale: 0.25 }}
      />
    );
    expect(container.querySelector('img[src="/t/1/0/0.webp"]')).toBe(sharp);
    expect(sameBackdrop()).toBe(true);
    expect(clip()).toBe("");
  });
});
