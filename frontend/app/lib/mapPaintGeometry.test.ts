import { describe, expect, it } from "vitest";

import {
  PAINT_MAX_SHAPE_SCALE,
  PAINT_MIN_SHAPE_SCALE,
  paintEffectiveSizes,
  type PaintSizesMapPx,
  type PaintArrowShape,
  type PaintBrushShape,
  type PaintShape,
  type PaintStampShape,
  type PaintTextShape,
} from "./mapPaint";
import {
  PAINT_TEXT_CHAR_EM,
  PAINT_TEXT_MIN_EM,
  appendBrushPoint,
  paintTextBounds,
  boundsCentre,
  rotatePaintShape,
  rotatePoint,
  toShapeLocalPoint,
  paintBoundsCorners,
  paintShapeBounds,
  pickPaintHandle,
  scalePaintShape,
  arrowHeadPoints,
  brushPathD,
  distanceToPolyline,
  paintShapeHitTest,
  pickTopPaintShapeAt,
  pointToSegmentDistance,
  translatePaintShape,
} from "./mapPaintGeometry";

// Explicit sizes keep these geometry tests independent of the size constants.
const sizes: PaintSizesMapPx = { arrowHead: 16, stamp: 34 };

const brush: PaintBrushShape = {
  id: "brush",
  type: "brush",
  color: "attack",
  width: 2,
  createdAt: 1,
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ],
};

const arrow: PaintArrowShape = {
  id: "arrow",
  type: "arrow",
  color: "warning",
  width: 2,
  createdAt: 2,
  from: { x: 0, y: 500 },
  to: { x: 200, y: 500 },
};

const stamp: PaintStampShape = {
  id: "stamp",
  type: "stamp",
  color: "friendly",
  createdAt: 3,
  icon: "raid",
  at: { x: 1000, y: 1000 },
};

const text: PaintTextShape = {
  id: "text",
  type: "text",
  color: "note",
  width: 4,
  createdAt: 4,
  at: { x: 2000, y: 2000 },
  text: "hold",
};

describe("pointToSegmentDistance", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it("uses the perpendicular foot when it falls inside the segment", () => {
    expect(pointToSegmentDistance({ x: 5, y: 4 }, a, b)).toBe(4);
  });

  it("clamps to whichever endpoint is nearest", () => {
    expect(pointToSegmentDistance({ x: -3, y: 4 }, a, b)).toBe(5);
    expect(pointToSegmentDistance({ x: 13, y: 4 }, a, b)).toBe(5);
  });

  it("handles a degenerate zero-length segment", () => {
    expect(pointToSegmentDistance({ x: 3, y: 4 }, a, a)).toBe(5);
  });

  it("is zero on the line itself", () => {
    expect(pointToSegmentDistance({ x: 7, y: 0 }, a, b)).toBe(0);
  });
});

describe("distanceToPolyline", () => {
  it("returns the minimum across segments", () => {
    expect(distanceToPolyline({ x: 100, y: 50 }, brush.points)).toBe(0);
    expect(distanceToPolyline({ x: 50, y: 6 }, brush.points)).toBe(6);
  });

  it("handles single-point and empty polylines", () => {
    expect(distanceToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBe(5);
    expect(distanceToPolyline({ x: 0, y: 0 }, [])).toBe(Infinity);
  });
});

describe("brushPathD", () => {
  it("renders a single point as a zero-length segment so it still paints a dot", () => {
    expect(brushPathD([{ x: 4, y: 5 }])).toBe("M 4 5 L 4 5");
  });

  it("joins points into a polyline", () => {
    expect(
      brushPathD([
        { x: 0, y: 0 },
        { x: 1, y: 2 },
      ]),
    ).toBe("M 0 0 L 1 2");
  });

  it("returns an empty string for no points", () => {
    expect(brushPathD([])).toBe("");
  });
});

describe("arrowHeadPoints", () => {
  it("puts the tip at `to` and symmetric barbs behind it", () => {
    const [tip, left, right] = arrowHeadPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(tip).toEqual({ x: 100, y: 0 });
    expect(left.x).toBeCloseTo(right.x, 10);
    expect(left.y).toBeCloseTo(-right.y, 10);
    expect(left.x).toBeLessThan(100);
  });

  it("honours the head length", () => {
    const [tip, left] = arrowHeadPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(Math.hypot(left.x - tip.x, left.y - tip.y)).toBeCloseTo(20, 10);
  });

  it("produces finite points for a degenerate arrow", () => {
    for (const point of arrowHeadPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 20)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe("appendBrushPoint", () => {
  const points = [{ x: 0, y: 0 }];

  it("drops a sub-threshold point and keeps the same array reference", () => {
    expect(appendBrushPoint(points, { x: 1, y: 0 }, 3)).toBe(points);
  });

  it("appends a supra-threshold point", () => {
    const next = appendBrushPoint(points, { x: 10, y: 0 }, 3);
    expect(next).not.toBe(points);
    expect(next).toHaveLength(2);
  });

  it("always accepts the first point", () => {
    expect(appendBrushPoint([], { x: 0, y: 0 }, 3)).toHaveLength(1);
  });
});

describe("paintShapeHitTest", () => {
  it("hits a brush within tolerance and misses outside it", () => {
    expect(paintShapeHitTest(brush, { x: 50, y: 5 }, 9, sizes)).toBe(true);
    expect(paintShapeHitTest(brush, { x: 50, y: 40 }, 9, sizes)).toBe(false);
  });

  it("hits an arrow along its shaft and around its head", () => {
    expect(paintShapeHitTest(arrow, { x: 100, y: 502 }, 9, sizes)).toBe(true);
    expect(paintShapeHitTest(arrow, { x: 205, y: 505 }, 0, sizes)).toBe(true);
    expect(paintShapeHitTest(arrow, { x: 100, y: 560 }, 9, sizes)).toBe(false);
  });

  it("hits a stamp inside its box", () => {
    expect(paintShapeHitTest(stamp, { x: 1010, y: 1010 }, 0, sizes)).toBe(true);
    expect(paintShapeHitTest(stamp, { x: 1100, y: 1000 }, 0, sizes)).toBe(false);
  });

  it("hits text inside its bounds", () => {
    expect(paintShapeHitTest(text, { x: 2005, y: 1998 }, 0, sizes)).toBe(true);
    expect(paintShapeHitTest(text, { x: 2400, y: 2000 }, 0, sizes)).toBe(false);
  });
});

describe("pickTopPaintShapeAt", () => {
  it("returns the last-drawn shape when shapes overlap", () => {
    const lower: PaintStampShape = { ...stamp, id: "lower" };
    const upper: PaintStampShape = { ...stamp, id: "upper" };
    expect(pickTopPaintShapeAt([lower, upper], { x: 1000, y: 1000 }, 0, sizes)?.id).toBe("upper");
  });

  it("returns null for an empty list or a miss", () => {
    expect(pickTopPaintShapeAt([], { x: 0, y: 0 }, 9, sizes)).toBeNull();
    expect(pickTopPaintShapeAt([stamp], { x: 0, y: 0 }, 9, sizes)).toBeNull();
  });

  it("finds every shape kind", () => {
    const shapes: PaintShape[] = [brush, arrow, stamp, text];
    expect(pickTopPaintShapeAt(shapes, { x: 50, y: 0 }, 9, sizes)?.id).toBe("brush");
    expect(pickTopPaintShapeAt(shapes, { x: 100, y: 500 }, 9, sizes)?.id).toBe("arrow");
    expect(pickTopPaintShapeAt(shapes, { x: 1000, y: 1000 }, 9, sizes)?.id).toBe("stamp");
    expect(pickTopPaintShapeAt(shapes, { x: 2005, y: 1998 }, 9, sizes)?.id).toBe("text");
  });
});

describe("translatePaintShape", () => {
  it("moves every shape kind without mutating the original", () => {
    const movedBrush = translatePaintShape(brush, 10, 20);
    expect(movedBrush.points[0]).toEqual({ x: 10, y: 20 });
    expect(brush.points[0]).toEqual({ x: 0, y: 0 });

    const movedArrow = translatePaintShape(arrow, 10, 20);
    expect(movedArrow.from).toEqual({ x: 10, y: 520 });
    expect(movedArrow.to).toEqual({ x: 210, y: 520 });
    expect(arrow.from).toEqual({ x: 0, y: 500 });

    expect(translatePaintShape(stamp, -5, -5).at).toEqual({ x: 995, y: 995 });
    expect(translatePaintShape(text, 1, 1).at).toEqual({ x: 2001, y: 2001 });
    expect(stamp.at).toEqual({ x: 1000, y: 1000 });
  });
});

describe("paintShapeBounds", () => {
  it("wraps a brush polyline, padded by half its stroke", () => {
    // Stroke width comes from the shape's own slider value, not the fixture.
    const pad = paintEffectiveSizes(brush, sizes).strokeWidth / 2;
    const b = paintShapeBounds(brush, sizes);
    expect(b.x).toBeCloseTo(-pad, 6);
    expect(b.y).toBeCloseTo(-pad, 6);
    expect(b.w).toBeCloseTo(100 + pad * 2, 6);
    expect(b.h).toBeCloseTo(100 + pad * 2, 6);
  });

  it("gives a thicker stroke a bigger box", () => {
    const thin = paintShapeBounds({ ...brush, width: 2 }, sizes);
    const thick = paintShapeBounds({ ...brush, width: 10 }, sizes);
    expect(thick.w).toBeGreaterThan(thin.w);
  });

  it("leaves room for the arrowhead past the shaft", () => {
    const b = paintShapeBounds(arrow, sizes);
    expect(b.x + b.w).toBeGreaterThan(arrow.to.x);
  });

  it("centres a stamp on its point", () => {
    const b = paintShapeBounds(stamp, sizes);
    expect(b.x + b.w / 2).toBeCloseTo(stamp.at.x, 6);
    expect(b.y + b.h / 2).toBeCloseTo(stamp.at.y, 6);
  });

  it("grows with the shape's own resize multiplier", () => {
    const small = paintShapeBounds(stamp, sizes);
    const big = paintShapeBounds({ ...stamp, scale: 3 }, sizes);
    expect(big.w).toBeCloseTo(small.w * 3, 6);
  });
});

describe("pickPaintHandle", () => {
  const bounds = { x: 0, y: 0, w: 100, h: 50 };

  it("returns the opposite corner as the anchor", () => {
    expect(pickPaintHandle(bounds, { x: 0, y: 0 }, 5)?.anchor).toEqual({ x: 100, y: 50 });
    expect(pickPaintHandle(bounds, { x: 100, y: 0 }, 5)?.anchor).toEqual({ x: 0, y: 50 });
    expect(pickPaintHandle(bounds, { x: 100, y: 50 }, 5)?.anchor).toEqual({ x: 0, y: 0 });
    expect(pickPaintHandle(bounds, { x: 0, y: 50 }, 5)?.anchor).toEqual({ x: 100, y: 0 });
  });

  it("respects the grab radius", () => {
    expect(pickPaintHandle(bounds, { x: 4, y: 4 }, 5)).not.toBeNull();
    expect(pickPaintHandle(bounds, { x: 12, y: 12 }, 5)).toBeNull();
  });

  it("misses the middle of the box entirely", () => {
    expect(pickPaintHandle(bounds, { x: 50, y: 25 }, 5)).toBeNull();
  });

  it("never lets the grab radius swallow a small shape's body", () => {
    const small = { x: 0, y: 0, w: 30, h: 30 };
    // A reach far larger than the shape would otherwise cover its centre.
    expect(pickPaintHandle(small, { x: 15, y: 15 }, 500)).toBeNull();
    expect(pickPaintHandle(small, { x: 0, y: 0 }, 500)).not.toBeNull();
  });

  it("orders corners clockwise from top-left", () => {
    expect(paintBoundsCorners(bounds)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]);
  });
});

describe("scalePaintShape", () => {
  const anchor = { x: 0, y: 0 };

  it("scales geometry and the size multiplier together", () => {
    const bigger = scalePaintShape(brush, anchor, 2);
    expect(bigger.scale).toBe(2);
    expect(bigger.points[1]).toEqual({ x: 200, y: 0 });
  });

  it("holds the anchor fixed", () => {
    const bigger = scalePaintShape(stamp, { x: 1000, y: 1000 }, 4);
    expect(bigger.at).toEqual({ x: 1000, y: 1000 });
    const offset = scalePaintShape({ ...stamp, at: { x: 1100, y: 1000 } }, { x: 1000, y: 1000 }, 2);
    expect(offset.at).toEqual({ x: 1200, y: 1000 });
  });

  it("compounds across successive drags", () => {
    const once = scalePaintShape(arrow, anchor, 2);
    const twice = scalePaintShape(once, anchor, 2);
    expect(twice.scale).toBe(4);
    expect(twice.to).toEqual({ x: 800, y: 2000 });
  });

  it("clamps geometry in step with the multiplier at the limits", () => {
    const huge = scalePaintShape(stamp, anchor, 1e6);
    expect(huge.scale).toBe(PAINT_MAX_SHAPE_SCALE);
    expect(huge.at).toEqual({
      x: stamp.at.x * PAINT_MAX_SHAPE_SCALE,
      y: stamp.at.y * PAINT_MAX_SHAPE_SCALE,
    });

    const tiny = scalePaintShape(stamp, anchor, 1e-6);
    expect(tiny.scale).toBe(PAINT_MIN_SHAPE_SCALE);
    expect(tiny.at).toEqual({
      x: stamp.at.x * PAINT_MIN_SHAPE_SCALE,
      y: stamp.at.y * PAINT_MIN_SHAPE_SCALE,
    });
  });

  it("ignores a degenerate factor", () => {
    expect(scalePaintShape(stamp, anchor, 0)).toBe(stamp);
    expect(scalePaintShape(stamp, anchor, Number.NaN)).toBe(stamp);
    expect(scalePaintShape(stamp, anchor, 1)).toBe(stamp);
  });

  it("leaves the original untouched", () => {
    scalePaintShape(brush, anchor, 3);
    expect(brush.points[1]).toEqual({ x: 100, y: 0 });
  });
});

describe("rotatePoint", () => {
  const centre = { x: 100, y: 100 };

  it("turns a point clockwise about the centre", () => {
    const r = rotatePoint({ x: 200, y: 100 }, centre, 90);
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBeCloseTo(200, 6);
  });

  it("is reversible", () => {
    const p = { x: 137, y: 42 };
    const back = rotatePoint(rotatePoint(p, centre, 37), centre, -37);
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it("leaves the centre and a zero angle alone", () => {
    expect(rotatePoint(centre, centre, 123)).toEqual(centre);
    expect(rotatePoint({ x: 5, y: 6 }, centre, 0)).toEqual({ x: 5, y: 6 });
  });
});

describe("rotatePaintShape", () => {
  it("stores a normalised angle without touching geometry", () => {
    const turned = rotatePaintShape(stamp, 450);
    expect(turned.rotation).toBe(90);
    expect(turned.at).toEqual(stamp.at);
    expect(rotatePaintShape(stamp, -90).rotation).toBe(270);
  });
});

describe("toShapeLocalPoint", () => {
  it("maps a rotated pointer back into the shape's own frame", () => {
    const turned = rotatePaintShape(stamp, 90);
    const centre = boundsCentre(paintShapeBounds(turned, sizes));
    const onScreen = rotatePoint({ x: centre.x + 10, y: centre.y }, centre, 90);
    const local = toShapeLocalPoint(turned, onScreen, sizes);
    expect(local.x).toBeCloseTo(centre.x + 10, 6);
    expect(local.y).toBeCloseTo(centre.y, 6);
  });

  it("is a no-op for an unrotated shape", () => {
    expect(toShapeLocalPoint(stamp, { x: 1, y: 2 }, sizes)).toEqual({ x: 1, y: 2 });
  });
});

describe("paintShapeHitTest with rotation", () => {
  // A long thin arrow: a point off its unrotated shaft must only register once
  // the shape has been turned to meet it.
  const thin = { ...arrow, width: 1 };

  it("follows the shape as it turns", () => {
    const centre = boundsCentre(paintShapeBounds(thin, sizes));
    const offAxis = rotatePoint({ x: thin.to.x, y: thin.to.y }, centre, 90);

    expect(paintShapeHitTest(thin, offAxis, 1, sizes)).toBe(false);
    expect(paintShapeHitTest(rotatePaintShape(thin, 90), offAxis, 1, sizes)).toBe(true);
  });
});

describe("scalePaintShape when rotated", () => {
  it("keeps the grabbed anchor pinned on screen", () => {
    const turned = rotatePaintShape({ ...stamp, at: { x: 1000, y: 1000 } }, 37);
    const bounds = paintShapeBounds(turned, sizes);
    const anchor = { x: bounds.x, y: bounds.y };

    const screenBefore = rotatePoint(anchor, boundsCentre(bounds), 37);

    const bigger = scalePaintShape(turned, anchor, 2, sizes);
    // The grabbed corner travels with the shape, so compare where that corner
    // ends up rather than where it used to be.
    const grown = paintShapeBounds(bigger, sizes);
    const screenAfter = rotatePoint({ x: grown.x, y: grown.y }, boundsCentre(grown), 37);

    expect(screenAfter.x).toBeCloseTo(screenBefore.x, 6);
    expect(screenAfter.y).toBeCloseTo(screenBefore.y, 6);
    expect(bigger.scale).toBe(2);
  });
});

describe("paintTextBounds", () => {
  const fontSize = 16;

  it("keeps a short label's box short instead of padding it to a full em", () => {
    const one = paintTextBounds({ ...text, text: "A" }, fontSize);
    expect(one.w).toBeCloseTo(fontSize * PAINT_TEXT_MIN_EM, 6);
    // The old floor made a single character as wide as the font size itself.
    expect(one.w).toBeLessThan(fontSize);
  });

  it("grows a character at a time", () => {
    const four = paintTextBounds({ ...text, text: "hold" }, fontSize);
    const eight = paintTextBounds({ ...text, text: "holdhold" }, fontSize);
    expect(four.w).toBeCloseTo(4 * fontSize * PAINT_TEXT_CHAR_EM, 6);
    expect(eight.w).toBeCloseTo(four.w * 2, 6);
  });

  it("never collapses to nothing for an empty label", () => {
    expect(paintTextBounds({ ...text, text: "" }, fontSize).w).toBeGreaterThan(0);
  });

  it("anchors the box at the label's own point", () => {
    const b = paintTextBounds({ ...text, text: "A" }, fontSize);
    expect(b.x).toBe(text.at.x);
  });
});
