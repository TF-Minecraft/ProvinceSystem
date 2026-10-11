/**
 * Pure geometry for the paint layer: path building, arrowheads, brush point
 * simplification and hit-testing.
 *
 * Hit-testing is done explicitly rather than through SVG DOM events because a
 * 2px dashed stroke is nearly impossible to hit with a pointer, and the gaps
 * between dashes are not hittable at all. Everything here works in map pixels
 * and takes pre-scaled sizes, so it stays free of `displayScale`.
 */

import {
  clampPaintScale,
  normalizePaintRotation,
  paintEffectiveSizes,
  paintShapeRotation,
  paintShapeScale,
  type PaintPoint,
  type PaintShape,
  type PaintSizesMapPx,
} from "./mapPaint";

export function pointToSegmentDistance(p: PaintPoint, a: PaintPoint, b: PaintPoint): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;

  if (lengthSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

export function distanceToPolyline(p: PaintPoint, points: PaintPoint[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);

  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const distance = pointToSegmentDistance(p, points[i - 1], points[i]);
    if (distance < best) best = distance;
  }
  return best;
}

export function brushPathD(points: PaintPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    // A single tap still needs to paint something: a zero-length round-capped
    // segment renders as a dot.
    const { x, y } = points[0];
    return `M ${x} ${y} L ${x} ${y}`;
  }
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

const ARROW_HEAD_HALF_ANGLE = Math.PI / 7;

/**
 * Three points of the arrowhead triangle: the tip, then the two barbs. Drawn
 * as a filled polygon rather than an SVG `<marker>` so the head size stays
 * independent of stroke width.
 */
export function arrowHeadPoints(from: PaintPoint, to: PaintPoint, headLenMapPx: number): PaintPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);

  return [
    { x: to.x, y: to.y },
    {
      x: to.x - headLenMapPx * Math.cos(angle - ARROW_HEAD_HALF_ANGLE),
      y: to.y - headLenMapPx * Math.sin(angle - ARROW_HEAD_HALF_ANGLE),
    },
    {
      x: to.x - headLenMapPx * Math.cos(angle + ARROW_HEAD_HALF_ANGLE),
      y: to.y - headLenMapPx * Math.sin(angle + ARROW_HEAD_HALF_ANGLE),
    },
  ];
}

export function pointsToPolygonAttr(points: PaintPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

/**
 * Appends a sampled brush point, dropping it if it is within `minDistMapPx` of
 * the previous one. Returns the *same array reference* when the point is
 * dropped so React can skip the re-render.
 */
export function appendBrushPoint(points: PaintPoint[], p: PaintPoint, minDistMapPx: number): PaintPoint[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < minDistMapPx) {
    return points;
  }
  return [...points, p];
}

/** Estimated advance width of one average glyph, as a fraction of the font size. */
export const PAINT_TEXT_CHAR_EM = 0.58;
/** Floor, so a one-character label is still about as wide as a capital. */
export const PAINT_TEXT_MIN_EM = 0.62;
export const PAINT_TEXT_LINE_EM = 1.15;

/**
 * Rough text bounds. There is no way to measure a glyph without a DOM, so the
 * width is estimated per character — deliberately with no one-em floor, or a
 * short label would sit in a plate far wider than itself. The renderer centres
 * the glyphs inside this box, which keeps any estimate error symmetric instead
 * of piling it all up on the right.
 *
 * `at` is the baseline start: the box's left edge, not its centre.
 */
export function paintTextBounds(
  shape: Extract<PaintShape, { type: "text" }>,
  fontSize: number,
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(fontSize * PAINT_TEXT_MIN_EM, shape.text.length * fontSize * PAINT_TEXT_CHAR_EM);
  const h = fontSize * PAINT_TEXT_LINE_EM;
  return { x: shape.at.x, y: shape.at.y - h * 0.8, w, h };
}

function withinBox(p: PaintPoint, box: { x: number; y: number; w: number; h: number }, tolerance: number): boolean {
  return (
    p.x >= box.x - tolerance &&
    p.x <= box.x + box.w + tolerance &&
    p.y >= box.y - tolerance &&
    p.y <= box.y + box.h + tolerance
  );
}

export function rotatePoint(p: PaintPoint, centre: PaintPoint, degrees: number): PaintPoint {
  if (!degrees) return p;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}

export function boundsCentre(bounds: PaintBounds): PaintPoint {
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

/**
 * Maps a map-space pointer into a shape's own unrotated frame. Geometry is
 * always stored unrotated, so everything downstream — hit-testing, handles,
 * resizing — can ignore rotation entirely once the pointer is converted.
 */
export function toShapeLocalPoint(shape: PaintShape, p: PaintPoint, sizes: PaintSizesMapPx): PaintPoint {
  const rotation = paintShapeRotation(shape);
  if (!rotation) return p;
  return rotatePoint(p, boundsCentre(paintShapeBounds(shape, sizes)), -rotation);
}

export function rotatePaintShape<T extends PaintShape>(shape: T, degrees: number): T {
  return { ...shape, rotation: normalizePaintRotation(degrees) };
}

export function paintShapeHitTest(
  shape: PaintShape,
  p: PaintPoint,
  toleranceMapPx: number,
  sizes: PaintSizesMapPx,
): boolean {
  const size = paintEffectiveSizes(shape, sizes);
  // Geometry is stored unrotated, so bring the pointer into the shape's frame.
  const local = toShapeLocalPoint(shape, p, sizes);

  switch (shape.type) {
    case "brush":
      return distanceToPolyline(local, shape.points) <= toleranceMapPx + size.strokeWidth / 2;
    case "arrow": {
      const shaft = pointToSegmentDistance(local, shape.from, shape.to);
      if (shaft <= toleranceMapPx + size.strokeWidth / 2) return true;
      return Math.hypot(local.x - shape.to.x, local.y - shape.to.y) <= size.arrowHead;
    }
    case "stamp": {
      const half = size.stamp / 2;
      return withinBox(
        local,
        { x: shape.at.x - half, y: shape.at.y - half, w: size.stamp, h: size.stamp },
        toleranceMapPx,
      );
    }
    case "text":
      return withinBox(local, paintTextBounds(shape, size.fontSize), toleranceMapPx);
    default:
      return false;
  }
}

export type PaintBounds = { x: number; y: number; w: number; h: number };

/** Axis-aligned extent of a shape as drawn, used for the selection box and its handles. */
export function paintShapeBounds(shape: PaintShape, sizes: PaintSizesMapPx): PaintBounds {
  const size = paintEffectiveSizes(shape, sizes);

  switch (shape.type) {
    case "brush":
    case "arrow": {
      const points = shape.type === "brush" ? shape.points : [shape.from, shape.to];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of points) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
      // The arrowhead sticks out past the shaft's end point.
      const pad = shape.type === "arrow" ? Math.max(size.strokeWidth / 2, size.arrowHead * 0.6) : size.strokeWidth / 2;
      return {
        x: minX - pad,
        y: minY - pad,
        w: maxX - minX + pad * 2,
        h: maxY - minY + pad * 2,
      };
    }
    case "stamp": {
      const half = size.stamp / 2;
      return { x: shape.at.x - half, y: shape.at.y - half, w: size.stamp, h: size.stamp };
    }
    case "text":
      return paintTextBounds(shape, size.fontSize);
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

/** Corners clockwise from top-left: the order handle indices refer to. */
export function paintBoundsCorners(bounds: PaintBounds): PaintPoint[] {
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { x: bounds.x, y: bounds.y + bounds.h },
  ];
}

export type PaintHandleHit = {
  corner: number;
  /** The opposite corner, held fixed while dragging. */
  anchor: PaintPoint;
  grabbed: PaintPoint;
};

export function pickPaintHandle(bounds: PaintBounds, p: PaintPoint, handleMapPx: number): PaintHandleHit | null {
  const corners = paintBoundsCorners(bounds);
  // On a small shape — or at low zoom, where the constant-screen-size grab
  // radius is large in map pixels — four full-reach corners would cover the
  // whole shape and swallow every click meant for its body. Never let the
  // handles claim more than the outer third of each edge.
  const reach = Math.min(handleMapPx, Math.min(bounds.w, bounds.h) / 3);
  for (let i = 0; i < corners.length; i += 1) {
    if (Math.abs(p.x - corners[i].x) <= reach && Math.abs(p.y - corners[i].y) <= reach) {
      return { corner: i, anchor: corners[(i + 2) % 4], grabbed: corners[i] };
    }
  }
  return null;
}

/**
 * Scales a shape uniformly about `anchor`. Geometry and the size multiplier move
 * together, and the clamp on the multiplier also limits the geometry, so a shape
 * can never be scaled to a size its stroke or glyph cannot match.
 */
export function scalePaintShape<T extends PaintShape>(
  shape: T,
  anchor: PaintPoint,
  factor: number,
  /** Needed only to keep the anchor pinned when the shape is rotated. */
  sizes?: PaintSizesMapPx,
): T {
  if (!Number.isFinite(factor) || factor <= 0) return shape;

  const current = paintShapeScale(shape);
  const nextScale = clampPaintScale(current * factor);
  const applied = nextScale / current;
  if (applied === 1) return shape;

  const move = (point: PaintPoint): PaintPoint => ({
    x: anchor.x + (point.x - anchor.x) * applied,
    y: anchor.y + (point.y - anchor.y) * applied,
  });

  const scaled = ((): T => {
    switch (shape.type) {
      case "brush":
        return { ...shape, scale: nextScale, points: shape.points.map(move) };
      case "arrow":
        return { ...shape, scale: nextScale, from: move(shape.from), to: move(shape.to) };
      case "stamp":
      case "text":
        return { ...shape, scale: nextScale, at: move(shape.at) };
      default:
        return shape;
    }
  })();

  const rotation = paintShapeRotation(shape);
  if (!rotation || !sizes) return scaled;

  // Scaling happens in the shape's unrotated frame, which moves its centre —
  // and the centre is the rotation pivot. Without this the anchor corner would
  // visibly slide away as a rotated shape is resized.
  const before = rotatePoint(anchor, boundsCentre(paintShapeBounds(shape, sizes)), rotation);
  const after = rotatePoint(anchor, boundsCentre(paintShapeBounds(scaled, sizes)), rotation);
  return translatePaintShape(scaled, before.x - after.x, before.y - after.y);
}

/** Scans end -> start so the top-most (last drawn) shape wins, like `pickMapMarkerAt`. */
export function pickTopPaintShapeAt(
  shapes: PaintShape[],
  p: PaintPoint,
  toleranceMapPx: number,
  sizes: PaintSizesMapPx,
): PaintShape | null {
  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    if (paintShapeHitTest(shapes[i], p, toleranceMapPx, sizes)) return shapes[i];
  }
  return null;
}

export function translatePaintShape<T extends PaintShape>(shape: T, dx: number, dy: number): T {
  switch (shape.type) {
    case "brush":
      return {
        ...shape,
        points: shape.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      };
    case "arrow":
      return {
        ...shape,
        from: { x: shape.from.x + dx, y: shape.from.y + dy },
        to: { x: shape.to.x + dx, y: shape.to.y + dy },
      };
    case "stamp":
    case "text":
      return { ...shape, at: { x: shape.at.x + dx, y: shape.at.y + dy } };
    default:
      return shape;
  }
}
