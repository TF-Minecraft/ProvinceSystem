import type { MapId } from "../components/map/types";
import { mapFallbackSize } from "../components/map/types";
import { screenToMap, type Size } from "../lib/mapViewportMath";

export type MapPickViewport = {
  displayScale: number;
  translateX: number;
  translateY: number;
  viewportElement: HTMLDivElement | null;
  mapSize: Size;
};

export type MapCoords = {
  x: number;
  y: number;
  screenX: number;
  screenY: number;
};

/**
 * Viewport/map pixels -> pick-canvas bitmap pixels.
 * Display size comes from the base map (often 6400); pick maps can differ.
 */
export function mapPixelToPickCanvas(
  mapX: number,
  mapY: number,
  mapSize: Size | null | undefined,
  canvas: { width: number; height: number }
): { x: number; y: number } | null {
  const cw = canvas.width;
  const ch = canvas.height;
  if (cw <= 0 || ch <= 0) return null;

  const mw = mapSize?.w && mapSize.w > 0 ? mapSize.w : cw;
  const mh = mapSize?.h && mapSize.h > 0 ? mapSize.h : ch;
  const x = mw === cw ? mapX : Math.floor((mapX * cw) / mw);
  const y = mh === ch ? mapY : Math.floor((mapY * ch) / mh);
  if (x < 0 || y < 0 || x >= cw || y >= ch) return null;
  return { x, y };
}

function getLegacyMapCoords(
  event: React.MouseEvent,
  canvas: HTMLCanvasElement,
  mapId: MapId
): MapCoords | null {
  const rect = canvas.getBoundingClientRect();
  const mapSize =
    canvas.width > 0 && canvas.height > 0
      ? Math.max(canvas.width, canvas.height)
      : mapFallbackSize(mapId);

  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  if (
    mouseX < 0 ||
    mouseY < 0 ||
    mouseX >= rect.width ||
    mouseY >= rect.height
  ) {
    return null;
  }

  return {
    x: Math.floor((mouseX / rect.width) * mapSize),
    y: Math.floor((mouseY / rect.height) * mapSize),
    screenX: event.clientX,
    screenY: event.clientY,
  };
}

/**
 * Client (viewport-relative page) coordinates -> map pixels, unrounded.
 * Returns null when the point falls outside the map. Callers that index into
 * pixel data (province picking) floor the result themselves; the paint layer
 * wants the sub-pixel value so strokes stay smooth when zoomed in.
 */
export function screenPointToMap(
  clientX: number,
  clientY: number,
  viewport: MapPickViewport
): { x: number; y: number } | null {
  const { viewportElement, displayScale, translateX, translateY, mapSize } =
    viewport;

  if (!viewportElement || displayScale <= 0) {
    return null;
  }

  const viewportRect = viewportElement.getBoundingClientRect();
  const point = screenToMap(
    clientX - viewportRect.left,
    clientY - viewportRect.top,
    displayScale,
    { x: translateX, y: translateY }
  );

  if (
    point.x < 0 ||
    point.y < 0 ||
    point.x >= mapSize.w ||
    point.y >= mapSize.h
  ) {
    return null;
  }

  return point;
}

function getViewportMapCoords(
  event: React.MouseEvent,
  viewport: MapPickViewport
): MapCoords | null {
  const point = screenPointToMap(event.clientX, event.clientY, viewport);
  if (!point) return null;

  return {
    x: Math.floor(point.x),
    y: Math.floor(point.y),
    screenX: event.clientX,
    screenY: event.clientY,
  };
}

/**
 * `canvas` is only for the legacy path, a canvas drawn at the map's size on
 * screen (the editor's). The live map has no such canvas and passes null.
 */
export function getMapCoords(
  event: React.MouseEvent,
  canvas: HTMLCanvasElement | null,
  mapId: MapId,
  viewport?: MapPickViewport | null
): MapCoords | null {
  if (viewport?.viewportElement && viewport.displayScale > 0) {
    return getViewportMapCoords(event, viewport);
  }

  return canvas ? getLegacyMapCoords(event, canvas, mapId) : null;
}
