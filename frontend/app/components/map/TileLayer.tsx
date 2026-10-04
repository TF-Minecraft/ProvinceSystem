"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  allTiles,
  backdropBands,
  backdropLevel,
  pickTileLevel,
  tilePixelRatio,
  visibleTiles,
  type PlacedTile,
  type Rect,
  type TileManifest,
  type TileView,
} from "@/app/lib/map/tilePyramid";

type TileLayerProps = {
  manifest: TileManifest;
  /** URL of one tile. */
  tileUrl: (level: number, x: number, y: number) => string;
  /** The settled view. Not updated mid-gesture: tiles on screen just scale. */
  view: TileView;
  className?: string;
  style?: CSSProperties;
  /** Fired once the backdrop has loaded: the layer is on screen, if soft. */
  onReady?: () => void;
  /** A tile failed to load, typically because its pyramid was replaced. */
  onTileError?: () => void;
};

/**
 * A tiled raster, drawn the way Google Maps draws its map.
 *
 * Three stacks, bottom to top:
 * - a backdrop level small enough to load whole (a few tiles), so there is
 *   never a hole, only a softer map, while sharper tiles arrive;
 * - the last level whose visible tiles all finished loading, kept until the
 *   new level has caught up, so a zoom never flashes back to the backdrop;
 * - the level that matches the current zoom, only the tiles on screen.
 *
 * Mid-gesture none of this re-renders: the viewport scales the whole layer on
 * the GPU, which is why zooming stays smooth. Once the view settles the right
 * level's tiles are fetched and fade in over the stretched ones.
 */
function TileLayer({
  manifest,
  tileUrl,
  view,
  className,
  style,
  onReady,
  onTileError,
}: TileLayerProps) {
  const dpr = tilePixelRatio();
  const level = pickTileLevel(manifest, view.displayScale, dpr);

  // A replaced pyramid 404s every tile on screen at once: say so once per
  // version, not once per tile, or each would refetch the manifest.
  const reportedVersionRef = useRef<string | null>(null);
  const reportTileError = () => {
    if (reportedVersionRef.current === manifest.version) return;
    reportedVersionRef.current = manifest.version;
    onTileError?.();
  };
  const backdrop = Math.min(backdropLevel(manifest), level);

  const backdropTiles = useMemo(() => allTiles(manifest, backdrop), [manifest, backdrop]);
  const currentTiles = useMemo(
    () => (level === backdrop ? [] : visibleTiles(manifest, level, view)),
    [manifest, level, backdrop, view]
  );

  const loadedRef = useRef(new Set<string>());
  const [, setLoadedVersion] = useState(0);
  const [settledLevel, setSettledLevel] = useState(backdrop);

  // A new pyramid version is a different image: the sharp level settled for
  // the old one says nothing about the new one. Only on a real change, not on
  // mount: cached tiles can fire `load` before this layer's effects run, and
  // WebKit often does, so a reset on mount wiped tiles that had already
  // loaded. They never load again, and the names waiting on `onReady` (see
  // MapCanvas) stayed hidden for good.
  const versionRef = useRef(manifest.version);
  useEffect(() => {
    if (versionRef.current === manifest.version) return;
    versionRef.current = manifest.version;
    setSettledLevel(backdrop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest.version]);

  // Loaded state is per pyramid version: the same level/x/y of another
  // version is a different picture, so another version's entries never match.
  const loadedKey = (tile: PlacedTile) => `${manifest.version}/${tile.key}`;

  const currentLoaded =
    currentTiles.length > 0 &&
    currentTiles.every((tile) => loadedRef.current.has(loadedKey(tile)));

  useEffect(() => {
    if (currentLoaded && settledLevel !== level) setSettledLevel(level);
  }, [currentLoaded, level, settledLevel]);

  const backdropLoaded =
    backdropTiles.length > 0 &&
    backdropTiles.every((tile) => loadedRef.current.has(loadedKey(tile)));
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (backdropLoaded) onReadyRef.current?.();
  }, [backdropLoaded, manifest.version]);

  // The previous sharp level, held under the new one until it has loaded.
  const holdTiles = useMemo(
    () =>
      settledLevel !== level && settledLevel !== backdrop && settledLevel <= manifest.max_level
        ? visibleTiles(manifest, settledLevel, view)
        : [],
    [manifest, settledLevel, level, backdrop, view]
  );

  const markLoaded = (key: string) => {
    if (loadedRef.current.has(key)) return;
    loadedRef.current.add(key);
    setLoadedVersion((value) => value + 1);
  };

  // Tile edges on whole screen pixels: neighbours then meet exactly, with no
  // hairline gap between them and no overlap. An overlap used to hide the
  // gaps, but on a see-through raster (prosperity) its strip was drawn twice
  // and showed as a darker line.
  const screenDpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const mapPxPerScreenPx = 1 / (view.displayScale * screenDpr);
  const snap = (value: number) =>
    mapPxPerScreenPx > 0 && Number.isFinite(mapPxPerScreenPx)
      ? Math.round(value / mapPxPerScreenPx) * mapPxPerScreenPx
      : value;

  // Once the sharp tiles on screen have all loaded (`currentLoaded`), the
  // held level under them stands down, and so does the backdrop where they
  // cover it: on a see-through raster they would otherwise stack and deepen
  // its colours.
  const renderTile = (
    tile: PlacedTile,
    fadeIn: boolean,
    hidden = false,
    origin = { left: 0, top: 0, key: "" }
  ) => {
    const loaded = loadedRef.current.has(loadedKey(tile));
    const left = snap(tile.left);
    const top = snap(tile.top);
    return (
      <img
        key={`${origin.key}${loadedKey(tile)}`}
        src={tileUrl(tile.level, tile.x, tile.y)}
        alt=""
        aria-hidden
        draggable={false}
        decoding="async"
        onLoad={() => markLoaded(loadedKey(tile))}
        onError={reportTileError}
        className="absolute max-w-none select-none"
        style={{
          left: left - origin.left,
          top: top - origin.top,
          width: snap(tile.left + tile.width) - left,
          height: snap(tile.top + tile.height) - top,
          opacity: !fadeIn || loaded ? 1 : 0,
          visibility: hidden ? "hidden" : undefined,
          transition: fadeIn ? "opacity 160ms ease-out" : undefined,
        }}
      />
    );
  };

  return (
    <div
      className={`pointer-events-none absolute inset-0 ${className ?? ""}`}
      style={style}
      aria-hidden
    >
      {currentLoaded
        ? backdropBands(
            { left: 0, top: 0, right: snap(manifest.width), bottom: snap(manifest.height) },
            coverage(currentTiles, snap)
          ).map((band) => (
            // Outside the sharp tiles the backdrop stays up. A pinch out or a
            // fast pan scales and moves this layer without a render, and a
            // hidden backdrop left only the tiles that were on screen, a small
            // island of map on black until the gesture settled.
            <div
              key={band.key}
              className="absolute overflow-hidden"
              style={{
                left: band.left,
                top: band.top,
                width: band.right - band.left,
                height: band.bottom - band.top,
              }}
            >
              {backdropTiles
                .filter((tile) => overlaps(tile, band, snap))
                .map((tile) =>
                  renderTile(tile, false, false, {
                    left: band.left,
                    top: band.top,
                    key: `${band.key}:`,
                  })
                )}
            </div>
          ))
        : backdropTiles.map((tile) => renderTile(tile, false))}
      {holdTiles.map((tile) => renderTile(tile, false, currentLoaded))}
      {currentTiles.map((tile) => renderTile(tile, true))}
    </div>
  );
}

/** The rectangle a level's visible tiles cover, on the same snapped edges. */
function coverage(tiles: PlacedTile[], snap: (value: number) => number): Rect {
  return {
    left: snap(Math.min(...tiles.map((tile) => tile.left))),
    top: snap(Math.min(...tiles.map((tile) => tile.top))),
    right: snap(Math.max(...tiles.map((tile) => tile.left + tile.width))),
    bottom: snap(Math.max(...tiles.map((tile) => tile.top + tile.height))),
  };
}

function overlaps(tile: PlacedTile, band: Rect, snap: (value: number) => number): boolean {
  return (
    snap(tile.left) < band.right &&
    snap(tile.left + tile.width) > band.left &&
    snap(tile.top) < band.bottom &&
    snap(tile.top + tile.height) > band.top
  );
}

export default memo(TileLayer);
