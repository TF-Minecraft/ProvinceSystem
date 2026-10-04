import { describe, expect, it } from "vitest";

import {
  PAINT_MAX_BRUSH_POINTS,
  PAINT_WIDTH_MAX,
  type PaintBrushShape,
  type PaintShape,
  type PaintStampShape,
} from "./mapPaint";
import {
  PAINT_STORAGE_VERSION,
  isUnreadablePaintDocument,
  paintStorageKey,
  exportPaintDocument,
  importPaintDocument,
  paintExportFilename,
  parsePaintDocument,
  serializePaintDocument,
} from "./mapPaintStorage";

const stamp: PaintStampShape = {
  id: "stamp",
  type: "stamp",
  color: "attack",
  createdAt: 1,
  icon: "raid",
  at: { x: 10, y: 20 },
};

const brush: PaintBrushShape = {
  id: "brush",
  type: "brush",
  color: "warning",
  width: 4,
  createdAt: 2,
  points: [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
  ],
};

describe("paintStorageKey", () => {
  it("namespaces per map, alongside the existing panel keys", () => {
    expect(paintStorageKey("main")).toBe(`tfmc-map-paint-v${PAINT_STORAGE_VERSION}:main`);
    expect(paintStorageKey("dev")).not.toBe(paintStorageKey("main"));
  });
});

describe("parsePaintDocument", () => {
  it("round-trips a serialized plan", () => {
    const shapes: PaintShape[] = [stamp, brush];
    expect(parsePaintDocument(serializePaintDocument("main", shapes))).toEqual(shapes);
  });

  it("returns nothing for missing or malformed input", () => {
    expect(parsePaintDocument(null)).toEqual([]);
    expect(parsePaintDocument("")).toEqual([]);
    expect(parsePaintDocument("{")).toEqual([]);
    expect(parsePaintDocument("[]")).toEqual([]);
  });

  it("refuses a document from a future version", () => {
    const raw = JSON.stringify({ version: 2, mapId: "main", updatedAt: 0, shapes: [stamp] });
    expect(parsePaintDocument(raw)).toEqual([]);
    expect(isUnreadablePaintDocument(raw)).toBe(true);
  });

  it("returns nothing when shapes is not an array", () => {
    const raw = JSON.stringify({
      version: PAINT_STORAGE_VERSION,
      mapId: "main",
      updatedAt: 0,
      shapes: {},
    });
    expect(parsePaintDocument(raw)).toEqual([]);
  });

  it("drops a corrupt shape but keeps the rest of the plan", () => {
    const raw = JSON.stringify({
      version: PAINT_STORAGE_VERSION,
      mapId: "main",
      updatedAt: 0,
      shapes: [stamp, { ...brush, points: "nope" }],
    });
    expect(parsePaintDocument(raw)).toEqual([stamp]);
  });

  it("normalises saved named stroke widths to slider numbers", () => {
    const raw = JSON.stringify({
      version: PAINT_STORAGE_VERSION,
      mapId: "main",
      updatedAt: 0,
      shapes: [
        { ...brush, width: "thin" },
        { ...brush, id: "b2", width: "medium" },
        { ...brush, id: "b3", width: "thick" },
      ],
    });
    // "thick" was 7, above the slider's current ceiling, so it clamps.
    expect(parsePaintDocument(raw).map((s) => (s as PaintBrushShape).width)).toEqual([
      2,
      4,
      PAINT_WIDTH_MAX,
    ]);
  });

  it("still drops a shape whose width is neither a number nor a known preset", () => {
    const raw = JSON.stringify({
      version: PAINT_STORAGE_VERSION,
      mapId: "main",
      updatedAt: 0,
      shapes: [{ ...brush, width: "gigantic" }],
    });
    expect(parsePaintDocument(raw)).toEqual([]);
  });

  it("truncates an over-long brush stroke", () => {
    const points = Array.from({ length: PAINT_MAX_BRUSH_POINTS + 50 }, (_, i) => ({
      x: i,
      y: i,
    }));
    const raw = JSON.stringify({
      version: PAINT_STORAGE_VERSION,
      mapId: "main",
      updatedAt: 0,
      shapes: [{ ...brush, points }],
    });
    const parsed = parsePaintDocument(raw);
    expect(parsed).toHaveLength(1);
    expect((parsed[0] as PaintBrushShape).points).toHaveLength(PAINT_MAX_BRUSH_POINTS);
  });
});

describe("isUnreadablePaintDocument", () => {
  it("is false for absent or current-version data", () => {
    expect(isUnreadablePaintDocument(null)).toBe(false);
    expect(isUnreadablePaintDocument("{")).toBe(false);
    expect(isUnreadablePaintDocument(serializePaintDocument("main", [stamp]))).toBe(false);
  });
});

describe("exportPaintDocument", () => {
  it("round-trips through import", () => {
    const json = exportPaintDocument("main", [stamp, brush]);
    const result = importPaintDocument(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.shapes).toEqual([stamp, brush]);
      expect(result.skipped).toBe(0);
    }
  });

  it("is pretty-printed so it survives being pasted around", () => {
    const json = exportPaintDocument("main", [stamp]);
    expect(json.split(String.fromCharCode(10)).length).toBeGreaterThan(3);
  });
});

describe("paintExportFilename", () => {
  it("names the file after the map and a sortable timestamp", () => {
    const name = paintExportFilename("main", Date.UTC(2026, 7, 30, 13, 45, 12));
    expect(name).toBe("war-plan-main-2026-08-30-13-45-12.json");
  });
});

describe("importPaintDocument", () => {
  it("explains why a file was rejected instead of failing silently", () => {
    expect(importPaintDocument("")).toEqual({ ok: false, reason: "That file is empty." });
    expect(importPaintDocument("not json").ok).toBe(false);
    expect(importPaintDocument("[]").ok).toBe(false);
    const wrongVersion = importPaintDocument(
      JSON.stringify({ version: 99, shapes: [stamp] })
    );
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) expect(wrongVersion.reason).toContain("version 99");
    expect(
      importPaintDocument(
        JSON.stringify({ version: PAINT_STORAGE_VERSION, shapes: [] })
      ).ok
    ).toBe(false);
  });

  it("reports how many unreadable drawings it dropped", () => {
    const raw = JSON.stringify({
      version: PAINT_STORAGE_VERSION,
      mapId: "main",
      updatedAt: 0,
      shapes: [stamp, { ...brush, points: "nope" }],
    });
    const result = importPaintDocument(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.shapes).toEqual([stamp]);
      expect(result.skipped).toBe(1);
    }
  });

  it("accepts a plan exported from the other map", () => {
    const result = importPaintDocument(exportPaintDocument("dev", [stamp]));
    expect(result.ok).toBe(true);
  });
});
