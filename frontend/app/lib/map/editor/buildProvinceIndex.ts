import type { EditorProvinceRow } from "@/lib/map/api";
import { parseRgbString } from "@/app/lib/map/titleRgb";

export type ProvinceIndex = {
  rgbToProvinceId: Record<string, number>;
  provinceToRgb: Record<number, string>;
  provinceMap: Int32Array;
  width: number;
  height: number;
  /**
   * Present only when the index was built from the run-length artifact
   * (see the runs feature flag in useEditorProvinceIndex). Consumers that
   * do not know about runs keep using `provinceMap` unchanged.
   */
  runs?: ProvinceRunIndex;
};

export type ProvincePixelIndex = Map<number, Uint32Array>;

export function buildProvincePixelIndex(
  provinceMap: Int32Array
): ProvincePixelIndex {
  const buckets = new Map<number, number[]>();

  for (let i = 0; i < provinceMap.length; i++) {
    const pid = provinceMap[i];
    if (pid < 0) continue;
    const list = buckets.get(pid);
    if (list) {
      list.push(i);
    } else {
      buckets.set(pid, [i]);
    }
  }

  const result: ProvincePixelIndex = new Map();
  for (const [pid, list] of buckets) {
    result.set(pid, Uint32Array.from(list));
  }
  return result;
}

function buildCatalogRgbMaps(provinces: EditorProvinceRow[]): {
  rgbToProvinceId: Record<string, number>;
  provinceToRgb: Record<number, string>;
} {
  const rgbToProvinceId: Record<string, number> = {};
  const provinceToRgb: Record<number, string> = {};

  for (const row of provinces) {
    const parsed = parseRgbString(row.rgb);
    if (!parsed) continue;
    rgbToProvinceId[row.rgb] = row.id;
    provinceToRgb[row.id] = row.rgb;
  }

  return { rgbToProvinceId, provinceToRgb };
}

export function deserializeProvinceIdGrid(bytes: ArrayBuffer): {
  width: number;
  height: number;
  ids: Uint16Array;
} {
  if (bytes.byteLength < 8) {
    throw new Error("province id grid data too short for header");
  }

  const view = new DataView(bytes);
  const width = view.getInt32(0, true);
  const height = view.getInt32(4, true);
  const pixelCount = width * height;
  const expectedBody = pixelCount * 2;

  if (bytes.byteLength !== 8 + expectedBody) {
    throw new Error(
      `province id grid body length mismatch for ${width}x${height}`
    );
  }

  const ids = new Uint16Array(bytes, 8, pixelCount);
  return { width, height, ids };
}

export function buildProvinceIndexFromGrid(
  provinces: EditorProvinceRow[],
  width: number,
  height: number,
  ids: Uint16Array
): ProvinceIndex {
  const pixelCount = width * height;
  if (ids.length !== pixelCount) {
    throw new Error("province id grid ids length mismatch");
  }

  const provinceMap = new Int32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const id = ids[i]!;
    provinceMap[i] = id === 0 ? -1 : id;
  }

  const { rgbToProvinceId, provinceToRgb } = buildCatalogRgbMaps(provinces);

  return {
    rgbToProvinceId,
    provinceToRgb,
    provinceMap,
    width,
    height,
  };
}

// ---------------------------------------------------------------------------
// Run-length province index (decoder for province_id_runs.bin.gz)
// ---------------------------------------------------------------------------
//
// Additive alternative to the flat Int32Array province map. The flat path
// above is untouched and remains the default; this path is only reachable
// when the runs feature flag is on AND the artifact decodes cleanly.
//
// Payload layout (little-endian), produced by
// backend/src/scripts/province_id_grid.py :: serialize_province_id_runs
//
//   Header (32 bytes)
//     off  0  char[4]  magic = "PRUV"
//     off  4  uint32   version = 1
//     off  8  int32    width
//     off 12  int32    height
//     off 16  uint32   runCount
//     off 20  uint32   provinceCount (rows in the bbox table)
//     off 24  uint32   reserved0
//     off 28  uint32   reserved1
//
//   Section A (planar, row-major scan order), 6 * runCount bytes:
//     A1 uint32[runCount] run lengths, at offset 32
//     A2 uint16[runCount] province ids, at offset 32 + 4 * runCount
//                          (0 means "no province")
//
//   Section B, 20 * provinceCount bytes, sorted by province id:
//     uint32 provinceId, minX, minY, maxX, maxY   (max values inclusive)
//
// Runs never cross a row boundary, so run k covers pixels
// [start[k], start[k] + length[k]) which all live on row start[k] / width.

export const PROVINCE_RUNS_MAGIC = "PRUV";
export const PROVINCE_RUNS_VERSION = 1;
const PROVINCE_RUNS_HEADER_SIZE = 32;
const PROVINCE_RUNS_BBOX_ENTRY_SIZE = 20;

export type ProvinceBBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type DecodedProvinceRuns = {
  width: number;
  height: number;
  runLengths: Uint32Array;
  runIds: Uint16Array;
  bbox: Map<number, ProvinceBBox>;
};

/**
 * Run-backed province index. Serves the same queries the flat `provinceMap`
 * serves (province at a pixel, the pixels of a province) without ever
 * materialising one entry per pixel.
 */
export type ProvinceRunIndex = {
  readonly kind: "province-runs";
  width: number;
  height: number;
  /** Pixel offset of each run (prefix sum of runLengths). */
  runStarts: Uint32Array;
  runLengths: Uint32Array;
  runIds: Uint16Array;
  /** province id (> 0) -> indices into runStarts/runLengths/runIds. */
  runsByProvince: Map<number, Uint32Array>;
  bbox: Map<number, ProvinceBBox>;
};

export function isProvinceRunIndex(value: unknown): value is ProvinceRunIndex {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "province-runs"
  );
}

export function deserializeProvinceIdRuns(
  bytes: ArrayBuffer
): DecodedProvinceRuns {
  if (bytes.byteLength < PROVINCE_RUNS_HEADER_SIZE) {
    throw new Error("province id runs data too short for header");
  }

  const view = new DataView(bytes);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== PROVINCE_RUNS_MAGIC) {
    throw new Error(`bad province id runs magic: ${JSON.stringify(magic)}`);
  }

  const version = view.getUint32(4, true);
  if (version !== PROVINCE_RUNS_VERSION) {
    throw new Error(`unsupported province id runs version: ${version}`);
  }

  const width = view.getInt32(8, true);
  const height = view.getInt32(12, true);
  if (width <= 0 || height <= 0) {
    throw new Error(`invalid grid dimensions: ${width}x${height}`);
  }

  const runCount = view.getUint32(16, true);
  const provinceCount = view.getUint32(20, true);

  const idsStart = PROVINCE_RUNS_HEADER_SIZE + runCount * 4;
  const runsEnd = idsStart + runCount * 2;
  const expected = runsEnd + provinceCount * PROVINCE_RUNS_BBOX_ENTRY_SIZE;
  if (bytes.byteLength !== expected) {
    throw new Error(
      `province id runs length ${bytes.byteLength} != expected ${expected} ` +
        `for runCount=${runCount} provinceCount=${provinceCount}`
    );
  }

  // slice() rather than a view: the sections are not guaranteed to be
  // aligned for typed-array views once provinceCount is odd, and the copy
  // is ~1.5 MB, not 82 MB.
  const runLengths = new Uint32Array(
    bytes.slice(PROVINCE_RUNS_HEADER_SIZE, idsStart)
  );
  const runIds = new Uint16Array(bytes.slice(idsStart, runsEnd));

  let total = 0;
  for (let i = 0; i < runLengths.length; i++) {
    const length = runLengths[i]!;
    if (length === 0) {
      throw new Error(`province id runs contain a zero-length run at ${i}`);
    }
    total += length;
  }
  if (total !== width * height) {
    throw new Error(
      `province id runs cover ${total} pixels, expected ${width * height}`
    );
  }

  const bbox = new Map<number, ProvinceBBox>();
  for (let i = 0; i < provinceCount; i++) {
    const offset = runsEnd + i * PROVINCE_RUNS_BBOX_ENTRY_SIZE;
    bbox.set(view.getUint32(offset, true), {
      minX: view.getUint32(offset + 4, true),
      minY: view.getUint32(offset + 8, true),
      maxX: view.getUint32(offset + 12, true),
      maxY: view.getUint32(offset + 16, true),
    });
  }

  return { width, height, runLengths, runIds, bbox };
}

export function buildProvinceRunIndex(
  width: number,
  height: number,
  runLengths: Uint32Array,
  runIds: Uint16Array,
  bbox: Map<number, ProvinceBBox> = new Map()
): ProvinceRunIndex {
  if (runLengths.length !== runIds.length) {
    throw new Error("province run lengths/ids length mismatch");
  }

  const runCount = runLengths.length;
  const runStarts = new Uint32Array(runCount);
  const counts = new Map<number, number>();

  let cursor = 0;
  for (let i = 0; i < runCount; i++) {
    runStarts[i] = cursor;
    cursor += runLengths[i]!;
    const pid = runIds[i]!;
    if (pid > 0) counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }

  if (cursor !== width * height) {
    throw new Error(
      `province id runs cover ${cursor} pixels, expected ${width * height}`
    );
  }

  const runsByProvince = new Map<number, Uint32Array>();
  const fill = new Map<number, number>();
  for (const [pid, count] of counts) {
    runsByProvince.set(pid, new Uint32Array(count));
    fill.set(pid, 0);
  }
  for (let i = 0; i < runCount; i++) {
    const pid = runIds[i]!;
    if (pid === 0) continue;
    const target = runsByProvince.get(pid)!;
    const at = fill.get(pid)!;
    target[at] = i;
    fill.set(pid, at + 1);
  }

  return {
    kind: "province-runs",
    width,
    height,
    runStarts,
    runLengths,
    runIds,
    runsByProvince,
    bbox,
  };
}

/** Province id at a flat pixel offset, or -1. Matches provinceMap[i]. */
export function provinceAtPixel(
  runIndex: ProvinceRunIndex,
  pixel: number
): number {
  if (pixel < 0 || pixel >= runIndex.width * runIndex.height) return -1;

  const { runStarts } = runIndex;
  let lo = 0;
  let hi = runStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (runStarts[mid]! <= pixel) lo = mid;
    else hi = mid - 1;
  }

  const pid = runIndex.runIds[lo]!;
  return pid === 0 ? -1 : pid;
}

/** Province id at (x, y), or -1. Matches provinceMap[y * width + x]. */
export function provinceAt(
  runIndex: ProvinceRunIndex,
  x: number,
  y: number
): number {
  if (x < 0 || y < 0 || x >= runIndex.width || y >= runIndex.height) return -1;
  return provinceAtPixel(runIndex, y * runIndex.width + x);
}

/** Visit each row-span of a province, in ascending pixel order. */
export function forEachProvinceRun(
  runIndex: ProvinceRunIndex,
  provinceId: number,
  visit: (start: number, length: number) => void
): void {
  const runs = runIndex.runsByProvince.get(provinceId);
  if (!runs) return;
  for (let j = 0; j < runs.length; j++) {
    const r = runs[j]!;
    visit(runIndex.runStarts[r]!, runIndex.runLengths[r]!);
  }
}

export function provincePixelCount(
  runIndex: ProvinceRunIndex,
  provinceId: number
): number {
  let total = 0;
  forEachProvinceRun(runIndex, provinceId, (_start, length) => {
    total += length;
  });
  return total;
}

export function getProvinceBBox(
  runIndex: ProvinceRunIndex,
  provinceId: number
): ProvinceBBox | null {
  return runIndex.bbox.get(provinceId) ?? null;
}

export function provinceIdsInRunIndex(runIndex: ProvinceRunIndex): number[] {
  return [...runIndex.runsByProvince.keys()].sort((a, b) => a - b);
}

/**
 * Expand runs back to the flat map the existing code (and useEditorPick)
 * consumes. Kept so the runs path can still satisfy the ProvinceIndex
 * contract without changing any consumer.
 */
export function provinceMapFromRuns(runIndex: ProvinceRunIndex): Int32Array {
  const { width, height, runStarts, runLengths, runIds } = runIndex;
  const provinceMap = new Int32Array(width * height);

  for (let i = 0; i < runStarts.length; i++) {
    const pid = runIds[i]!;
    const value = pid === 0 ? -1 : pid;
    const start = runStarts[i]!;
    provinceMap.fill(value, start, start + runLengths[i]!);
  }
  return provinceMap;
}

/**
 * Build the same Map<pid, Uint32Array> that buildProvincePixelIndex builds
 * from a flat map. Used by the equivalence tests; the paint path uses the
 * run spans directly instead and never allocates this.
 */
export function buildProvincePixelIndexFromRuns(
  runIndex: ProvinceRunIndex
): ProvincePixelIndex {
  const result: ProvincePixelIndex = new Map();

  for (const pid of runIndex.runsByProvince.keys()) {
    const pixels = new Uint32Array(provincePixelCount(runIndex, pid));
    let at = 0;
    forEachProvinceRun(runIndex, pid, (start, length) => {
      for (let k = 0; k < length; k++) pixels[at++] = start + k;
    });
    result.set(pid, pixels);
  }

  // buildProvincePixelIndex inserts buckets in first-seen scan order; match it.
  const ordered: ProvincePixelIndex = new Map();
  for (let i = 0; i < runIndex.runIds.length; i++) {
    const pid = runIndex.runIds[i]!;
    if (pid === 0 || ordered.has(pid)) continue;
    ordered.set(pid, result.get(pid)!);
  }
  return ordered;
}

export function buildProvinceIndexFromRuns(
  provinces: EditorProvinceRow[],
  runIndex: ProvinceRunIndex
): ProvinceIndex {
  const { rgbToProvinceId, provinceToRgb } = buildCatalogRgbMaps(provinces);

  // provinceMap is materialised lazily. Expanding the runs costs a 40.96M-entry
  // Int32Array (~164MB) — the exact allocation the runs artifact exists to
  // avoid — and the run-aware paint and pick paths never read it. Consumers
  // that still index it directly keep working; they just pay for it, and only
  // if they actually touch it.
  let flat: Int32Array | null = null;

  return {
    rgbToProvinceId,
    provinceToRgb,
    get provinceMap(): Int32Array {
      if (flat === null) flat = provinceMapFromRuns(runIndex);
      return flat;
    },
    width: runIndex.width,
    height: runIndex.height,
    runs: runIndex,
  };
}
