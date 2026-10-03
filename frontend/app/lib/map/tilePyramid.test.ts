import { describe, expect, it } from "vitest";

import {
  allTiles,
  backdropLevel,
  isTileManifest,
  overlayLod,
  pickTileLevel,
  visibleTiles,
  type TileManifest,
} from "./tilePyramid";

// The live map's shape: 6400 px square, five halvings to one tile.
const manifest: TileManifest = {
  ready: true,
  version: "123",
  width: 6400,
  height: 6400,
  tile_size: 256,
  max_level: 5,
  levels: [
    { width: 200, height: 200 },
    { width: 400, height: 400 },
    { width: 800, height: 800 },
    { width: 1600, height: 1600 },
    { width: 3200, height: 3200 },
    { width: 6400, height: 6400 },
  ],
};

describe("isTileManifest", () => {
  it("accepts a ready manifest and rejects the rest", () => {
    expect(isTileManifest(manifest)).toBe(true);
    expect(isTileManifest({ ready: false })).toBe(false);
    expect(isTileManifest({ ...manifest, levels: [] })).toBe(false);
    expect(isTileManifest(null)).toBe(false);
  });
});

describe("pickTileLevel", () => {
  it("picks the lowest level that is not stretched", () => {
    // Whole map on a 900 px screen: 0.14 screen px per map px, so the
    // 800 px level (0.125) would be stretched and the 1600 px one is used.
    expect(pickTileLevel(manifest, 0.14)).toBe(3);
    expect(pickTileLevel(manifest, 0.125)).toBe(2); // exactly 800/6400
    expect(pickTileLevel(manifest, 0.5)).toBe(4);
  });

  it("accounts for high-density screens", () => {
    expect(pickTileLevel(manifest, 0.14, 2)).toBe(4);
  });

  it("stretches full size once zoomed past it", () => {
    expect(pickTileLevel(manifest, 3)).toBe(5);
  });
});

describe("backdropLevel", () => {
  it("is the sharpest level still a few tiles across", () => {
    // 800 px = 4 tiles across; 1600 px would be 7.
    expect(backdropLevel(manifest)).toBe(2);
    expect(backdropLevel(manifest, 1)).toBe(0);
  });
});

describe("tiles", () => {
  it("places edge tiles at their real size in map pixels", () => {
    const level0 = allTiles(manifest, 0);
    expect(level0).toHaveLength(1);
    expect(level0[0]).toMatchObject({ left: 0, top: 0, width: 6400, height: 6400 });

    // 6400 / 256 = 25 tiles across at full size, the last one whole.
    const top = allTiles(manifest, 5);
    expect(top).toHaveLength(625);
    // 1600 px is 6.25 tiles: the seventh column is a quarter tile wide.
    const edge = allTiles(manifest, 3).find((tile) => tile.x === 6 && tile.y === 0);
    expect(edge).toMatchObject({ left: 6 * 1024, width: 64 * 4 });
  });

  it("only returns tiles on screen, plus a margin", () => {
    // Full-size level, zoomed so 1 screen px = 1 map px, viewing the top-left
    // 1000 x 500 px of the map.
    const view = {
      displayScale: 1,
      translateX: 0,
      translateY: 0,
      viewportW: 1000,
      viewportH: 500,
    };
    const tiles = visibleTiles(manifest, 5, view, 0);
    expect(tiles.map((tile) => tile.x).sort((a, b) => a - b).at(-1)).toBe(3);
    expect(Math.max(...tiles.map((tile) => tile.y))).toBe(1);
    expect(tiles).toHaveLength(4 * 2);

    const withMargin = visibleTiles(manifest, 5, view, 1);
    expect(withMargin).toHaveLength(5 * 3);
  });

  it("follows the pan", () => {
    const tiles = visibleTiles(
      manifest,
      5,
      { displayScale: 1, translateX: -2560, translateY: -2560, viewportW: 256, viewportH: 256 },
      0
    );
    expect(tiles.map((tile) => tile.key)).toEqual(["5/10/10"]);
  });

  it("returns nothing for an unmeasured viewport", () => {
    expect(
      visibleTiles(manifest, 3, {
        displayScale: 0,
        translateX: 0,
        translateY: 0,
        viewportW: 0,
        viewportH: 0,
      })
    ).toEqual([]);
  });
});

describe("overlayLod", () => {
  it("reduces overlays when zoomed out, never below a pixel per device pixel", () => {
    expect(overlayLod(0.14)).toBe(2);
    expect(overlayLod(0.14, 2)).toBe(1);
    expect(overlayLod(0.6)).toBe(0);
    expect(overlayLod(2)).toBe(0);
    expect(overlayLod(0.01)).toBe(3);
    expect(overlayLod(0)).toBe(0);
  });
});
