"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  allTiles,
  backdropLevel,
  pickTileLevel,
  visibleTiles,
  type PlacedTile,
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
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const level = pickTileLevel(manifest, view.displayScale, dpr);
  const backdrop = Math.min(backdropLevel(manifest), level);

  const backdropTiles = useMemo(() => allTiles(manifest, backdrop), [manifest, backdrop]);
  const currentTiles = useMemo(
    () => (level === backdrop ? [] : visibleTiles(manifest, level, view)),
    [manifest, level, backdrop, view]
  );

  const loadedRef = useRef(new Set<string>());
  const [, setLoadedVersion] = useState(0);
  const [settledLevel, setSettledLevel] = useState(backdrop);

  // A new pyramid version is a different image: nothing loaded carries over.
  useEffect(() => {
    loadedRef.current = new Set();
    setSettledLevel(backdrop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest.version]);

  // Loaded state is per pyramid version: the same level/x/y of another
  // version is a different picture.
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

  const renderTile = (tile: PlacedTile, fadeIn: boolean) => {
    const loaded = loadedRef.current.has(loadedKey(tile));
    // A sliver of overlap hides the hairline seams sub-pixel positioning
    // leaves between neighbouring tiles.
    const overlap = (manifest.width / manifest.levels[tile.level].width) * 0.5;
    return (
      <img
        key={loadedKey(tile)}
        src={tileUrl(tile.level, tile.x, tile.y)}
        alt=""
        aria-hidden
        draggable={false}
        decoding="async"
        onLoad={() => markLoaded(loadedKey(tile))}
        onError={onTileError}
        className="absolute max-w-none select-none"
        style={{
          left: tile.left,
          top: tile.top,
          width: tile.width + overlap,
          height: tile.height + overlap,
          opacity: !fadeIn || loaded ? 1 : 0,
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
      {backdropTiles.map((tile) => renderTile(tile, false))}
      {holdTiles.map((tile) => renderTile(tile, false))}
      {currentTiles.map((tile) => renderTile(tile, true))}
    </div>
  );
}

export default memo(TileLayer);
