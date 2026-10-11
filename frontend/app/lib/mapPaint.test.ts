import { describe, expect, it } from "vitest";

import {
  PAINT_COLORS,
  PAINT_INK_BACKING,
  PAINT_REFERENCE_SCALE,
  PAINT_STAMP_SCREEN_PX,
  PAINT_WIDTH_DEFAULT,
  PAINT_WIDTH_MAX,
  PAINT_WIDTH_MIN,
  PAINT_TEXT_STYLE_DEFAULT,
  clampPaintBgOpacity,
  clampPaintWidth,
  paintTextBgColor,
  paintTextCss,
  paintTextStyleOf,
  isPaintShape,
  paintMapPx,
  paintSizesMapPx,
  paintStampSrc,
  paintStrokeStyle,
  type PaintShape,
  type PaintTextShape,
} from "./mapPaint";

const label: PaintTextShape = {
  id: "t",
  type: "text",
  color: "note",
  width: 4,
  createdAt: 1,
  at: { x: 0, y: 0 },
  text: "hold",
};

const brush: PaintShape = {
  id: "a",
  type: "brush",
  color: "attack",
  width: 4,
  createdAt: 1,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
};

describe("paintMapPx", () => {
  it("converts a reference screen size into a fixed map-pixel size", () => {
    expect(paintMapPx(PAINT_REFERENCE_SCALE)).toBe(1);
    expect(paintMapPx(4)).toBeCloseTo(4 / PAINT_REFERENCE_SCALE, 10);
  });

  it("does not depend on the current zoom level", () => {
    // Painted content is ink on the map: its map-space size is fixed, so it
    // grows on screen when zoomed in and shrinks when zoomed out.
    expect(paintMapPx(4)).toBe(paintMapPx(4));
    expect(paintMapPx(0)).toBe(0);
  });
});

describe("paintStrokeStyle", () => {
  it("converts the slider value straight into a map-pixel stroke", () => {
    expect(paintStrokeStyle(4, "attack").strokeWidth).toBeCloseTo(4 / PAINT_REFERENCE_SCALE, 10);
  });

  it("grows continuously with the slider and keeps a wider backing", () => {
    const thin = paintStrokeStyle(2, "attack");
    const thick = paintStrokeStyle(7, "attack");
    expect(thin.strokeWidth).toBeLessThan(thick.strokeWidth);
    expect(thin.backingWidth).toBeGreaterThan(thin.strokeWidth);
    expect(thin.stroke).toBe(PAINT_COLORS.attack);
  });

  it("clamps a width outside the slider's range", () => {
    expect(paintStrokeStyle(1e6, "attack").strokeWidth).toBeCloseTo(PAINT_WIDTH_MAX / PAINT_REFERENCE_SCALE, 10);
    expect(paintStrokeStyle(0, "attack").strokeWidth).toBeCloseTo(PAINT_WIDTH_MIN / PAINT_REFERENCE_SCALE, 10);
  });

  it("dashes drawn strokes, which is what separates them from real map lines", () => {
    const dashes = paintStrokeStyle(4, "warning").dashArray.split(" ").map(Number);
    expect(dashes).toHaveLength(2);
    expect(dashes.every((d) => d > 0)).toBe(true);
  });

  it("scales stroke and backing with the shape's resize multiplier", () => {
    const plain = paintStrokeStyle(4, "warning");
    const doubled = paintStrokeStyle(4, "warning", 2);
    expect(doubled.strokeWidth).toBeCloseTo(plain.strokeWidth * 2, 10);
    expect(doubled.backingWidth).toBeCloseTo(plain.backingWidth * 2, 10);
  });
});

describe("clampPaintWidth", () => {
  it("keeps the slider inside its own range", () => {
    expect(clampPaintWidth(PAINT_WIDTH_MIN - 5)).toBe(PAINT_WIDTH_MIN);
    expect(clampPaintWidth(PAINT_WIDTH_MAX + 5)).toBe(PAINT_WIDTH_MAX);
    expect(clampPaintWidth(4)).toBe(4);
  });

  it("falls back to the default for a non-number", () => {
    expect(clampPaintWidth(Number.NaN)).toBe(PAINT_WIDTH_DEFAULT);
  });
});

describe("paintSizesMapPx", () => {
  it("exposes fixed map-pixel dimensions", () => {
    const sizes = paintSizesMapPx();
    expect(sizes.stamp).toBeCloseTo(PAINT_STAMP_SCREEN_PX / PAINT_REFERENCE_SCALE, 10);
    expect(sizes.arrowHead).toBeGreaterThan(0);
  });

  it("is stable across calls, so geometry and rendering agree", () => {
    expect(paintSizesMapPx()).toBe(paintSizesMapPx());
  });
});

describe("paintStampSrc", () => {
  it("maps an icon id to its public asset", () => {
    expect(paintStampSrc("raid")).toBe("/raid.png");
    expect(paintStampSrc("wood_ship_large")).toBe("/wood_ship_large.png");
  });
});

describe("isPaintShape", () => {
  it("accepts each valid shape kind", () => {
    expect(isPaintShape(brush)).toBe(true);
    expect(
      isPaintShape({
        id: "b",
        type: "arrow",
        color: "friendly",
        width: 2,
        createdAt: 2,
        from: { x: 0, y: 0 },
        to: { x: 5, y: 5 },
      }),
    ).toBe(true);
    expect(
      isPaintShape({
        id: "c",
        type: "stamp",
        color: "warning",
        createdAt: 3,
        icon: "port",
        at: { x: 1, y: 2 },
      }),
    ).toBe(true);
    expect(
      isPaintShape({
        id: "d",
        type: "text",
        color: "note",
        width: 4,
        createdAt: 4,
        at: { x: 1, y: 2 },
        text: "2nd army",
      }),
    ).toBe(true);
  });

  it("rejects malformed shapes", () => {
    expect(isPaintShape(null)).toBe(false);
    expect(isPaintShape({ ...brush, color: "hotpink" })).toBe(false);
    expect(isPaintShape({ ...brush, width: "medium" })).toBe(false);
    expect(isPaintShape({ ...brush, width: 0 })).toBe(false);
    expect(isPaintShape({ ...brush, points: [] })).toBe(false);
    expect(isPaintShape({ ...brush, points: [{ x: 0, y: Number.NaN }] })).toBe(false);
    expect(isPaintShape({ ...brush, type: "spline" })).toBe(false);
    expect(isPaintShape({ ...brush, id: "" })).toBe(false);
    expect(
      isPaintShape({
        id: "e",
        type: "stamp",
        color: "attack",
        createdAt: 5,
        icon: "not_an_icon",
        at: { x: 0, y: 0 },
      }),
    ).toBe(false);
  });
});

describe("paintTextStyleOf", () => {
  it("falls back to the defaults for a label saved before styling existed", () => {
    expect(paintTextStyleOf(label)).toEqual(PAINT_TEXT_STYLE_DEFAULT);
  });

  it("honours the fields a label does set", () => {
    const styled = paintTextStyleOf({
      ...label,
      font: "serif",
      italic: true,
      bgOpacity: 0.5,
    });
    expect(styled.font).toBe("serif");
    expect(styled.italic).toBe(true);
    expect(styled.bgOpacity).toBe(0.5);
    // Untouched fields still come from the defaults.
    expect(styled.bold).toBe(PAINT_TEXT_STYLE_DEFAULT.bold);
  });

  it("ignores an unknown font and clamps a silly opacity", () => {
    const styled = paintTextStyleOf({
      ...label,
      font: "comic" as never,
      bgOpacity: 99,
    });
    expect(styled.font).toBe(PAINT_TEXT_STYLE_DEFAULT.font);
    expect(styled.bgOpacity).toBe(clampPaintBgOpacity(99));
  });
});

describe("paintTextCss", () => {
  it("maps the marks onto CSS", () => {
    const css = paintTextCss({
      font: "mono",
      bgColor: "ink",
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      bgOpacity: 0,
    });
    expect(css.fontWeight).toBe(700);
    expect(css.fontStyle).toBe("italic");
    expect(css.textDecoration).toBe("underline line-through");
    expect(css.fontFamily).toContain("monospace");
  });

  it("emits no decoration when neither mark is set", () => {
    const css = paintTextCss({ ...PAINT_TEXT_STYLE_DEFAULT, underline: false, strike: false });
    expect(css.textDecoration).toBe("none");
    expect(css.fontStyle).toBe("normal");
  });
});

describe("isPaintShape with label styling", () => {
  it("accepts a fully styled label", () => {
    expect(
      isPaintShape({
        ...label,
        font: "serif",
        bold: false,
        italic: true,
        underline: true,
        strike: false,
        bgOpacity: 0.4,
      }),
    ).toBe(true);
  });

  it("rejects a bad font, a non-boolean mark or a non-numeric opacity", () => {
    expect(isPaintShape({ ...label, font: "comic" })).toBe(false);
    expect(isPaintShape({ ...label, bold: "yes" })).toBe(false);
    expect(isPaintShape({ ...label, bgOpacity: "half" })).toBe(false);
  });
});

describe("paintTextBgColor", () => {
  it("tracks the label's own ink by default", () => {
    expect(paintTextBgColor("ink", "attack")).toBe(PAINT_COLORS.attack);
    expect(paintTextBgColor("ink", "naval")).toBe(PAINT_COLORS.naval);
  });

  it("supports a fixed palette colour independent of the ink", () => {
    expect(paintTextBgColor("naval", "attack")).toBe(PAINT_COLORS.naval);
  });

  it("uses the backing colour for the dark plate", () => {
    expect(paintTextBgColor("dark", "attack")).toBe(PAINT_INK_BACKING);
  });
});

describe("paintTextStyleOf plate colour", () => {
  it("defaults to matching the ink", () => {
    expect(paintTextStyleOf(label).bgColor).toBe("ink");
  });

  it("keeps a valid choice and rejects a bogus one", () => {
    expect(paintTextStyleOf({ ...label, bgColor: "dark" }).bgColor).toBe("dark");
    expect(paintTextStyleOf({ ...label, bgColor: "chartreuse" as never }).bgColor).toBe("ink");
  });

  it("is validated by the storage guard", () => {
    expect(isPaintShape({ ...label, bgColor: "warning" })).toBe(true);
    expect(isPaintShape({ ...label, bgColor: "chartreuse" })).toBe(false);
  });
});

describe("isPaintShape with a mirrored object", () => {
  const placed = {
    id: "s",
    type: "stamp" as const,
    color: "attack" as const,
    createdAt: 1,
    icon: "wood_ship_large" as const,
    at: { x: 10, y: 20 },
  };

  it("accepts a stamp with or without the mirror flag", () => {
    expect(isPaintShape(placed)).toBe(true);
    expect(isPaintShape({ ...placed, flipX: true })).toBe(true);
    expect(isPaintShape({ ...placed, flipX: false })).toBe(true);
  });

  it("rejects a non-boolean mirror flag", () => {
    expect(isPaintShape({ ...placed, flipX: "yes" })).toBe(false);
    expect(isPaintShape({ ...placed, flipX: 1 })).toBe(false);
  });
});
