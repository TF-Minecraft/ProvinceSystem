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
});
