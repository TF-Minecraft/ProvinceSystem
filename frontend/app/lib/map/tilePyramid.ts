/**
 * Tile pyramid maths for the map's full-size rasters, served by the backend's
 * `/{map}/tiles/{layer}` routes. Level 0 is the whole map in one tile; each
 * level above doubles the resolution up to `max_level`, which is full size.
 * The client only loads the tiles on screen, at the level matching its zoom.
 */

export type TileLevel = { width: number; height: number };

export type TileManifest = {
  ready: true;
  version: string;
  width: number;
  height: number;
  tile_size: number;
  max_level: number;
  levels: TileLevel[];
};

/** What part of the map is on screen, in the viewport's own terms. */
export type TileView = {
  displayScale: number;
  translateX: number;
  translateY: number;
  viewportW: number;
  viewportH: number;
};

/** One tile, positioned in map pixels (the coordinate space of the map layer). */
export type PlacedTile = {
  key: string;
  level: number;
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export function isTileManifest(value: unknown): value is TileManifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<TileManifest>;
  return (
    m.ready === true &&
    typeof m.version === "string" &&
    typeof m.width === "number" &&
    typeof m.height === "number" &&
    typeof m.tile_size === "number" &&
    m.tile_size > 0 &&
    typeof m.max_level === "number" &&
    Array.isArray(m.levels) &&
    m.levels.length === m.max_level + 1
  );
}

/** Level pixels per map pixel. */
function levelScale(manifest: TileManifest, level: number): number {
  return manifest.levels[level].width / manifest.width;
}

/**
 * The lowest level with at least one level pixel per device pixel at this
 * zoom, so tiles are never stretched when a sharper level exists. Past full
 * size there is nothing sharper: the top level is stretched.
 */
export function pickTileLevel(
  manifest: TileManifest,
  displayScale: number,
  devicePixelRatio = 1
): number {
  const wanted = displayScale * Math.max(1, devicePixelRatio);
  for (let level = 0; level <= manifest.max_level; level++) {
    if (levelScale(manifest, level) >= wanted * 0.999) return level;
  }
  return manifest.max_level;
}

/**
 * The always-loaded backdrop: the sharpest level that is still only a few
 * tiles across. Drawn under everything, so a fast pan or zoom shows a soft
 * map while sharper tiles arrive rather than holes.
 */
export function backdropLevel(manifest: TileManifest, maxTilesAcross = 4): number {
  let best = 0;
  for (let level = 0; level <= manifest.max_level; level++) {
    const { width, height } = manifest.levels[level];
    const across = Math.ceil(Math.max(width, height) / manifest.tile_size);
    if (across <= maxTilesAcross) best = level;
  }
  return best;
}

function placeTile(manifest: TileManifest, level: number, x: number, y: number): PlacedTile {
  const size = manifest.tile_size;
  const { width: lw, height: lh } = manifest.levels[level];
  const toMap = manifest.width / lw;
  const pixelW = Math.min(size, lw - x * size);
  const pixelH = Math.min(size, lh - y * size);
  return {
    key: `${level}/${x}/${y}`,
    level,
    x,
    y,
    left: x * size * toMap,
    top: y * size * toMap,
    width: pixelW * toMap,
    height: pixelH * toMap,
  };
}

/** Every tile of a level. */
export function allTiles(manifest: TileManifest, level: number): PlacedTile[] {
  const { width, height } = manifest.levels[level];
  const size = manifest.tile_size;
  const tiles: PlacedTile[] = [];
  for (let y = 0; y < Math.ceil(height / size); y++) {
    for (let x = 0; x < Math.ceil(width / size); x++) {
      tiles.push(placeTile(manifest, level, x, y));
    }
  }
  return tiles;
}

/**
 * The tiles of `level` that intersect the viewport, plus `margin` tiles on
 * each side so a short pan does not reveal an edge before the next settle.
 */
export function visibleTiles(
  manifest: TileManifest,
  level: number,
  view: TileView,
  margin = 1
): PlacedTile[] {
  if (view.displayScale <= 0 || view.viewportW <= 0 || view.viewportH <= 0) {
    return [];
  }
  const { width: lw, height: lh } = manifest.levels[level];
  const size = manifest.tile_size;
  const scale = levelScale(manifest, level);
  const cols = Math.ceil(lw / size);
  const rows = Math.ceil(lh / size);

  // Viewport corners in map pixels, then in level pixels.
  const mapLeft = -view.translateX / view.displayScale;
  const mapTop = -view.translateY / view.displayScale;
  const mapRight = (view.viewportW - view.translateX) / view.displayScale;
  const mapBottom = (view.viewportH - view.translateY) / view.displayScale;

  const x0 = Math.max(0, Math.floor((mapLeft * scale) / size) - margin);
  const y0 = Math.max(0, Math.floor((mapTop * scale) / size) - margin);
  // Right and bottom edges are exclusive: a tile that only touches the
  // viewport edge is not on screen.
  const x1 = Math.min(cols - 1, Math.ceil((mapRight * scale) / size) - 1 + margin);
  const y1 = Math.min(rows - 1, Math.ceil((mapBottom * scale) / size) - 1 + margin);

  const tiles: PlacedTile[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      tiles.push(placeTile(manifest, level, x, y));
    }
  }
  return tiles;
}

/**
 * Reduction for a single overlay image at this zoom: 2**lod smaller, as long
 * as that still has a pixel per device pixel. Capped to what the backend
 * serves.
 */
export function overlayLod(
  displayScale: number,
  devicePixelRatio = 1,
  maxLod = 3
): number {
  const wanted = displayScale * Math.max(1, devicePixelRatio);
  if (!(wanted > 0)) return 0;
  return Math.max(0, Math.min(maxLod, Math.floor(Math.log2(1 / wanted))));
}

/**
 * The screen density map imagery is fetched for. A 3x phone would otherwise
 * load about twice the tiles of a 2x one, for detail it can barely show, and
 * hold them all decoded; iOS Safari reloads a page that uses too much memory.
 * Google Maps serves phones 2x tiles at most, too.
 */
export const MAX_TILE_PIXEL_RATIO = 2;

export function tilePixelRatio(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(window.devicePixelRatio || 1, MAX_TILE_PIXEL_RATIO);
}
