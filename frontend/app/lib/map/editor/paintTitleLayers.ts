import { parseRgbString } from "@/app/lib/map/titleRgb";
import type { TitleEntity, TitleLayers } from "@/app/lib/titleProvinces";

import type {
  ProvincePixelIndex,
  ProvinceRunIndex,
} from "./buildProvinceIndex";
import {
  forEachProvinceRun,
  isProvinceRunIndex,
} from "./buildProvinceIndex";
import { EDITOR_SELECTION_HIGHLIGHT } from "./editorConstants";

/**
 * Province geometry is either a flat map with one entry per pixel or a
 * run-length index, selected by the editor's province-runs feature flag.
 */
export type ProvinceGeometrySource = Int32Array | ProvinceRunIndex;

/**
 * Per-province pixel lookup for incremental repaints: either the prebuilt
 * flat pixel buckets or the run index (which needs no per-pixel allocation).
 */
export type ProvinceRegionIndex = ProvincePixelIndex | ProvinceRunIndex;

function parseLayerRgb(rgb: string | undefined): [number, number, number] | null {
  if (!rgb) return null;
  return parseRgbString(rgb);
}

const LITTLE_ENDIAN = (() => {
  const probe = new ArrayBuffer(4);
  new DataView(probe).setUint32(0, 0x01020304, true);
  return new Uint8Array(probe)[0] === 0x04;
})();

/**
 * Packs one RGBA quad the way the running machine lays bytes out inside a
 * `Uint32Array`, so a 32-bit store lands the same bytes a four-byte write
 * would. Exported because the chronicle painter fills whole frames through the
 * same view and must not re-derive the byte order on its own.
 */
export function packRgbaForU32View(
  r: number,
  g: number,
  b: number,
  a: number
): number {
  return LITTLE_ENDIAN
    ? (((a << 24) | (b << 16) | (g << 8) | r) >>> 0)
    : (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
}

/**
 * A 32-bit view over an RGBA byte buffer, or `null` when the buffer's offset or
 * length rules one out (or the engine refuses the view outright) — callers must
 * keep a per-byte path for that case.
 */
export function createRgbaU32View(
  data: Uint8ClampedArray
): Uint32Array | null {
  if (data.byteOffset % 4 !== 0 || data.length % 4 !== 0) return null;
  try {
    return new Uint32Array(data.buffer, data.byteOffset, data.length >>> 2);
  } catch {
    return null;
  }
}

/**
 * Returns a writer that fills a contiguous run of pixels with one RGBA value.
 * Uses a single Uint32Array.fill per span when the ImageData buffer allows a
 * 32-bit view, and otherwise falls back to the identical per-byte loop.
 */
function makeSpanWriter(
  imageData: ImageData
): (start: number, length: number, r: number, g: number, b: number, a: number) => void {
  const { data } = imageData;

  const u32 = createRgbaU32View(data);

  if (u32) {
    const view = u32;
    return (start, length, r, g, b, a) => {
      view.fill(packRgbaForU32View(r, g, b, a), start, start + length);
    };
  }

  return (start, length, r, g, b, a) => {
    let offset = start * 4;
    for (let k = 0; k < length; k++) {
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
      offset += 4;
    }
  };
}

/** Paint every row-span of one province from the run index. */
export function paintProvinceRuns(
  imageData: ImageData,
  runIndex: ProvinceRunIndex,
  provinceId: number,
  rgb: [number, number, number]
): void {
  const write = makeSpanWriter(imageData);
  const [r, g, b] = rgb;
  forEachProvinceRun(runIndex, provinceId, (start, length) => {
    write(start, length, r, g, b, 255);
  });
}

/** Clear every row-span of one province from the run index. */
export function clearProvinceRuns(
  imageData: ImageData,
  runIndex: ProvinceRunIndex,
  provinceId: number
): void {
  const write = makeSpanWriter(imageData);
  forEachProvinceRun(runIndex, provinceId, (start, length) => {
    write(start, length, 0, 0, 0, 0);
  });
}

function paintRegion(
  imageData: ImageData,
  source: ProvinceRegionIndex,
  provinceId: number,
  rgb: [number, number, number]
): void {
  if (isProvinceRunIndex(source)) {
    paintProvinceRuns(imageData, source, provinceId, rgb);
    return;
  }
  const indices = source.get(provinceId);
  if (indices) paintPixelIndices(imageData, indices, rgb);
}

function clearRegion(
  imageData: ImageData,
  source: ProvinceRegionIndex,
  provinceId: number
): void {
  if (isProvinceRunIndex(source)) {
    clearProvinceRuns(imageData, source, provinceId);
    return;
  }
  const indices = source.get(provinceId);
  if (indices) clearPixelIndices(imageData, indices);
}

export function paintPixelIndices(
  imageData: ImageData,
  indices: Uint32Array | readonly number[],
  rgb: [number, number, number]
): void {
  const { data } = imageData;
  const [r, g, b] = rgb;

  for (let j = 0; j < indices.length; j++) {
    const i = indices[j]!;
    const offset = i * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  }
}

export function clearPixelIndices(
  imageData: ImageData,
  indices: Uint32Array | readonly number[]
): void {
  const { data } = imageData;

  for (let j = 0; j < indices.length; j++) {
    const i = indices[j]!;
    const offset = i * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
}

function resolveCountySelectionRgb(
  pid: number,
  provinceToRgb: Record<number, string>,
  provinceToCounty: Map<number, string>,
  countyColors: Record<string, string>
): [number, number, number] | null {
  const countyId = provinceToCounty.get(pid);
  if (countyId) {
    return parseLayerRgb(countyColors[countyId]);
  }
  return parseLayerRgb(provinceToRgb[pid]);
}

export function fillProvincePixels(
  imageData: ImageData,
  provinceMap: ProvinceGeometrySource,
  provinceIds: ReadonlySet<number> | readonly number[],
  rgb: [number, number, number]
): void {
  const idSet =
    provinceIds instanceof Set ? provinceIds : new Set(provinceIds);

  if (isProvinceRunIndex(provinceMap)) {
    for (const pid of idSet) {
      paintProvinceRuns(imageData, provinceMap, pid, rgb);
    }
    return;
  }

  const { data } = imageData;
  const [r, g, b] = rgb;

  for (let i = 0; i < provinceMap.length; i++) {
    const pid = provinceMap[i];
    if (pid < 0 || !idSet.has(pid)) continue;
    const offset = i * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  }
}

export function paintSelectionLayerFull(
  imageData: ImageData,
  provinceMap: ProvinceGeometrySource,
  provinceToRgb: Record<number, string>,
  provinceToCounty: Map<number, string>,
  countyColors: Record<string, string>
): void {
  if (isProvinceRunIndex(provinceMap)) {
    const write = makeSpanWriter(imageData);
    const { runStarts, runLengths, runIds } = provinceMap;

    for (let i = 0; i < runIds.length; i++) {
      const pid = runIds[i]!;
      if (pid === 0) continue;

      const rgb = resolveCountySelectionRgb(
        pid,
        provinceToRgb,
        provinceToCounty,
        countyColors
      );
      if (!rgb) continue;

      write(runStarts[i]!, runLengths[i]!, rgb[0], rgb[1], rgb[2], 255);
    }
    return;
  }

  const { data } = imageData;

  for (let i = 0; i < provinceMap.length; i++) {
    const pid = provinceMap[i];
    if (pid < 0) continue;

    const rgb = resolveCountySelectionRgb(
      pid,
      provinceToRgb,
      provinceToCounty,
      countyColors
    );
    if (!rgb) continue;

    const offset = i * 4;
    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = 255;
  }
}

export function updateCountySelectionSubset(
  imageData: ImageData,
  pixelIndex: ProvinceRegionIndex,
  provinceIds: readonly number[],
  provinceToRgb: Record<number, string>,
  provinceToCounty: Map<number, string>,
  countyColors: Record<string, string>
): void {
  for (const pid of provinceIds) {
    const rgb = resolveCountySelectionRgb(
      pid,
      provinceToRgb,
      provinceToCounty,
      countyColors
    );
    if (!rgb) continue;

    paintRegion(imageData, pixelIndex, pid, rgb);
  }
}

export function paintActiveLayerFull(
  imageData: ImageData,
  provinceMap: ProvinceGeometrySource,
  activeMembers: readonly number[] | undefined,
  activeRgb: string | undefined,
  selectionIds: ReadonlySet<number>,
  highlightRgb: string = EDITOR_SELECTION_HIGHLIGHT
): void {
  const activeParsed = parseLayerRgb(activeRgb);
  if (activeMembers && activeParsed) {
    fillProvincePixels(imageData, provinceMap, activeMembers, activeParsed);
  }

  const highlightParsed = parseLayerRgb(highlightRgb);
  if (highlightParsed && selectionIds.size > 0) {
    fillProvincePixels(imageData, provinceMap, selectionIds, highlightParsed);
  }
}

export function updateCountyActiveSubset(
  imageData: ImageData,
  pixelIndex: ProvinceRegionIndex,
  activeProvinceIds: readonly number[],
  activeRgb: string | undefined,
  clearProvinceIds: readonly number[] = []
): void {
  for (const pid of clearProvinceIds) {
    clearRegion(imageData, pixelIndex, pid);
  }

  const parsed = parseLayerRgb(activeRgb);
  if (!parsed) return;

  for (const pid of activeProvinceIds) {
    paintRegion(imageData, pixelIndex, pid, parsed);
  }
}

type ChildPaintEntry = TitleEntity & { rgb?: string };

export function paintChildSelectionLayerFull(
  imageData: ImageData,
  provinceMap: ProvinceGeometrySource,
  childDraft: Record<string, ChildPaintEntry>,
  resolveFn: (childId: string, layers: TitleLayers) => number[],
  layers: TitleLayers
): void {
  for (const [childId, entry] of Object.entries(childDraft)) {
    const rgb = parseLayerRgb(entry.rgb);
    if (!rgb) continue;
    const provinceIds = resolveFn(childId, layers);
    fillProvincePixels(imageData, provinceMap, provinceIds, rgb);
  }
}

export function updateChildSelectionSubset(
  imageData: ImageData,
  pixelIndex: ProvinceRegionIndex,
  childIds: readonly string[],
  childColors: Record<string, string>,
  resolveFn: (childId: string, layers: TitleLayers) => number[],
  layers: TitleLayers
): void {
  for (const childId of childIds) {
    const rgb = parseLayerRgb(childColors[childId]);
    if (!rgb) continue;

    const provinceIds = resolveFn(childId, layers);
    for (const pid of provinceIds) {
      paintRegion(imageData, pixelIndex, pid, rgb);
    }
  }
}

export function paintParentActiveLayerFull(
  imageData: ImageData,
  provinceMap: ProvinceGeometrySource,
  memberChildIds: readonly string[] | undefined,
  parentRgb: string | undefined,
  resolveFn: (childId: string, layers: TitleLayers) => number[],
  layers: TitleLayers
): void {
  const activeParsed = parseLayerRgb(parentRgb);
  if (!memberChildIds || memberChildIds.length === 0 || !activeParsed) return;

  const provinceIds: number[] = [];
  for (const childId of memberChildIds) {
    provinceIds.push(...resolveFn(childId, layers));
  }
  fillProvincePixels(imageData, provinceMap, provinceIds, activeParsed);
}

export function updateParentActiveSubset(
  imageData: ImageData,
  pixelIndex: ProvinceRegionIndex,
  memberChildIds: readonly string[] | undefined,
  parentRgb: string | undefined,
  resolveFn: (childId: string, layers: TitleLayers) => number[],
  layers: TitleLayers,
  clearChildIds: readonly string[] = []
): void {
  for (const childId of clearChildIds) {
    const provinceIds = resolveFn(childId, layers);
    for (const pid of provinceIds) {
      clearRegion(imageData, pixelIndex, pid);
    }
  }

  const parsed = parseLayerRgb(parentRgb);
  if (!parsed || !memberChildIds || memberChildIds.length === 0) return;

  for (const childId of memberChildIds) {
    const provinceIds = resolveFn(childId, layers);
    for (const pid of provinceIds) {
      paintRegion(imageData, pixelIndex, pid, parsed);
    }
  }
}
