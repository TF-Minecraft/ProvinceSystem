import { insetLabelEndpoints, type ProvinceLabelGrid } from "./labelBlobGeometry";
import type { MapMode } from "../components/map/types";
import {
  resolveTitleProvinces,
  type TitleLayers,
} from "./titleProvinces";

export const LABEL_MAP_MODES = new Set<MapMode>([
  "nation",
  "county",
  "duchy",
  "kingdom",
  "empire",
  "trade",
]);

export const TITLE_LABEL_MODES = new Set<MapMode>([
  "county",
  "duchy",
  "kingdom",
  "empire",
]);

export const MIN_PROVINCES = 1;
export const MIN_PIXEL_AREA = 15000;
/** Average glyph width as a fraction of font size (Fraunces 500). */
export const LABEL_GLYPH_WIDTH_EM = 0.58;
/** Quadratic arc bulge as a fraction of chord length (screen-up). */
export const LABEL_ARC_BULGE_RATIO = 0.08;
/**
 * Extra baseline length, as a fraction of the chord, for the `<textPath>` a
 * name is set along.
 *
 * `fontSizeForLabel` sizes text so its *estimated* width equals the chord
 * exactly, and `LABEL_GLYPH_WIDTH_EM` under-estimates all-caps Fraunces. Any
 * such under-estimate makes the real text longer than the path, and SVG does
 * not scale or ellipsize that: it drops whole glyphs whose position falls off
 * the path end, which with `textAnchor="middle"` takes the leading character
 * first (`COUNTY_45` rendered as `OUNTY_45`).
 *
 * Lengthening the baseline is free headroom: the path is `fill="none"` and is
 * never stroked, so nothing new is drawn, and extending it symmetrically leaves
 * the midpoint the text is centred on exactly where it was.
 */
export const LABEL_PATH_OVERSHOOT_RATIO = 0.3;
/** Cap-center offset from baseline as a fraction of font size. */
export const LABEL_TEXT_CENTER_OFFSET_EM = 0.38;
export const LABEL_INK = "#2a1f14";
export const LABEL_HALO = "#e8e4d9";
export const LABEL_STROKE_WIDTH = 4;
export const LABEL_FONT_WEIGHT = 500;
export const DEFAULT_MAP_ZOOM = 1;
/** Minimum on-screen font size (px) for a label to appear. */
export const LABEL_MIN_SCREEN_PX = 6;
/**
 * Realm names are drawn in map units, so they grow with zoom. Past this
 * screen size a name is a wall of ink over the land it names; it fades out
 * and the reader is close enough to see settlements instead.
 */
export const LABEL_MAX_SCREEN_PX = 140;

export function labelScreenFontSize(
  fontSize: number,
  displayScale: number
): number {
  return fontSize * displayScale;
}

export function shouldShowLabelAtScreenSize(
  fontSize: number,
  displayScale: number
): boolean {
  if (displayScale <= 0 || fontSize <= 0) return false;
  const screenPx = labelScreenFontSize(fontSize, displayScale);
  return screenPx >= LABEL_MIN_SCREEN_PX && screenPx <= LABEL_MAX_SCREEN_PX;
}

export type ProvinceNeighbors = Record<string, number[]>;
export type ProvinceCentroid = { x: number; y: number; pixel_count: number };
export type ProvinceCentroids = Record<string, ProvinceCentroid>;

export type NationRegionInput = {
  name?: string;
  provinces?: number[];
  subjects?: string[];
  rgb?: string;
  size?: number;
  occupied_held?: number[];
};

export type LabelMapObject = {
  id: string;
  visible: boolean;
  /** Structural metadata supplied by the live map and chronicle builders. */
  nested: boolean;
  baseId: string;
};

function findLabelEntry(
  mapObjects: LabelMapObject[],
  nationId: string,
  nested: boolean
): LabelMapObject | undefined {
  return mapObjects.find(
    (obj) => obj.nested === nested && obj.baseId === nationId
  );
}

export type NationLabelScope = "full" | "direct";

export type NationLabelSpec = {
  nationId: string;
  componentIndex: number;
  text: string;
  scope: NationLabelScope;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx: number;
  cy: number;
  angleDeg: number;
  segmentPx: number;
  fontSize: number;
  pathD: string;
  /** Shift arched text toward the chord so the axis runs through glyph centers. */
  pathOffsetX: number;
  pathOffsetY: number;
};

export type ComputeNationLabelsOptions = {
  minProvinces?: number;
  minPixelArea?: number;
  grid?: ProvinceLabelGrid;
  labelNeighbors?: ProvinceNeighbors;
};

function neighborList(
  neighbors: ProvinceNeighbors,
  provinceId: number
): number[] {
  return neighbors[String(provinceId)] ?? [];
}

export function connectedComponents(
  provinceIds: number[],
  neighbors: ProvinceNeighbors
): number[][] {
  const allowed = new Set(provinceIds);
  const visited = new Set<number>();
  const components: number[][] = [];

  for (const start of provinceIds) {
    if (visited.has(start)) continue;

    const component: number[] = [];
    const queue = [start];
    visited.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      for (const next of neighborList(neighbors, current)) {
        if (!allowed.has(next) || visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }

    components.push(component);
  }

  return components;
}

function bfsFarthest(
  start: number,
  allowed: Set<number>,
  neighbors: ProvinceNeighbors
): { id: number; distance: number } {
  const distances = new Map<number, number>([[start, 0]]);
  const queue = [start];
  let farthest = { id: start, distance: 0 };

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDistance = distances.get(current) ?? 0;

    for (const next of neighborList(neighbors, current)) {
      if (!allowed.has(next) || distances.has(next)) continue;
      const nextDistance = currentDistance + 1;
      distances.set(next, nextDistance);
      queue.push(next);
      if (
        nextDistance > farthest.distance ||
        (nextDistance === farthest.distance && next < farthest.id)
      ) {
        farthest = { id: next, distance: nextDistance };
      }
    }
  }

  return farthest;
}

export function graphDiameterEndpoints(
  componentIds: number[],
  neighbors: ProvinceNeighbors
): [number, number] {
  if (componentIds.length === 0) {
    throw new Error("graphDiameterEndpoints requires at least one province");
  }

  if (componentIds.length === 1) {
    return [componentIds[0], componentIds[0]];
  }

  const allowed = new Set(componentIds);
  const start = [...componentIds].sort((a, b) => a - b)[0];
  const endA = bfsFarthest(start, allowed, neighbors);
  const endB = bfsFarthest(endA.id, allowed, neighbors);
  const a = endA.id;
  const b = endB.id;
  return a <= b ? [a, b] : [b, a];
}

export function segmentPixelLength(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function pixelDiameterEndpoints(
  componentIds: number[],
  centroids: ProvinceCentroids
): [number, number] {
  if (componentIds.length === 0) {
    throw new Error("pixelDiameterEndpoints requires at least one province");
  }

  if (componentIds.length === 1) {
    return [componentIds[0], componentIds[0]];
  }

  const points = componentIds
    .map((id) => ({ id, centroid: centroidOf(id, centroids) }))
    .filter((entry): entry is { id: number; centroid: ProvinceCentroid } =>
      entry.centroid !== null
    );

  if (points.length === 0) {
    throw new Error("pixelDiameterEndpoints requires at least one centroid");
  }

  if (points.length === 1) {
    return [points[0].id, points[0].id];
  }

  let bestDistance = -1;
  let bestPair: [number, number] = [points[0].id, points[0].id];

  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i];
      const b = points[j];
      const distance = segmentPixelLength(a.centroid.x, a.centroid.y, b.centroid.x, b.centroid.y);
      const pair: [number, number] =
        a.id <= b.id ? [a.id, b.id] : [b.id, a.id];

      if (
        distance > bestDistance ||
        (distance === bestDistance &&
          (pair[0] < bestPair[0] ||
            (pair[0] === bestPair[0] && pair[1] < bestPair[1])))
      ) {
        bestDistance = distance;
        bestPair = pair;
      }
    }
  }

  return bestPair;
}

export function estimatedLabelWidthPx(fontSize: number, text: string): number {
  const units = text.trim().length || 1;
  return fontSize * units * LABEL_GLYPH_WIDTH_EM;
}

export function fontSizeForLabel(segmentPx: number, text: string): number {
  const units = text.trim().length || 1;
  if (segmentPx <= 0) return 1;
  return Math.round(segmentPx / (units * LABEL_GLYPH_WIDTH_EM));
}

export function componentPixelArea(
  provinceIds: number[],
  centroids: ProvinceCentroids
): number {
  return provinceIds.reduce((sum, pid) => {
    return sum + (centroids[String(pid)]?.pixel_count ?? 0);
  }, 0);
}

export function labelAngleDeg(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const oriented = orientLabelEndpoints(x1, y1, x2, y2);
  const rad = Math.atan2(
    oriented.y2 - oriented.y1,
    oriented.x2 - oriented.x1
  );
  let deg = (rad * 180) / Math.PI;
  if (deg <= -90) deg += 180;
  else if (deg > 90) deg -= 180;
  return deg;
}

export function orientLabelEndpoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { x1: number; y1: number; x2: number; y2: number } {
  const rad = Math.atan2(y2 - y1, x2 - x1);
  let deg = (rad * 180) / Math.PI;
  if (deg <= -90 || deg > 90) {
    return { x1: x2, y1: y2, x2: x1, y2: y1 };
  }
  return { x1, y1, x2, y2 };
}

/**
 * The chord grown symmetrically about its own midpoint, for use as a text
 * baseline rather than as geometry. Direction and midpoint are preserved, so
 * `angleDeg`, `cx` and `cy` computed on the original chord stay correct.
 */
export function extendLabelEndpoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  ratio: number = LABEL_PATH_OVERSHOOT_RATIO
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0 || ratio <= 0) {
    return { x1, y1, x2, y2 };
  }

  const grow = (len * ratio) / 2;
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: x1 - ux * grow,
    y1: y1 - uy * grow,
    x2: x2 + ux * grow,
    y2: y2 + uy * grow,
  };
}

export function labelArcPathD(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bulgeRatio: number = LABEL_ARC_BULGE_RATIO
): string {
  const oriented = orientLabelEndpoints(x1, y1, x2, y2);
  const ax = oriented.x1;
  const ay = oriented.y1;
  const bx = oriented.x2;
  const by = oriented.y2;

  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return `M ${ax} ${ay}`;
  }

  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const nx = dy / len;
  const ny = -dx / len;
  const bulge = len * bulgeRatio;
  const cx = mx + nx * bulge;
  const cy = my + ny * bulge;
  return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
}

export function labelPathCenterOffset(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fontSize: number,
  bulgeRatio: number = LABEL_ARC_BULGE_RATIO
): { dx: number; dy: number } {
  const oriented = orientLabelEndpoints(x1, y1, x2, y2);
  const dx = oriented.x2 - oriented.x1;
  const dy = oriented.y2 - oriented.y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return { dx: 0, dy: 0 };
  }

  const bulge = len * bulgeRatio;
  const offsetPx = bulge * 0.5 + fontSize * LABEL_TEXT_CENTER_OFFSET_EM;
  const nx = dy / len;
  const ny = -dx / len;
  return { dx: -nx * offsetPx, dy: -ny * offsetPx };
}

/**
 * The region whose drawn name is under map point (`x`, `y`), or null. The
 * names ignore the pointer so the land under them stays hoverable, but a
 * name laid across water or a neighbour's land is still read as its region:
 * pointing at "The Clockwork" over the sea between its islands means The
 * Clockwork. Only names drawn at this zoom count.
 *
 * Follows the text the way `LabelLayer` draws it: along the arched, extended
 * baseline (`labelArcPathD`, shifted by `pathOffset`), centred on it, glyph
 * centres `LABEL_TEXT_CENTER_OFFSET_EM` above it, about as long as
 * `estimatedLabelWidthPx`.
 */
export function pickRegionLabelAt(
  labels: NationLabelSpec[],
  x: number,
  y: number,
  displayScale: number
): string | null {
  const SAMPLES = 48;
  let best: { id: string; distance: number } | null = null;
  for (const label of labels) {
    if (!shouldShowLabelAtScreenSize(label.fontSize, displayScale)) continue;
    const halfWidth = estimatedLabelWidthPx(label.fontSize, label.text) / 2;
    const reach = halfWidth + label.fontSize;
    if (Math.abs(x - label.cx) > reach + label.segmentPx || Math.abs(y - label.cy) > reach + label.segmentPx) {
      continue;
    }

    const extended = extendLabelEndpoints(label.x1, label.y1, label.x2, label.y2);
    const { x1: ax, y1: ay, x2: bx, y2: by } = orientLabelEndpoints(
      extended.x1,
      extended.y1,
      extended.x2,
      extended.y2
    );
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    // Toward the top of the letters, as labelArcPathD bulges.
    const nx = (by - ay) / len;
    const ny = -(bx - ax) / len;
    const bulge = len * LABEL_ARC_BULGE_RATIO;
    const qx = (ax + bx) / 2 + nx * bulge;
    const qy = (ay + by) / 2 + ny * bulge;
    const lift = label.fontSize * LABEL_TEXT_CENTER_OFFSET_EM;
    const ox = label.pathOffsetX + nx * lift;
    const oy = label.pathOffsetY + ny * lift;

    let travelled = 0;
    let prevX = ax + ox;
    let prevY = ay + oy;
    let nearest = Infinity;
    let nearestAt = 0;
    const along: number[] = [];
    for (let i = 0; i <= SAMPLES; i += 1) {
      const t = i / SAMPLES;
      const u = 1 - t;
      const px = u * u * ax + 2 * u * t * qx + t * t * bx + ox;
      const py = u * u * ay + 2 * u * t * qy + t * t * by + oy;
      if (i > 0) travelled += Math.hypot(px - prevX, py - prevY);
      along.push(travelled);
      const distance = Math.hypot(x - px, y - py);
      if (distance < nearest) {
        nearest = distance;
        nearestAt = i;
      }
      prevX = px;
      prevY = py;
    }
    const fromMiddle = Math.abs(along[nearestAt] - travelled / 2);
    // The width is an estimate; a third of a letter's slack catches the ends.
    if (nearest > label.fontSize * 0.55 || fromMiddle > halfWidth + label.fontSize * 0.35) {
      continue;
    }
    if (!best || nearest < best.distance) best = { id: label.nationId, distance: nearest };
  }
  return best?.id ?? null;
}

function centroidOf(
  provinceId: number,
  centroids: ProvinceCentroids
): ProvinceCentroid | null {
  return centroids[String(provinceId)] ?? null;
}

export function isNationLabelVisible(
  nationId: string,
  mapObjects: LabelMapObject[]
): boolean {
  const main = findLabelEntry(mapObjects, nationId, false);
  const nested = findLabelEntry(mapObjects, nationId, true);
  return !!(main?.visible || nested?.visible);
}

export function isDrilledSuzerainView(
  nationId: string,
  mapObjects: LabelMapObject[]
): boolean {
  const main = findLabelEntry(mapObjects, nationId, false);
  const nested = findLabelEntry(mapObjects, nationId, true);
  return !!main && !main.visible && nested?.visible === true;
}

export function directHoldingProvinces(
  nationId: string,
  regionData: Record<string, NationRegionInput>
): number[] {
  const region = regionData[nationId];
  const provinces = region?.provinces ?? [];
  const subjects = region?.subjects ?? [];
  if (!subjects.length) return provinces;

  const subjectProvinces = new Set<number>();
  for (const subjectId of subjects) {
    for (const provinceId of regionData[subjectId]?.provinces ?? []) {
      subjectProvinces.add(provinceId);
    }
  }

  return provinces.filter((provinceId) => !subjectProvinces.has(provinceId));
}

export function fullRealmProvinces(
  nationId: string,
  regionData: Record<string, NationRegionInput>
): number[] {
  const region = regionData[nationId];
  const provinces: number[] = [];
  const seenProvinces = new Set<number>();

  const addProvinces = (ids: number[]) => {
    for (const provinceId of ids) {
      if (seenProvinces.has(provinceId)) continue;
      seenProvinces.add(provinceId);
      provinces.push(provinceId);
    }
  };

  addProvinces(region?.provinces ?? []);

  const visitedNations = new Set<string>();
  const queue: string[] = [...(region?.subjects ?? [])];

  while (queue.length) {
    const subjectId = queue.shift()!;
    if (visitedNations.has(subjectId)) continue;
    visitedNations.add(subjectId);

    const subject = regionData[subjectId];
    if (!subject) continue;

    addProvinces(subject.provinces ?? []);
    for (const nestedId of subject.subjects ?? []) {
      if (!visitedNations.has(nestedId)) {
        queue.push(nestedId);
      }
    }
  }

  return provinces;
}

/**
 * Province -> occupier index, built once per geometry pass instead of
 * re-scanning every region for every nation inside labelControlProvinces.
 * `multi` holds provinces claimed by two or more distinct occupiers, which are
 * "occupied by other" for every nation.
 */
export type OccupationIndex = {
  ownerOf: Map<number, string>;
  multi: Set<number>;
};

export function buildOccupationIndex(
  regionData: Record<string, NationRegionInput>
): OccupationIndex {
  const ownerOf = new Map<number, string>();
  const multi = new Set<number>();

  for (const [id, region] of Object.entries(regionData)) {
    for (const provinceId of region?.occupied_held ?? []) {
      const existing = ownerOf.get(provinceId);
      if (existing === undefined) {
        ownerOf.set(provinceId, id);
      } else if (existing !== id) {
        multi.add(provinceId);
      }
    }
  }

  return { ownerOf, multi };
}

function isOccupiedByOther(
  index: OccupationIndex,
  provinceId: number,
  nationId: string
): boolean {
  if (index.multi.has(provinceId)) return true;
  const owner = index.ownerOf.get(provinceId);
  return owner !== undefined && owner !== nationId;
}

export function labelControlProvinces(
  nationId: string,
  regionData: Record<string, NationRegionInput>,
  deJure: number[],
  occupation?: OccupationIndex
): number[] {
  const index = occupation ?? buildOccupationIndex(regionData);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const provinceId of deJure) {
    if (isOccupiedByOther(index, provinceId, nationId) || seen.has(provinceId))
      continue;
    seen.add(provinceId);
    out.push(provinceId);
  }
  for (const provinceId of regionData[nationId]?.occupied_held ?? []) {
    if (seen.has(provinceId)) continue;
    seen.add(provinceId);
    out.push(provinceId);
  }
  return out;
}

export function provincesForNationLabel(
  nationId: string,
  regionData: Record<string, NationRegionInput>,
  mapObjects: LabelMapObject[]
): { provinces: number[]; scope: NationLabelScope } | null {
  if (!isNationLabelVisible(nationId, mapObjects)) return null;

  const region = regionData[nationId];

  if (isDrilledSuzerainView(nationId, mapObjects) && region?.subjects?.length) {
    const directProvinces = labelControlProvinces(
      nationId,
      regionData,
      directHoldingProvinces(nationId, regionData)
    );
    if (!directProvinces.length) return null;
    return { provinces: directProvinces, scope: "direct" };
  }

  const fullProvinces = labelControlProvinces(
    nationId,
    regionData,
    fullRealmProvinces(nationId, regionData)
  );
  if (!fullProvinces.length) return null;
  return { provinces: fullProvinces, scope: "full" };
}

export function labelsForProvinces(
  nationId: string,
  name: string,
  provinces: number[],
  neighbors: ProvinceNeighbors,
  centroids: ProvinceCentroids,
  scope: NationLabelScope,
  options?: ComputeNationLabelsOptions
): NationLabelSpec[] {
  const minProvinces = options?.minProvinces ?? MIN_PROVINCES;
  const minPixelArea = options?.minPixelArea ?? MIN_PIXEL_AREA;
  const labels: NationLabelSpec[] = [];

  const withGeometry = provinces.filter(
    (pid) => centroidOf(pid, centroids) !== null
  );
  if (!withGeometry.length) return labels;

  const componentNeighbors = options?.labelNeighbors ?? neighbors;
  const components = connectedComponents(withGeometry, componentNeighbors);

  let componentIndex = 0;
  for (const component of components) {
    if (component.length < minProvinces) continue;
    if (componentPixelArea(component, centroids) < minPixelArea) continue;

    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;
    const [pidA, pidB] = pixelDiameterEndpoints(component, centroids);
    const cA = centroidOf(pidA, centroids)!;
    const cB = centroidOf(pidB, centroids)!;

    if (options?.grid) {
      const endpoints = insetLabelEndpoints(
        component,
        name,
        options.grid,
        { x1: cA.x, y1: cA.y, x2: cB.x, y2: cB.y }
      );
      if (!endpoints) continue;
      x1 = endpoints.x1;
      y1 = endpoints.y1;
      x2 = endpoints.x2;
      y2 = endpoints.y2;
    } else {
      x1 = cA.x;
      y1 = cA.y;
      x2 = cB.x;
      y2 = cB.y;
    }

    const segmentPx = segmentPixelLength(x1, y1, x2, y2);
    if (segmentPx === 0) continue;

    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const fontSize = fontSizeForLabel(segmentPx, name);
    // Only the drawn baseline is lengthened. `fontSize` stays sized to the real
    // chord, and `cx`/`cy`/`angleDeg`/`segmentPx` below stay on it too, so
    // hover scaling and the GIF export's flat re-layout are unchanged.
    const textPath = extendLabelEndpoints(x1, y1, x2, y2);
    const pathOffset = labelPathCenterOffset(
      textPath.x1,
      textPath.y1,
      textPath.x2,
      textPath.y2,
      fontSize
    );

    labels.push({
      nationId,
      componentIndex,
      text: name,
      scope,
      x1,
      y1,
      x2,
      y2,
      cx,
      cy,
      angleDeg: labelAngleDeg(x1, y1, x2, y2),
      segmentPx,
      fontSize,
      pathD: labelArcPathD(
        textPath.x1,
        textPath.y1,
        textPath.x2,
        textPath.y2
      ),
      pathOffsetX: pathOffset.dx,
      pathOffsetY: pathOffset.dy,
    });
    componentIndex += 1;
  }

  return labels;
}

export function computeNationLabels(
  regionData: Record<string, NationRegionInput>,
  neighbors: ProvinceNeighbors,
  centroids: ProvinceCentroids,
  options?: ComputeNationLabelsOptions
): NationLabelSpec[] {
  const labels: NationLabelSpec[] = [];

  for (const [nationId, region] of Object.entries(regionData)) {
    const name = region.name?.trim();
    const provinces = labelControlProvinces(
      nationId,
      regionData,
      region.provinces ?? []
    );
    if (!name || !provinces?.length) continue;

    labels.push(
      ...labelsForProvinces(
        nationId,
        name,
        provinces,
        neighbors,
        centroids,
        "full",
        options
      )
    );
  }

  return labels;
}

export function cleanRegionName(name: string): string {
  return name
    .replace(/Â§/g, "§")
    .replace(/§{2,}/g, "§")
    .replace(/§x(?:§[0-9a-fA-F]){6}/g, "")
    .replace(/§[0-9A-FK-ORa-fk-or]/g, "")
    .replace(/§/g, "")
    .replace(/#(?:[0-9a-fA-F]{6})/g, "")
    .trim();
}

export function provincesForRegionLabel(
  regionId: string,
  mapType: MapMode,
  regionData: Record<string, NationRegionInput>,
  titleLayers: TitleLayers | null,
  mapObjects: LabelMapObject[]
): { provinces: number[]; scope: NationLabelScope } | null {
  if (mapType === "nation") {
    return provincesForNationLabel(regionId, regionData, mapObjects);
  }

  if (mapType === "trade") {
    if (!titleLayers) return null;
    const provinces = resolveTitleProvinces(regionId, "trade", titleLayers);
    if (!provinces.length) return null;
    return { provinces, scope: "full" };
  }

  if (mapType === "county") {
    const provinces = regionData[regionId]?.provinces ?? [];
    if (!provinces.length) return null;
    return { provinces, scope: "full" };
  }

  if (!TITLE_LABEL_MODES.has(mapType)) {
    return null;
  }

  if (!titleLayers) return null;

  const provinces = resolveTitleProvinces(regionId, mapType, titleLayers);
  if (!provinces.length) return null;

  return { provinces, scope: "full" };
}

export type NationLabelGeometry = {
  nationId: string;
  full: NationLabelSpec[];
  direct: NationLabelSpec[];
};

export type RegionLabelGeometryCache =
  | { mapType: "nation"; nations: NationLabelGeometry[] }
  | { mapType: Exclude<MapMode, "nation">; labels: NationLabelSpec[] };

export function provincesForRegionLabelGeometry(
  regionId: string,
  mapType: MapMode,
  regionData: Record<string, NationRegionInput>,
  titleLayers: TitleLayers | null
): { provinces: number[]; scope: NationLabelScope } | null {
  if (mapType === "trade") {
    if (!titleLayers) return null;
    const provinces = resolveTitleProvinces(regionId, "trade", titleLayers);
    if (!provinces.length) return null;
    return { provinces, scope: "full" };
  }

  if (mapType === "county") {
    const provinces = regionData[regionId]?.provinces ?? [];
    if (!provinces.length) return null;
    return { provinces, scope: "full" };
  }

  if (!TITLE_LABEL_MODES.has(mapType)) {
    return null;
  }

  if (!titleLayers) return null;

  const provinces = resolveTitleProvinces(regionId, mapType, titleLayers);
  if (!provinces.length) return null;

  return { provinces, scope: "full" };
}

/**
 * `computeRegionLabelGeometry` a region at a time: yields after each one, so a
 * caller can spread a mode's layout over several tasks. Laid out in one go,
 * the counties held the page for a quarter of a second on a first visit.
 */
export function* computeRegionLabelGeometrySteps(
  mapType: MapMode,
  regionData: Record<string, NationRegionInput>,
  titleLayers: TitleLayers | null,
  neighbors: ProvinceNeighbors,
  centroids: ProvinceCentroids,
  options?: ComputeNationLabelsOptions
): Generator<void, RegionLabelGeometryCache | null, void> {
  if (mapType === "nation") {
    const nations: NationLabelGeometry[] = [];
    const occupation = buildOccupationIndex(regionData);

    for (const nationId of Object.keys(regionData)) {
      const region = regionData[nationId];
      const rawName = region?.name?.trim();
      if (!rawName) continue;

      const fullProvinces = labelControlProvinces(
        nationId,
        regionData,
        fullRealmProvinces(nationId, regionData),
        occupation
      );
      if (!fullProvinces.length) continue;

      const full = labelsForProvinces(
        nationId,
        rawName,
        fullProvinces,
        neighbors,
        centroids,
        "full",
        options
      );

      let direct: NationLabelSpec[] = [];
      if (region?.subjects?.length) {
        const directProvinces = labelControlProvinces(
          nationId,
          regionData,
          directHoldingProvinces(nationId, regionData),
          occupation
        );
        if (directProvinces.length) {
          direct = labelsForProvinces(
            nationId,
            rawName,
            directProvinces,
            neighbors,
            centroids,
            "direct",
            options
          );
        }
      }

      nations.push({ nationId, full, direct });
      yield;
    }

    return { mapType: "nation", nations };
  }

  const labels: NationLabelSpec[] = [];

  for (const regionId of Object.keys(regionData)) {
    const region = regionData[regionId];
    if (TITLE_LABEL_MODES.has(mapType) && typeof region?.rgb !== "string") {
      continue;
    }
    if (
      mapType === "trade" &&
      (typeof region?.rgb !== "string" || !region?.size || region.size <= 0)
    ) {
      continue;
    }

    const resolved = provincesForRegionLabelGeometry(
      regionId,
      mapType,
      regionData,
      titleLayers
    );
    if (!resolved) continue;

    const rawName = region?.name?.trim();
    if (!rawName) continue;

    const name = cleanRegionName(rawName);
    if (!name) continue;

    labels.push(
      ...labelsForProvinces(
        regionId,
        name,
        resolved.provinces,
        neighbors,
        centroids,
        resolved.scope,
        options
      )
    );
    yield;
  }

  return { mapType, labels };
}

/** A mode's name layout, in one go. See `computeRegionLabelGeometrySteps`. */
export function computeRegionLabelGeometry(
  mapType: MapMode,
  regionData: Record<string, NationRegionInput>,
  titleLayers: TitleLayers | null,
  neighbors: ProvinceNeighbors,
  centroids: ProvinceCentroids,
  options?: ComputeNationLabelsOptions
): RegionLabelGeometryCache | null {
  const steps = computeRegionLabelGeometrySteps(
    mapType,
    regionData,
    titleLayers,
    neighbors,
    centroids,
    options
  );
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export function filterRegionLabelsForMapObjects(
  cache: RegionLabelGeometryCache | null,
  mapType: MapMode,
  mapObjects: LabelMapObject[]
): NationLabelSpec[] {
  if (!cache) return [];

  if (cache.mapType === "nation") {
    if (mapType !== "nation") return [];

    const labels: NationLabelSpec[] = [];

    for (const entry of cache.nations) {
      if (!isNationLabelVisible(entry.nationId, mapObjects)) continue;

      if (isDrilledSuzerainView(entry.nationId, mapObjects)) {
        if (entry.direct.length) {
          labels.push(...entry.direct);
        }
        continue;
      }

      labels.push(...entry.full);
    }

    return labels;
  }

  if (cache.mapType !== mapType) return [];

  return cache.labels;
}

export function computeVisibleRegionLabels(
  mapType: MapMode,
  regionData: Record<string, NationRegionInput>,
  titleLayers: TitleLayers | null,
  neighbors: ProvinceNeighbors,
  centroids: ProvinceCentroids,
  mapObjects: LabelMapObject[],
  options?: ComputeNationLabelsOptions
): NationLabelSpec[] {
  const geometry = computeRegionLabelGeometry(
    mapType,
    regionData,
    titleLayers,
    neighbors,
    centroids,
    options
  );
  return filterRegionLabelsForMapObjects(geometry, mapType, mapObjects);
}

export function computeVisibleNationLabels(
  regionData: Record<string, NationRegionInput>,
  neighbors: ProvinceNeighbors,
  centroids: ProvinceCentroids,
  mapObjects: LabelMapObject[],
  options?: ComputeNationLabelsOptions
): NationLabelSpec[] {
  return computeVisibleRegionLabels(
    "nation",
    regionData,
    null,
    neighbors,
    centroids,
    mapObjects,
    options
  );
}
