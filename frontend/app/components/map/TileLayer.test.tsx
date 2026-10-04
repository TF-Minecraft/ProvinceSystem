/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TileManifest, TileView } from "@/app/lib/map/tilePyramid";

import TileLayer from "./TileLayer";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

/** Let loaded sharp tiles finish fading in (needs fake timers). */
function fadeIn() {
  act(() => {
    vi.advanceTimersByTime(1000);
  });
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

  it("counts a tile as loaded once it has decoded, at full size", async () => {
    const pending: (() => void)[] = [];
    const decode = vi.fn(() => new Promise<void>((resolve) => pending.push(resolve)));
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: decode,
    });
    try {
      const onReady = vi.fn();
      const { container } = render(
        <TileLayer manifest={manifest("v1")} tileUrl={tileUrl} view={view} onReady={onReady} />
      );
      // An async image is decoded only at the size it is drawn; WebKit drew
      // nothing while a settled zoom needed it at another size.
      container
        .querySelectorAll("img")
        .forEach((img) => expect(img.getAttribute("decoding")).toBe("sync"));

      loadAll(container);
      expect(decode).toHaveBeenCalledTimes(4);
      expect(onReady).not.toHaveBeenCalled();

      // Ready with the last decode, not before it.
      await act(async () => pending.slice(0, -1).forEach((resolve) => resolve()));
      expect(onReady).not.toHaveBeenCalled();
      await act(async () => pending.at(-1)!());
      expect(onReady).toHaveBeenCalled();
    } finally {
      delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
    }
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
    vi.useFakeTimers();
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
    // Loaded, the sharp tiles start fading in: until they have, nothing under
    // them may go, or they show see-through over black.
    expect(clip()).toBe("");
    fadeIn();

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
  it("waits for new elements when zooming back to a level seen before", () => {
    vi.useFakeTimers();
    // 4096 px map: backdrop level 0 (4x4 tiles), then levels 1 and 2.
    const pyramid: TileManifest = {
      ready: true,
      version: "v1",
      width: 4096,
      height: 4096,
      tile_size: 256,
      max_level: 2,
      levels: [
        { width: 1024, height: 1024 },
        { width: 2048, height: 2048 },
        { width: 4096, height: 4096 },
      ],
    };
    const at = (displayScale: number): TileView => ({
      displayScale,
      translateX: 0,
      translateY: 0,
      viewportW: 200,
      viewportH: 200,
    });
    const imgs = (level: number) => [
      ...container.querySelectorAll<HTMLImageElement>(`img[src^="/t/${level}/"]`),
    ];
    const { container, rerender } = render(
      <TileLayer manifest={pyramid} tileUrl={tileUrl} view={at(0.5)} />
    );
    loadAll(container);
    fadeIn();
    rerender(<TileLayer manifest={pyramid} tileUrl={tileUrl} view={at(1)} />);
    loadAll(container);
    fadeIn();
    // Level 2 settled; level 1 is no longer held.
    expect(imgs(1)).toHaveLength(0);

    // Back to level 1: its tiles loaded once, but these are new elements, so
    // level 2 stays up under them and the backdrop is not cut away yet.
    rerender(<TileLayer manifest={pyramid} tileUrl={tileUrl} view={at(0.5)} />);
    expect(imgs(1).length).toBeGreaterThan(0);
    expect(imgs(1).every((img) => img.style.opacity === "0")).toBe(true);
    expect(imgs(2).length).toBeGreaterThan(0);
    expect(imgs(2).some((img) => img.style.visibility === "hidden")).toBe(false);
    expect(imgs(0)[0].parentElement!.style.clipPath).toBe("");

    loadAll(container);
    expect(imgs(1).every((img) => img.style.opacity === "1")).toBe(true);
    // Fading in: level 2 and the backdrop stay up under them until it is done.
    expect(imgs(2).some((img) => img.style.visibility === "hidden")).toBe(false);
    expect(imgs(0)[0].parentElement!.style.clipPath).toBe("");
    fadeIn();
    expect(imgs(0)[0].parentElement!.style.clipPath).not.toBe("");
  });
});
