/**
 * localStorage persistence for painted war plans. Per-browser only — there is
 * no backend for this; each planner keeps their own scratch layer.
 *
 * Keyed by `mapId` alone, deliberately: a plan is about the terrain, and the
 * viewer lets you flip between nation/terrain/trade views of the same world,
 * so drawings must survive those flips.
 */

import type { MapId } from "../components/map/types";
import {
  PAINT_MAX_BRUSH_POINTS,
  PAINT_MAX_SHAPES,
  clampPaintWidth,
  isPaintShape,
  type PaintShape,
} from "./mapPaint";

/**
 * Saved browser plans may contain named stroke widths. Normalise them to
 * slider values before validating each shape.
 */
const LEGACY_WIDTHS: Record<string, number> = { thin: 2, medium: 4, thick: 7 };

function migrateLegacyWidth(entry: unknown): unknown {
  const shape = entry as { width?: unknown } | null;
  if (!shape || typeof shape !== "object" || typeof shape.width !== "string") {
    return entry;
  }
  const width = LEGACY_WIDTHS[shape.width];
  // Clamp named presets to the slider's supported range.
  return width === undefined ? entry : { ...shape, width: clampPaintWidth(width) };
}

export const PAINT_STORAGE_VERSION = 1;

export function paintStorageKey(mapId: MapId): string {
  return `tfmc-map-paint-v${PAINT_STORAGE_VERSION}:${mapId}`;
}

export type PaintDocument = {
  version: number;
  mapId: MapId;
  updatedAt: number;
  shapes: PaintShape[];
};

function paintDocument(mapId: MapId, shapes: PaintShape[]): PaintDocument {
  return {
    version: PAINT_STORAGE_VERSION,
    mapId,
    updatedAt: Date.now(),
    shapes: shapes.slice(0, PAINT_MAX_SHAPES),
  };
}

export function serializePaintDocument(mapId: MapId, shapes: PaintShape[]): string {
  return JSON.stringify(paintDocument(mapId, shapes));
}

/**
 * Strict per document, lenient per shape: a bad version or malformed document
 * yields nothing, but a single corrupt shape is dropped rather than losing the
 * whole plan. Never throws.
 */
export function parsePaintDocument(raw: string | null | undefined): PaintShape[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const doc = parsed as Partial<PaintDocument> | null;
  if (!doc || typeof doc !== "object") return [];
  if (doc.version !== PAINT_STORAGE_VERSION) return [];
  if (!Array.isArray(doc.shapes)) return [];

  const shapes: PaintShape[] = [];
  for (const raw of doc.shapes) {
    const entry = migrateLegacyWidth(raw);
    if (!isPaintShape(entry)) continue;
    shapes.push(
      entry.type === "brush" && entry.points.length > PAINT_MAX_BRUSH_POINTS
        ? { ...entry, points: entry.points.slice(0, PAINT_MAX_BRUSH_POINTS) }
        : entry
    );
    if (shapes.length >= PAINT_MAX_SHAPES) break;
  }
  return shapes;
}

/** True when the stored document exists but is from a version we cannot read. */
export function isUnreadablePaintDocument(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const doc = JSON.parse(raw) as Partial<PaintDocument> | null;
    return !!doc && typeof doc === "object" && doc.version !== PAINT_STORAGE_VERSION;
  } catch {
    return false;
  }
}

function readRaw(mapId: MapId): string | null {
  try {
    return window.localStorage.getItem(paintStorageKey(mapId));
  } catch {
    // private browsing / storage disabled
    return null;
  }
}

export type LoadedPaintPlan = {
  shapes: PaintShape[];
  /** When true, do not write back — a newer version's data is sitting there. */
  readOnly: boolean;
};

export function loadPaintPlan(mapId: MapId): LoadedPaintPlan {
  const raw = readRaw(mapId);
  return { shapes: parsePaintDocument(raw), readOnly: isUnreadablePaintDocument(raw) };
}

export function savePaintShapes(mapId: MapId, shapes: PaintShape[]): void {
  try {
    if (shapes.length === 0) {
      window.localStorage.removeItem(paintStorageKey(mapId));
      return;
    }
    window.localStorage.setItem(paintStorageKey(mapId), serializePaintDocument(mapId, shapes));
  } catch {
    // ignore write failures (QuotaExceededError, private browsing, etc.)
  }
}

/**
 * Sharing a plan as a file. Export is the same document shape as localStorage,
 * pretty-printed so it survives a trip through chat or a gist legibly.
 */
export function exportPaintDocument(mapId: MapId, shapes: PaintShape[]): string {
  return JSON.stringify(paintDocument(mapId, shapes), null, 2);
}

export function paintExportFilename(mapId: MapId, at: number): string {
  const stamp = new Date(at).toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `war-plan-${mapId}-${stamp}.json`;
}

export type PaintImportResult =
  | { ok: true; shapes: PaintShape[]; skipped: number }
  | { ok: false; reason: string };

/**
 * Reads a plan someone else exported. Unlike the localStorage path — which
 * fails silently by design, so a corrupt key can never break the map — this
 * reports why a file was rejected, because the user picked it deliberately and
 * deserves to know.
 */
export function importPaintDocument(raw: string): PaintImportResult {
  if (!raw.trim()) return { ok: false, reason: "That file is empty." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "That file isn't valid JSON." };
  }

  const doc = parsed as Partial<PaintDocument> | null;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, reason: "That file isn't a war plan." };
  }
  if (doc.version !== PAINT_STORAGE_VERSION) {
    return {
      ok: false,
      reason: `Unsupported plan version ${String(doc.version ?? "unknown")}.`,
    };
  }
  if (!Array.isArray(doc.shapes)) {
    return { ok: false, reason: "That plan has no drawings in it." };
  }

  const shapes = parsePaintDocument(raw);
  if (!shapes.length) {
    return { ok: false, reason: "That plan has no readable drawings in it." };
  }
  return { ok: true, shapes, skipped: doc.shapes.length - shapes.length };
}
