"use client";

import { useEffect, useMemo, useRef } from "react";

import { mapObjectsVisibilityKey } from "@/app/hooks/useMapHover";
import { visibleOwnership } from "@/app/lib/map/chronicleOwnership";
import {
  buildNationColorLut,
  paintChronicleFrameToImageData,
  type NationOwnership,
  type ProvinceIdGrid,
} from "@/app/lib/map/chroniclePaint";
import type { MapObject, RegionRecord } from "@/app/components/map/types";
import { DRILL_STACK_OVERLAY_OPACITY, HOVER_OVERLAY_OPACITY } from "@/app/components/map/MapCanvas";

/**
 * The chronicle's replacement for the two server-rendered nation layers.
 *
 * On the live map the coloured nation shapes and the hovered-nation highlight
 * are PNGs under `/{map}/regions/{mode}/...`, regenerated from *today's* data
 * with no per-day variant. A stored day therefore has to paint them itself, or
 * opening a date in 2025 would show 2026's borders.
 *
 * Both canvases are painted from the quarter-scale province id grid: 1600x1600
 * against a 6400x6400 map, so a border can land up to 4 map pixels from where
 * the full-resolution PNG puts it. That is a deliberate 16x memory trade, not
 * an oversight — the full-res grid would make each of these canvases a 164 MB
 * `ImageData` (328 MB for the pair, ~500 MB once the pick canvas joins them),
 * against ~10 MB each here. At the zoom levels the viewer supports the
 * difference is under a pixel on screen.
 */

type ChronicleOwnershipLayerProps = {
  /** Quarter-scale province id grid, or null while it is still loading. */
  grid: ProvinceIdGrid | null;
  /** The day's `nation.json`, already loaded by `useMapModeData`. */
  regionData: RegionRecord | null;
  /** Drill state, exactly as `MapCanvas` would have used it to pick PNGs. */
  mapObjects: MapObject[];
  /** Region the pick canvas resolved under the cursor, or null. */
  hoveredRegionId?: string | null;
  mapW: number;
  mapH: number;
};

/**
 * The backend's `_hover` PNGs are a lightness/saturation bump in the nation's
 * own hue (`display_colour.hover_rgb`). This is the same idea done cheaply:
 * mix the nation's colour toward white. Chronicle frames already paint the raw
 * stored `rgb` rather than the backend's parchment-washed display colour, so
 * matching that pipeline exactly here would not make the layers agree anyway —
 * what matters is that the hovered nation reads as clearly brighter.
 */
const HIGHLIGHT_MIX_TOWARD_WHITE = 0.45;

/** Same mix, returned as bytes instead of a string — the hover canvas below
 * writes straight into `ImageData.data` and has no use for the joined form. */
function highlightBytes(rgb: string | undefined): [number, number, number] | null {
  if (!rgb) return null;
  const parts = rgb.split(",");
  if (parts.length !== 3) return null;

  const mixed: number[] = [];
  for (const part of parts) {
    const value = Number(part.trim());
    if (!Number.isFinite(value)) return null;
    const clamped = Math.min(255, Math.max(0, value));
    mixed.push(Math.round(clamped + (255 - clamped) * HIGHLIGHT_MIX_TOWARD_WHITE));
  }
  return mixed as [number, number, number];
}

/**
 * Maps a province id to the flat pixel indices (`y * width + x`, matching
 * `ProvinceIdGrid.ids`) it occupies. Built once per grid rather than once per
 * hover — the hover effect below only ever needs the pixels for the one or
 * two province ids a hover change actually touches, and paying a single
 * full-grid pass to know where every id lives is what makes answering that
 * without re-scanning all 2.56M cells on every mouse move possible.
 */
function buildProvincePixelIndex(grid: ProvinceIdGrid): Map<number, Int32Array> {
  const { ids } = grid;
  const counts = new Map<number, number>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    if (id === 0) continue; // Ocean / unowned — never highlighted.
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const index = new Map<number, Int32Array>();
  for (const [id, count] of counts) index.set(id, new Int32Array(count));

  const cursors = new Map<number, number>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    if (id === 0) continue;
    const cursor = cursors.get(id) ?? 0;
    index.get(id)![cursor] = i;
    cursors.set(id, cursor + 1);
  }
  return index;
}

/** What the hover canvas currently has painted on it — enough to clear it
 * cleanly on the next change and to skip work when nothing actually moved. */
type PaintedHighlight = {
  regionId: string;
  provinces: number[];
};

function paintOwnershipCanvas(
  canvas: HTMLCanvasElement | null,
  grid: ProvinceIdGrid | null,
  ownership: NationOwnership | null,
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (!grid || !ownership) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // Resizing re-allocates the backing store; only touch it on a real change.
  if (canvas.width !== grid.width || canvas.height !== grid.height) {
    canvas.width = grid.width;
    canvas.height = grid.height;
  }

  // `paintChronicleFrameToImageData` writes every pixel, so a fresh buffer
  // needs no clearing and a reused canvas needs no clearRect.
  const imageData = ctx.createImageData(grid.width, grid.height);
  paintChronicleFrameToImageData(imageData, grid, buildNationColorLut(ownership));
  ctx.putImageData(imageData, 0, 0);
}

const canvasClass = "pointer-events-none absolute inset-0 h-full w-full";

export default function ChronicleOwnershipLayer({
  grid,
  regionData,
  mapObjects,
  hoveredRegionId = null,
  mapW,
  mapH,
}: ChronicleOwnershipLayerProps) {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Rebuilt only when the grid itself changes (a new day's province ids), not
  // on every hover — see `buildProvincePixelIndex`.
  const provincePixelIndex = useMemo(() => (grid ? buildProvincePixelIndex(grid) : null), [grid]);
  // The hover canvas's own persistent pixel buffer, mutated in place instead
  // of rebuilt from scratch on every hover change.
  const hoverImageDataRef = useRef<ImageData | null>(null);
  const paintedHighlightRef = useRef<PaintedHighlight | null>(null);

  // The drawn state's identity. `mapObjects` gets a fresh array (and fresh
  // entry objects) on every drill reset even when nothing became visible or
  // invisible, so depending on the array itself would repaint 2.5M pixels for
  // no visible change.
  const visibilityKey = useMemo(() => mapObjectsVisibilityKey(mapObjects), [mapObjects]);

  /**
   * The drawn ownership for the current drill state. Computed once and used by
   * both canvases so the highlight cannot disagree with the shape underneath
   * it: `getHoverRegion` resolves a pick to whichever *visible* entry owns it,
   * and that entry is a rolled-up overlord at the top level but own-land-only
   * once drilled in. Deriving the highlight from any other source would light
   * up a drilled overlord's vassals, which the live `_hover` PNG does not.
   */
  const visible = useMemo(
    () => (regionData ? visibleOwnership(regionData, mapObjects) : null),
    // `mapObjects` is read through `visibilityKey`, which is what actually
    // changes the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regionData, visibilityKey],
  );

  useEffect(() => {
    paintOwnershipCanvas(baseCanvasRef.current, grid, visible);
  }, [grid, visible]);

  /**
   * Paints (and un-paints) the hover highlight without ever touching the
   * grid's other ~2.5M pixels. `paintChronicleFrameToImageData` walks the
   * whole grid regardless of how few provinces its LUT actually names, so
   * routing a one-nation highlight through it costs the same full pass as the
   * base ownership canvas on every mouse move. Instead this keeps the hover
   * canvas's `ImageData` alive across renders and only writes the pixel
   * indices `provincePixelIndex` already knows belong to the region losing
   * the highlight and the one gaining it, then flushes just their bounding
   * rectangle back to the canvas.
   */
  useEffect(() => {
    const canvas = hoverCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!grid || !provincePixelIndex) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hoverImageDataRef.current = null;
      paintedHighlightRef.current = null;
      return;
    }

    if (canvas.width !== grid.width || canvas.height !== grid.height) {
      canvas.width = grid.width;
      canvas.height = grid.height;
      hoverImageDataRef.current = null;
      paintedHighlightRef.current = null;
    }

    if (!hoverImageDataRef.current) {
      hoverImageDataRef.current = ctx.createImageData(grid.width, grid.height);
      paintedHighlightRef.current = null;
    }

    const drawn = hoveredRegionId ? visible?.[hoveredRegionId] : null;
    const bytes = drawn ? highlightBytes(drawn.rgb) : null;
    const next: PaintedHighlight | null =
      hoveredRegionId && drawn && bytes ? { regionId: hoveredRegionId, provinces: drawn.provinces ?? [] } : null;
    const previous = paintedHighlightRef.current;

    const unchanged =
      previous === next ||
      (previous !== null &&
        next !== null &&
        previous.regionId === next.regionId &&
        previous.provinces === next.provinces);
    if (unchanged) return;

    const { data } = hoverImageDataRef.current;
    const width = grid.width;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const touch = (pixelIndex: number): void => {
      const x = pixelIndex % width;
      const y = (pixelIndex / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };

    const write = (provinces: number[], r: number, g: number, b: number, a: number): void => {
      for (const id of provinces) {
        const pixels = provincePixelIndex.get(id);
        if (!pixels) continue;
        for (let i = 0; i < pixels.length; i++) {
          const pixelIndex = pixels[i]!;
          const offset = pixelIndex * 4;
          data[offset] = r;
          data[offset + 1] = g;
          data[offset + 2] = b;
          data[offset + 3] = a;
          touch(pixelIndex);
        }
      }
    };

    // `unchanged` above already covers "still the same region, same province
    // list" — anything reaching here needs its old pixels cleared before the
    // new ones (if any) go down, including the rare case where the hovered id
    // stayed the same but a drill change gave it a different province set.
    if (previous) write(previous.provinces, 0, 0, 0, 0);
    if (next) write(next.provinces, bytes![0], bytes![1], bytes![2], 255);

    paintedHighlightRef.current = next;

    if (minX === Infinity) return; // Nothing was actually touched.
    ctx.putImageData(hoverImageDataRef.current, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1);
  }, [grid, provincePixelIndex, visible, hoveredRegionId]);

  // Matches `HoverOverlayImage`: a map with no measured size has nothing to
  // stretch to, so hide rather than show a stray 1600x1600 square. Hidden, not
  // unmounted — unmounting would drop the canvas nodes the paint effects above
  // hold refs to, and nothing would repaint them once the size arrived.
  const sized = mapW > 0 && mapH > 0;

  return (
    <>
      <canvas
        ref={baseCanvasRef}
        className={canvasClass}
        style={{ opacity: sized ? DRILL_STACK_OVERLAY_OPACITY : 0 }}
        aria-hidden
      />
      <canvas
        ref={hoverCanvasRef}
        className={`${canvasClass} z-10`}
        style={{ opacity: sized ? HOVER_OVERLAY_OPACITY : 0 }}
        aria-hidden
      />
    </>
  );
}
