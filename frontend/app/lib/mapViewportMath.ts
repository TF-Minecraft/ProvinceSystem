export const MAP_ZOOM_MIN = 1;
/**
 * Deep enough to read individual map pixels: at 16x a contain-fit 6400 px map
 * shows about two screen pixels per map pixel on a 900 px tall viewport.
 */
export const MAP_ZOOM_MAX = 16;
export const MAP_ZOOM_WHEEL_FACTOR = 1.1;

export type Size = {
  w: number;
  h: number;
};

export type ViewportTransform = {
  userScale: number;
  translateX: number;
  translateY: number;
};

export type ViewportPoint = {
  x: number;
  y: number;
};

/**
 * "cover": fills the viewport edge to edge on both axes, cropping whichever
 * axis overflows (the default — see `computeFitScale`).
 * "contain": shows the whole map on both axes, leaving empty space on the
 * axis that doesn't need the full scale.
 */
export type FitMode = "cover" | "contain";

/**
 * "Cover" fit: the smallest scale at which the map fully covers the viewport
 * on both axes, so user zoom 1 always fills the screen edge to edge with no
 * empty space — the fit-limiting axis lands exactly on the viewport, the
 * other overflows and needs a pan to see the rest. For a viewport container
 * whose aspect ratio matches the map's (the previous square layout), this is
 * identical to a width-only fit. It only differs once the viewport is a
 * full-bleed rectangle with its own independent height.
 */
export function computeFitScale(
  viewport: Size,
  map: Size,
  mode: FitMode = "cover"
): number {
  if (map.w <= 0 || map.h <= 0) return 1;
  const widthFit = viewport.w / map.w;
  const heightFit = viewport.h / map.h;
  return mode === "contain" ? Math.min(widthFit, heightFit) : Math.max(widthFit, heightFit);
}

export function computeDisplayScale(fitScale: number, userScale: number): number {
  return fitScale * userScale;
}

export function clampUserScale(scale: number): number {
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, scale));
}

/**
 * How far the map may be dragged: until one of its corners reaches the middle
 * of the screen, and no further. Zoomed in, that lets any edge or corner of
 * the world be brought to the centre of the view instead of stopping at the
 * screen edge; at any zoom, at least a quarter of the screen is still map, so
 * the map can never be lost off-screen. The same rule OpenFront uses
 * ("up to half of the viewport can be outside the map on each side").
 */
export function clampTranslate(
  viewport: Size,
  map: Size,
  displayScale: number,
  translateX: number,
  translateY: number
): ViewportPoint {
  const displayW = map.w * displayScale;
  const displayH = map.h * displayScale;

  // The map's left edge may come no further right than the screen's middle,
  // and its right edge no further left; likewise vertically.
  const minX = viewport.w / 2 - displayW;
  const maxX = viewport.w / 2;
  const minY = viewport.h / 2 - displayH;
  const maxY = viewport.h / 2;

  return {
    x: Math.min(maxX, Math.max(minX, translateX)),
    y: Math.min(maxY, Math.max(minY, translateY)),
  };
}

/**
 * Where the view should sit the moment it becomes ready (page load, or an
 * explicit "reset view"), before any pan the user has done. Cover-fit's
 * cropped axis overflows the viewport at zoom 1, and without this the view
 * lands pinned to that axis's top/left edge (translate 0,0 happens to be
 * valid there) instead of showing the middle of the map like every other
 * axis. Centers both axes uniformly by feeding the geometric center through
 * `clampTranslate` — on the axis with slack this reproduces its own
 * centering, and on the overflowing axis it lands at the midpoint of the
 * pannable range instead of an edge.
 */
export function computeCenteredTransform(
  viewport: Size,
  map: Size,
  userScale = 1,
  mode: FitMode = "cover"
): ViewportTransform {
  const fitScale = computeFitScale(viewport, map, mode);
  const displayScale = computeDisplayScale(fitScale, userScale);
  const centerX = (viewport.w - map.w * displayScale) / 2;
  const centerY = (viewport.h - map.h * displayScale) / 2;
  const clamped = clampTranslate(viewport, map, displayScale, centerX, centerY);

  return {
    userScale,
    translateX: clamped.x,
    translateY: clamped.y,
  };
}

export function mapToScreen(
  mapX: number,
  mapY: number,
  displayScale: number,
  translate: ViewportPoint
): ViewportPoint {
  return {
    x: mapX * displayScale + translate.x,
    y: mapY * displayScale + translate.y,
  };
}

export function screenToMap(
  viewportX: number,
  viewportY: number,
  displayScale: number,
  translate: ViewportPoint
): ViewportPoint {
  if (displayScale === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: (viewportX - translate.x) / displayScale,
    y: (viewportY - translate.y) / displayScale,
  };
}

export function viewportTransformStyle(
  displayScale: number,
  translateX: number,
  translateY: number
): string {
  return `translate(${translateX}px, ${translateY}px) scale(${displayScale})`;
}

export function zoomAtPoint(
  viewport: Size,
  map: Size,
  transform: ViewportTransform,
  cursor: ViewportPoint,
  wheelDelta: number,
  mode: FitMode = "cover"
): ViewportTransform {
  // Horizontal-only wheel events (sideways trackpad swipe, Shift+wheel on
  // Windows) arrive with deltaY === 0 and carry no zoom direction.
  if (wheelDelta === 0 || !Number.isFinite(wheelDelta)) {
    return transform;
  }

  const zoomFactor =
    wheelDelta < 0 ? MAP_ZOOM_WHEEL_FACTOR : 1 / MAP_ZOOM_WHEEL_FACTOR;
  return zoomToScaleAtPoint(
    viewport,
    map,
    transform,
    cursor,
    transform.userScale * zoomFactor,
    mode
  );
}

/**
 * Zoom to `userScale` while keeping the map point under `anchor` (viewport
 * pixels) fixed on screen. Shared by the wheel, the zoom buttons, double-click
 * and pinch, which differ only in where the anchor is and how far they go.
 */
export function zoomToScaleAtPoint(
  viewport: Size,
  map: Size,
  transform: ViewportTransform,
  anchor: ViewportPoint,
  userScale: number,
  mode: FitMode = "cover"
): ViewportTransform {
  if (!Number.isFinite(userScale)) return transform;

  const fitScale = computeFitScale(viewport, map, mode);
  const displayScale = computeDisplayScale(fitScale, transform.userScale);
  const translate = { x: transform.translateX, y: transform.translateY };
  const mapPoint = screenToMap(anchor.x, anchor.y, displayScale, translate);

  const nextUserScale = clampUserScale(userScale);
  const nextDisplayScale = computeDisplayScale(fitScale, nextUserScale);
  const clamped = clampTranslate(
    viewport,
    map,
    nextDisplayScale,
    anchor.x - mapPoint.x * nextDisplayScale,
    anchor.y - mapPoint.y * nextDisplayScale
  );

  return {
    userScale: nextUserScale,
    translateX: clamped.x,
    translateY: clamped.y,
  };
}

/** A rectangle in map pixels, e.g. a region's overlay crop box. */
export type MapRect = { x: number; y: number; w: number; h: number };

/**
 * The transform that centres `rect` and zooms until it fills `fill` of the
 * viewport on its tighter axis. `inset` shifts the target centre away from
 * screen furniture (a side panel on the left, a bottom sheet below), so the
 * framed region lands in the part of the map the reader can actually see.
 */
export function transformForMapRect(
  viewport: Size,
  map: Size,
  rect: MapRect,
  mode: FitMode = "cover",
  options: {
    fill?: number;
    maxUserScale?: number;
    inset?: { left?: number; right?: number; top?: number; bottom?: number };
  } = {}
): ViewportTransform {
  const fill = options.fill ?? 0.6;
  const inset = options.inset ?? {};
  const left = inset.left ?? 0;
  const right = inset.right ?? 0;
  const top = inset.top ?? 0;
  const bottom = inset.bottom ?? 0;
  const usableW = Math.max(1, viewport.w - left - right);
  const usableH = Math.max(1, viewport.h - top - bottom);

  const fitScale = computeFitScale(viewport, map, mode);
  const rectW = Math.max(1, rect.w);
  const rectH = Math.max(1, rect.h);
  const wanted = Math.min(
    (usableW * fill) / (rectW * fitScale),
    (usableH * fill) / (rectH * fitScale)
  );
  const userScale = clampUserScale(
    Math.min(wanted, options.maxUserScale ?? MAP_ZOOM_MAX)
  );
  const displayScale = computeDisplayScale(fitScale, userScale);

  const centreX = left + usableW / 2;
  const centreY = top + usableH / 2;
  const clamped = clampTranslate(
    viewport,
    map,
    displayScale,
    centreX - (rect.x + rect.w / 2) * displayScale,
    centreY - (rect.y + rect.h / 2) * displayScale
  );

  return {
    userScale,
    translateX: clamped.x,
    translateY: clamped.y,
  };
}
