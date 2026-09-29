import { describe, expect, it } from "vitest";

import {
  MAP_ZOOM_WHEEL_FACTOR,
  clampTranslate,
  computeCenteredTransform,
  computeDisplayScale,
  computeFitScale,
  mapToScreen,
  screenToMap,
  viewportTransformStyle,
  zoomAtPoint,
} from "./mapViewportMath";

const viewport = { w: 1000, h: 1000 };
const map = { w: 2000, h: 2000 };

describe("computeFitScale", () => {
  it("fits map width to viewport width", () => {
    expect(computeFitScale(viewport, map)).toBe(0.5);
  });

  it("covers a wide full-bleed viewport using the axis that needs the larger scale", () => {
    // A 1600x800 viewport against a 2000x2000 map: height-fit (0.4) would
    // leave empty space left and right of the map. Width-fit (0.8) is
    // correct — it fills the screen edge to edge, cropping top/bottom, which
    // the user pans to see.
    const wide = { w: 1600, h: 800 };
    expect(computeFitScale(wide, map)).toBe(0.8);
  });

  it("covers a tall full-bleed viewport using the axis that needs the larger scale", () => {
    const tall = { w: 800, h: 1600 };
    expect(computeFitScale(tall, map)).toBe(0.8);
  });

  it("matches width-fit when the viewport is already square, unchanged from before", () => {
    expect(computeFitScale(viewport, map)).toBe(viewport.w / map.w);
  });
});

describe("clampTranslate", () => {
  it("forces translate to zero at user zoom 1", () => {
    const fitScale = computeFitScale(viewport, map);
    const displayScale = computeDisplayScale(fitScale, 1);
    expect(clampTranslate(viewport, map, displayScale, -200, -300)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("cannot pan past edges at zoom 2", () => {
    const fitScale = computeFitScale(viewport, map);
    const displayScale = computeDisplayScale(fitScale, 2);
    const minX = viewport.w - map.w * displayScale;
    const minY = viewport.h - map.h * displayScale;

    expect(
      clampTranslate(viewport, map, displayScale, minX - 100, minY - 100)
    ).toEqual({ x: minX, y: minY });
    expect(
      clampTranslate(viewport, map, displayScale, 100, 100)
    ).toEqual({ x: 0, y: 0 });
  });

  it("cannot pan past edges at zoom 3", () => {
    const fitScale = computeFitScale(viewport, map);
    const displayScale = computeDisplayScale(fitScale, 3);
    const minX = viewport.w - map.w * displayScale;
    const minY = viewport.h - map.h * displayScale;

    expect(clampTranslate(viewport, map, displayScale, minX - 50, 50)).toEqual(
      { x: minX, y: 0 }
    );
  });

  it("cannot pan past edges at max zoom 4.5", () => {
    const fitScale = computeFitScale(viewport, map);
    const displayScale = computeDisplayScale(fitScale, 4.5);
    const minX = viewport.w - map.w * displayScale;

    expect(clampTranslate(viewport, map, displayScale, minX - 25, 0)).toEqual(
      { x: minX, y: 0 }
    );
  });
});

describe("clampTranslate centers a slack axis instead of pinning it to the edge", () => {
  // Cover-fit (the actual fit mode) rarely leaves slack — it exists to
  // guarantee both axes are fully covered. But nothing in clampTranslate
  // itself assumes cover-fit produced displayScale; it must still do the
  // right thing if a caller (or a future fit mode) ever passes a scale that
  // leaves one axis short of the viewport. Constructing displayScale
  // directly here, rather than through computeFitScale, tests that
  // independently of which fit mode is active.
  it("centers a narrower-than-viewport map horizontally instead of pinning it left", () => {
    const wide = { w: 1600, h: 800 };
    const displayScale = 0.3; // displayW = 600, short of the 1600 viewport
    const displayW = map.w * displayScale;

    const result = clampTranslate(wide, map, displayScale, 0, 0);
    expect(result.x).toBe((wide.w - displayW) / 2);
  });

  it("centers a shorter-than-viewport map vertically instead of pinning it to the top", () => {
    const tall = { w: 800, h: 1600 };
    const displayScale = 0.3; // displayH = 600, short of the 1600 viewport
    const displayH = map.h * displayScale;

    const result = clampTranslate(tall, map, displayScale, 0, 0);
    expect(result.y).toBe((tall.h - displayH) / 2);
  });

  it("still clamps to the edges once the map is at least as large as the viewport", () => {
    const wide = { w: 1600, h: 800 };
    const displayScale = 0.8; // displayW = 1600, exactly covers the viewport
    const minX = wide.w - map.w * displayScale;

    expect(clampTranslate(wide, map, displayScale, 100, 0)).toEqual({
      x: 0,
      y: 0,
    });
    expect(clampTranslate(wide, map, displayScale, minX - 100, 0)).toEqual({
      x: minX,
      y: 0,
    });
  });
});

describe("computeCenteredTransform", () => {
  it("centers the overflowing axis vertically instead of pinning it to the top", () => {
    // Cover-fit on a wide viewport: width matches exactly, height overflows.
    const wide = { w: 1600, h: 800 };
    const result = computeCenteredTransform(wide, map);

    const displayScale = computeFitScale(wide, map);
    const minY = wide.h - map.h * displayScale;
    expect(result.translateY).toBeCloseTo(minY / 2, 5);
    expect(result.translateY).not.toBe(0); // not pinned to the top edge
  });

  it("centers the overflowing axis horizontally on a tall viewport", () => {
    const tall = { w: 800, h: 1600 };
    const result = computeCenteredTransform(tall, map);

    const displayScale = computeFitScale(tall, map);
    const minX = tall.w - map.w * displayScale;
    expect(result.translateX).toBeCloseTo(minX / 2, 5);
    expect(result.translateX).not.toBe(0);
  });

  it("still centers the slack axis when the viewport already matches the map's aspect ratio", () => {
    const result = computeCenteredTransform(viewport, map);
    expect(result).toEqual({ userScale: 1, translateX: 0, translateY: 0 });
  });

  it("respects a non-default starting user scale", () => {
    const wide = { w: 1600, h: 800 };
    const result = computeCenteredTransform(wide, map, 2);
    expect(result.userScale).toBe(2);

    const displayScale = computeDisplayScale(computeFitScale(wide, map), 2);
    const minY = wide.h - map.h * displayScale;
    expect(result.translateY).toBeCloseTo(minY / 2, 5);
  });
});

describe("screenToMap / mapToScreen", () => {
  it("round-trips through forward and inverse transforms", () => {
    const displayScale = 0.75;
    const translate = { x: -120, y: -80 };
    const mapPoint = { x: 640, y: 512 };

    const screen = mapToScreen(mapPoint.x, mapPoint.y, displayScale, translate);
    const back = screenToMap(screen.x, screen.y, displayScale, translate);

    expect(back.x).toBeCloseTo(mapPoint.x, 5);
    expect(back.y).toBeCloseTo(mapPoint.y, 5);
  });
});

describe("zoomAtPoint", () => {
  it("keeps the map point under the cursor stable across one zoom step", () => {
    const fitScale = computeFitScale(viewport, map);
    const start = { userScale: 1, translateX: 0, translateY: 0 };
    const cursor = { x: 400, y: 600 };
    const displayScale = computeDisplayScale(fitScale, start.userScale);
    const before = screenToMap(cursor.x, cursor.y, displayScale, {
      x: start.translateX,
      y: start.translateY,
    });

    const next = zoomAtPoint(viewport, map, start, cursor, -1);
    const nextDisplayScale = computeDisplayScale(fitScale, next.userScale);
    const after = screenToMap(cursor.x, cursor.y, nextDisplayScale, {
      x: next.translateX,
      y: next.translateY,
    });

    expect(next.userScale).toBeCloseTo(MAP_ZOOM_WHEEL_FACTOR, 5);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it("leaves the transform unchanged for a zero vertical delta", () => {
    const start = { userScale: 2, translateX: -100, translateY: -50 };
    const next = zoomAtPoint(viewport, map, start, { x: 400, y: 600 }, 0);

    expect(next).toEqual(start);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "leaves the transform unchanged for a non-finite delta (%s)",
    (wheelDelta) => {
      const start = { userScale: 2, translateX: -100, translateY: -50 };
      const next = zoomAtPoint(
        viewport,
        map,
        start,
        { x: 400, y: 600 },
        wheelDelta
      );

      expect(next).toEqual(start);
    }
  );
});

describe("viewportTransformStyle", () => {
  it("emits translate then scale for transform-origin 0 0", () => {
    expect(viewportTransformStyle(0.5, -10, 20)).toBe(
      "translate(-10px, 20px) scale(0.5)"
    );
  });
});
