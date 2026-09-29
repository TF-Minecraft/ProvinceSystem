export const MAP_ZOOM_MIN = 1;
export const MAP_ZOOM_MAX = 4.5;
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

export function clampTranslate(
  viewport: Size,
  map: Size,
  displayScale: number,
  translateX: number,
  translateY: number
): ViewportPoint {
  const displayW = map.w * displayScale;
  const displayH = map.h * displayScale;

  let tx = translateX;
  let ty = translateY;

  // A square map in a non-square (full-bleed) viewport leaves slack on
  // whichever axis isn't the fit-limiting one — e.g. a wide screen has empty
  // space left and right of a contain-fit square map. Centering that slack
  // matches every other map viewer's default view; pinning it to 0 would
  // shove the map into a corner with dead space beside it.
  if (displayW <= viewport.w) {
    tx = (viewport.w - displayW) / 2;
  } else {
    const minX = viewport.w - displayW;
    tx = Math.min(0, Math.max(minX, tx));
  }

  if (displayH <= viewport.h) {
    ty = (viewport.h - displayH) / 2;
  } else {
    const minY = viewport.h - displayH;
    ty = Math.min(0, Math.max(minY, ty));
  }

  return { x: tx, y: ty };
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

  const fitScale = computeFitScale(viewport, map, mode);
  const displayScale = computeDisplayScale(fitScale, transform.userScale);
  const translate = { x: transform.translateX, y: transform.translateY };

  const mapPoint = screenToMap(cursor.x, cursor.y, displayScale, translate);

  const zoomFactor =
    wheelDelta < 0 ? MAP_ZOOM_WHEEL_FACTOR : 1 / MAP_ZOOM_WHEEL_FACTOR;
  const nextUserScale = clampUserScale(transform.userScale * zoomFactor);
  const nextDisplayScale = computeDisplayScale(fitScale, nextUserScale);

  let nextTranslateX = cursor.x - mapPoint.x * nextDisplayScale;
  let nextTranslateY = cursor.y - mapPoint.y * nextDisplayScale;

  const clamped = clampTranslate(
    viewport,
    map,
    nextDisplayScale,
    nextTranslateX,
    nextTranslateY
  );

  return {
    userScale: nextUserScale,
    translateX: clamped.x,
    translateY: clamped.y,
  };
}
