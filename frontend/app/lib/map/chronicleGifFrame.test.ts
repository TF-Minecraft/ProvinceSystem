import { describe, expect, it } from "vitest";

import {
  CHRONICLE_GIF_SIZES,
  CHRONICLE_WATERMARK_CORNERS,
  DEFAULT_CHRONICLE_GIF_SIZE,
  MIN_GIF_LABEL_FONT_PX,
  MIN_GIF_MARKER_FONT_PX,
  MIN_GIF_MARKER_ICON_PX,
  MIN_GIF_DELAY_MS,
  chronicleGifDelayMs,
  chronicleGifFilename,
  chronicleGifLabelLayout,
  chronicleGifMapX,
  chronicleGifMapY,
  chronicleGifMarkerLayout,
  chronicleGifTransform,
  chronicleWatermarkLayout,
} from "./chronicleGifFrame";
import type { NationLabelSpec } from "../mapLabels";
import type { MapMarker } from "../mapMarkers";

const MAP = 6400;

function marker(overrides: Partial<MapMarker> = {}): MapMarker {
  return {
    id: "m1",
    kind: "settlement",
    markerSize: "small",
    mapX: 3200,
    mapY: 3200,
    label: "Harbourwatch",
    title: "Harbourwatch",
    ...overrides,
  };
}

function label(overrides: Partial<NationLabelSpec> = {}): NationLabelSpec {
  return {
    nationId: "N1",
    componentIndex: 0,
    text: "Adavaar",
    scope: "nation" as NationLabelSpec["scope"],
    x1: 3000,
    y1: 3200,
    x2: 3400,
    y2: 3200,
    cx: 3200,
    cy: 3200,
    angleDeg: 0,
    segmentPx: 400,
    fontSize: 200,
    pathD: "M 3000 3200 L 3400 3200",
    pathOffsetX: 0,
    pathOffsetY: 0,
    ...overrides,
  };
}

describe("chronicleGifTransform", () => {
  it("maps a square map edge to edge with no letterbox", () => {
    const t = chronicleGifTransform(MAP, MAP, 720);
    expect(t.scale).toBeCloseTo(720 / MAP);
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBe(0);
    expect(chronicleGifMapX(t, 0)).toBe(0);
    expect(chronicleGifMapX(t, MAP)).toBeCloseTo(720);
    expect(chronicleGifMapY(t, MAP / 2)).toBeCloseTo(360);
  });

  it("letterboxes a non-square map instead of stretching it", () => {
    const t = chronicleGifTransform(1000, 500, 500);
    expect(t.scale).toBeCloseTo(0.5);
    expect(t.drawWidth).toBeCloseTo(500);
    expect(t.drawHeight).toBeCloseTo(250);
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBeCloseTo(125);
    // Both bars are equal, so the map stays centred.
    expect(t.offsetY * 2 + t.drawHeight).toBeCloseTo(500);
  });

  it("falls back to the export edge for a map that never reported a size", () => {
    const t = chronicleGifTransform(0, 0, 480);
    expect(t.size).toBe(480);
    expect(t.scale).toBe(1);
    expect(Number.isFinite(t.offsetX)).toBe(true);
  });

  it("never produces a non-finite transform from junk input", () => {
    const t = chronicleGifTransform(Number.NaN, Number.NaN, Number.NaN);
    expect(t.size).toBe(DEFAULT_CHRONICLE_GIF_SIZE);
    for (const value of [t.scale, t.offsetX, t.offsetY, t.drawWidth]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("chronicleGifMarkerLayout", () => {
  it("centres the icon on the pin's map point", () => {
    const t = chronicleGifTransform(MAP, MAP, 1080);
    const layout = chronicleGifMarkerLayout(t, marker())!;
    expect(layout.iconX + layout.iconSize / 2).toBeCloseTo(540);
    expect(layout.iconY + layout.iconSize / 2).toBeCloseTo(540);
  });

  it("draws a large settlement icon at 90 map pixels", () => {
    const t = chronicleGifTransform(MAP, MAP, 1080);
    const small = chronicleGifMarkerLayout(t, marker())!;
    const large = chronicleGifMarkerLayout(
      t,
      marker({ markerSize: "large" })
    )!;
    expect(large.iconSize).toBeCloseTo(small.iconSize * (90 / 100));
    expect(large.fontSize).toBeGreaterThan(small.fontSize);
  });

  it("shrinks an installation icon the way the live map does", () => {
    const t = chronicleGifTransform(MAP, MAP, 1080);
    const town = chronicleGifMarkerLayout(t, marker())!;
    const fort = chronicleGifMarkerLayout(t, marker({ kind: "fort" }))!;
    expect(fort.iconSize).toBeLessThan(town.iconSize);
    // Still centred on the same point despite the smaller icon.
    expect(fort.iconX + fort.iconSize / 2).toBeCloseTo(town.iconX + town.iconSize / 2);
  });

  it("floors the icon and the name so a 480 export stays legible", () => {
    const t = chronicleGifTransform(MAP, MAP, 480);
    // 75 map px of fort icon at 480/6400 is 5.6 px, and its 48-px name is 3.6.
    const layout = chronicleGifMarkerLayout(t, marker({ kind: "fort" }))!;
    expect(layout.iconSize).toBe(MIN_GIF_MARKER_ICON_PX);
    expect(layout.fontSize).toBe(MIN_GIF_MARKER_FONT_PX);
  });

  it("puts the name below the icon, never over it", () => {
    const t = chronicleGifTransform(MAP, MAP, 1080);
    const layout = chronicleGifMarkerLayout(t, marker())!;
    expect(layout.labelBaselineY).toBeGreaterThan(layout.iconY + layout.iconSize);
    expect(layout.labelCenterX).toBeCloseTo(layout.iconX + layout.iconSize / 2);
  });

  it("rejects a pin with non-finite coordinates rather than drawing NaN", () => {
    const t = chronicleGifTransform(MAP, MAP, 720);
    expect(chronicleGifMarkerLayout(t, marker({ mapX: Number.NaN }))).toBeNull();
    expect(
      chronicleGifMarkerLayout(t, marker({ mapY: undefined as unknown as number }))
    ).toBeNull();
  });
});

describe("chronicleGifLabelLayout", () => {
  it("places the name at the chord centre in export pixels", () => {
    const t = chronicleGifTransform(MAP, MAP, 720);
    const layout = chronicleGifLabelLayout(t, label())!;
    expect(layout.centerX).toBeCloseTo(360);
    expect(layout.centerY).toBeCloseTo(360);
    expect(layout.fontSize).toBeCloseTo(200 * (720 / MAP));
    expect(layout.angleRad).toBeCloseTo(0);
  });

  it("converts the chord angle to radians", () => {
    const t = chronicleGifTransform(MAP, MAP, 720);
    const layout = chronicleGifLabelLayout(t, label({ angleDeg: 90 }))!;
    expect(layout.angleRad).toBeCloseTo(Math.PI / 2);
  });

  it("drops a name too small to survive colour quantisation", () => {
    const t = chronicleGifTransform(MAP, MAP, 480);
    // 40 map px at 480/6400 is 3 export px, under the floor.
    expect(chronicleGifLabelLayout(t, label({ fontSize: 40 }))).toBeNull();
    const kept = chronicleGifLabelLayout(t, label({ fontSize: 400 }))!;
    expect(kept.fontSize).toBeGreaterThanOrEqual(MIN_GIF_LABEL_FONT_PX);
  });

  it("rejects an empty or malformed label", () => {
    const t = chronicleGifTransform(MAP, MAP, 720);
    expect(chronicleGifLabelLayout(t, label({ text: "" }))).toBeNull();
    expect(chronicleGifLabelLayout(t, label({ cx: Number.NaN }))).toBeNull();
    expect(chronicleGifLabelLayout(t, label({ fontSize: Number.NaN }))).toBeNull();
  });
});

describe("chronicleWatermarkLayout", () => {
  it("sits in the bottom-left corner at every export size", () => {
    for (const size of CHRONICLE_GIF_SIZES) {
      const w = chronicleWatermarkLayout(size, 120);
      expect(w.logoX).toBeGreaterThan(0);
      expect(w.logoY + w.logoSize).toBeLessThan(size);
      // Bottom-left means below the midline and left of it.
      expect(w.logoY).toBeGreaterThan(size / 2);
      expect(w.logoX + w.logoSize).toBeLessThan(size / 2);
    }
  });

  it("keeps the whole scrim inside the canvas", () => {
    for (const size of CHRONICLE_GIF_SIZES) {
      const w = chronicleWatermarkLayout(size, size);
      expect(w.scrim.x).toBeGreaterThanOrEqual(0);
      expect(w.scrim.y).toBeGreaterThanOrEqual(0);
      expect(w.scrim.x + w.scrim.width).toBeLessThanOrEqual(size);
      expect(w.scrim.y + w.scrim.height).toBeLessThanOrEqual(size);
    }
  });

  it("grows with the export but never dominates it", () => {
    const small = chronicleWatermarkLayout(480, 100);
    const large = chronicleWatermarkLayout(1080, 220);
    expect(large.logoSize).toBeGreaterThan(small.logoSize);
    expect(large.fontSize).toBeGreaterThan(small.fontSize);
    // Readable at the small end, restrained at the large end.
    expect(small.fontSize).toBeGreaterThanOrEqual(13);
    expect(large.logoSize / 1080).toBeLessThan(0.12);
    expect(small.logoSize / 480).toBeLessThan(0.15);
  });

  it("puts the text beside the logo, vertically inside it", () => {
    const w = chronicleWatermarkLayout(720, 140);
    expect(w.textX).toBeGreaterThan(w.logoX + w.logoSize);
    expect(w.textBaselineY).toBeGreaterThan(w.logoY);
    expect(w.textBaselineY).toBeLessThan(w.logoY + w.logoSize);
  });

  it("still boxes the logo when nothing has been measured yet", () => {
    const w = chronicleWatermarkLayout(720, 0);
    expect(w.scrim.width).toBeGreaterThan(w.logoSize);
    expect(w.scrim.height).toBeGreaterThan(0);
  });

  it("survives a junk size", () => {
    const w = chronicleWatermarkLayout(Number.NaN, Number.NaN);
    for (const value of [w.logoX, w.logoY, w.logoSize, w.fontSize, w.textX]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("omits the date line and matches the link-only box when dateWidth is absent", () => {
    for (const size of CHRONICLE_GIF_SIZES) {
      const withoutArg = chronicleWatermarkLayout(size, 120);
      const withNull = chronicleWatermarkLayout(size, 120, null);
      expect(withoutArg.date).toBeNull();
      expect(withNull.date).toBeNull();
      expect(withNull).toEqual(withoutArg);
    }
  });

  it("adds a date line directly below the link, sharing its left edge", () => {
    for (const size of CHRONICLE_GIF_SIZES) {
      const w = chronicleWatermarkLayout(size, 120, 90);
      expect(w.date).not.toBeNull();
      expect(w.date!.textX).toBe(w.textX);
      expect(w.date!.textBaselineY).toBeGreaterThan(w.textBaselineY);
      // Visually subordinate: same family (caller's job), never larger.
      expect(w.date!.fontSize).toBeLessThanOrEqual(w.fontSize);
    }
  });

  it("stacks the date under the link beside the logo without growing the box", () => {
    for (const size of CHRONICLE_GIF_SIZES) {
      const linkOnly = chronicleWatermarkLayout(size, 120, null);
      const withDate = chronicleWatermarkLayout(size, 120, 90);

      // The two lines are one text column to the RIGHT of the logo — the date
      // hangs off the link's baseline, not off the logo's bottom edge. Getting
      // this wrong is what once pushed the date away from the link and
      // stretched the scrim, so pin the spacing, not just the ordering.
      expect(withDate.date!.textX).toBe(withDate.textX);
      expect(withDate.textX).toBeGreaterThanOrEqual(
        withDate.logoX + withDate.logoSize
      );
      const lineSpacing = withDate.date!.textBaselineY - withDate.textBaselineY;
      expect(lineSpacing).toBeGreaterThan(0);
      // One line's worth of leading, not a logo's height of dead space.
      expect(lineSpacing).toBeLessThanOrEqual(
        withDate.date!.fontSize + withDate.fontSize * 0.5
      );

      // The logo out-measures the two-line stack at every real export size, so
      // the row — and therefore the scrim — is exactly as tall either way.
      expect(withDate.scrim.height).toBe(linkOnly.scrim.height);
      expect(withDate.scrim.y).toBe(linkOnly.scrim.y);

      // Bottom margin above the canvas edge is untouched.
      expect(size - (withDate.logoY + withDate.logoSize)).toBeCloseTo(
        size - (linkOnly.logoY + linkOnly.logoSize),
        0
      );
    }
  });

  it("keeps the grown scrim inside the canvas at every export size", () => {
    for (const size of CHRONICLE_GIF_SIZES) {
      const w = chronicleWatermarkLayout(size, size * 0.3, size * 0.22);
      expect(w.scrim.x).toBeGreaterThanOrEqual(0);
      expect(w.scrim.y).toBeGreaterThanOrEqual(0);
      expect(w.scrim.x + w.scrim.width).toBeLessThanOrEqual(size);
      expect(w.scrim.y + w.scrim.height).toBeLessThanOrEqual(size);
    }
  });

  it("widens the scrim to fit whichever line is longer", () => {
    const narrowerDate = chronicleWatermarkLayout(720, 200, 40);
    const widerDate = chronicleWatermarkLayout(720, 40, 200);
    // Both boxes must be wide enough for their own widest line.
    expect(narrowerDate.scrim.width).toBeGreaterThanOrEqual(
      narrowerDate.textX + 200 - narrowerDate.scrim.x - 1
    );
    expect(widerDate.scrim.width).toBeGreaterThanOrEqual(
      widerDate.textX + 200 - widerDate.scrim.x - 1
    );
  });

  it("survives a junk size and a junk date width", () => {
    const w = chronicleWatermarkLayout(Number.NaN, Number.NaN, Number.NaN);
    expect(w.date).not.toBeNull();
    for (const value of [
      w.date!.fontSize,
      w.date!.textX,
      w.date!.textBaselineY,
      w.date!.haloWidth,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("sits bottom-left unless told otherwise", () => {
    for (const size of CHRONICLE_GIF_SIZES) {
      expect(chronicleWatermarkLayout(size, 120, 90, "bottom-left")).toEqual(
        chronicleWatermarkLayout(size, 120, 90)
      );
    }
  });

  it("keeps the same margins from the edges of whichever corner it is moved to", () => {
    for (const size of CHRONICLE_GIF_SIZES) {
      for (const dateWidth of [null, 90]) {
        const home = chronicleWatermarkLayout(size, 160, dateWidth);
        const side = home.scrim.x;
        const foot = size - (home.scrim.y + home.scrim.height);
        for (const corner of CHRONICLE_WATERMARK_CORNERS.map((c) => c.value)) {
          const w = chronicleWatermarkLayout(size, 160, dateWidth, corner);
          expect(w.scrim.width).toBe(home.scrim.width);
          expect(w.scrim.height).toBe(home.scrim.height);
          if (corner.endsWith("left")) expect(w.scrim.x).toBeCloseTo(side, 6);
          else expect(size - (w.scrim.x + w.scrim.width)).toBeCloseTo(side, 6);
          if (corner.startsWith("bottom")) {
            expect(size - (w.scrim.y + w.scrim.height)).toBeCloseTo(foot, 6);
          } else {
            expect(w.scrim.y).toBeCloseTo(foot, 6);
          }
        }
      }
    }
  });

  it("moves the logo, the link and the date with the box", () => {
    const home = chronicleWatermarkLayout(720, 160, 90);
    const moved = chronicleWatermarkLayout(720, 160, 90, "top-right");
    const dx = moved.scrim.x - home.scrim.x;
    const dy = moved.scrim.y - home.scrim.y;
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeLessThan(0);
    expect(moved.logoX - home.logoX).toBe(dx);
    expect(moved.logoY - home.logoY).toBe(dy);
    expect(moved.textX - home.textX).toBe(dx);
    expect(moved.textBaselineY - home.textBaselineY).toBe(dy);
    expect(moved.date!.textX - home.date!.textX).toBe(dx);
    expect(moved.date!.textBaselineY - home.date!.textBaselineY).toBe(dy);
    expect(moved.logoSize).toBe(home.logoSize);
  });
});

describe("chronicleGifDelayMs", () => {
  it("turns days-per-second into a GIF delay", () => {
    expect(chronicleGifDelayMs(1)).toBe(1000);
    expect(chronicleGifDelayMs(2)).toBe(500);
    expect(chronicleGifDelayMs(4)).toBe(250);
    expect(chronicleGifDelayMs(8)).toBe(130); // 125 ms rounded to the 10 ms quantum
  });

  it("clamps to the fastest delay decoders actually honour", () => {
    expect(chronicleGifDelayMs(16)).toBeGreaterThanOrEqual(MIN_GIF_DELAY_MS);
    expect(chronicleGifDelayMs(1000)).toBe(MIN_GIF_DELAY_MS);
  });

  it("always lands on a whole 10 ms unit", () => {
    for (const speed of [1, 2, 3, 4, 7, 8, 16]) {
      expect(chronicleGifDelayMs(speed) % 10).toBe(0);
    }
  });

  it("does not divide by zero or by junk", () => {
    expect(chronicleGifDelayMs(0)).toBe(1000);
    expect(chronicleGifDelayMs(-4)).toBe(1000);
    expect(chronicleGifDelayMs(Number.NaN)).toBe(1000);
  });
});

describe("chronicleGifFilename", () => {
  it("names the file after the map and the span it covers", () => {
    expect(chronicleGifFilename("Adavaar", "2026-08-15", "2026-08-26")).toBe(
      "adavaar-timelapse-2026-08-15-to-2026-08-26.gif"
    );
  });

  it("collapses a single-day export", () => {
    expect(chronicleGifFilename("Adavaar", "2026-08-15", "2026-08-15")).toBe(
      "adavaar-timelapse-2026-08-15.gif"
    );
  });

  it("strips anything a filesystem would reject", () => {
    expect(chronicleGifFilename("R3b1rth / Dev", "2026-08-15", "2026-08-16")).toBe(
      "r3b1rth-dev-timelapse-2026-08-15-to-2026-08-16.gif"
    );
    expect(chronicleGifFilename("", null, null)).toBe("map-timelapse.gif");
  });
});
