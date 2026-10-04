export const LABEL_MIN_INSET_PX = 40;
export const LABEL_INSET_PADDING_PX = 8;
export const LABEL_GRID_MAX_CANDIDATES = 150;
export const LABEL_CORRIDOR_SAMPLE_STEP_PX = 6;
export const LABEL_RADIAL_ANGLE_STEPS = 12;
export const LABEL_GLYPH_WIDTH_EM = 0.58;
export const LABEL_ARC_BULGE_RATIO = 0.08;
export const LABEL_TEXT_CENTER_OFFSET_EM = 0.38;

export type ProvinceLabelGridMeta = {
  mapWidth: number;
  mapHeight: number;
  gridWidth: number;
  gridHeight: number;
};

export type ProvinceLabelGrid = ProvinceLabelGridMeta & {
  cells: Uint16Array;
  scaleX: number;
  scaleY: number;
};

export type LabelEndpoints = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export function parseProvinceLabelGrid(
  meta: ProvinceLabelGridMeta,
  buffer: ArrayBuffer
): ProvinceLabelGrid {
  const expectedBytes = meta.gridWidth * meta.gridHeight * 2;
  if (buffer.byteLength < expectedBytes) {
    throw new Error(
      `Label grid buffer too small: ${buffer.byteLength} < ${expectedBytes}`
    );
  }

  return {
    ...meta,
    cells: new Uint16Array(buffer, 0, meta.gridWidth * meta.gridHeight),
    scaleX: meta.mapWidth / meta.gridWidth,
    scaleY: meta.mapHeight / meta.gridHeight,
  };
}

function segmentPixelLength(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

function fontSizeForLabel(segmentPx: number, text: string): number {
  const units = text.trim().length || 1;
  if (segmentPx <= 0) return 1;
  return Math.round(segmentPx / (units * LABEL_GLYPH_WIDTH_EM));
}

export function labelCorridorMargin(
  segmentPx: number,
  fontSize: number
): number {
  const textBand =
    fontSize * LABEL_TEXT_CENTER_OFFSET_EM + segmentPx * LABEL_ARC_BULGE_RATIO;
  return Math.max(LABEL_MIN_INSET_PX, textBand + LABEL_INSET_PADDING_PX);
}

export type GridSubRect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type GridStats = {
  maxProvinceId: number;
  /** Per province id: [minX, minY, maxX, maxY], -1 in slot 0 when absent. */
  bounds: Int32Array;
};

const gridStatsCache = new WeakMap<Uint16Array, GridStats>();

function computeGridStats(grid: ProvinceLabelGrid): GridStats {
  const { cells, gridWidth, gridHeight } = grid;

  let maxProvinceId = 0;
  for (let i = 0; i < cells.length; i += 1) {
    if (cells[i] > maxProvinceId) maxProvinceId = cells[i];
  }

  const bounds = new Int32Array((maxProvinceId + 1) * 4);
  bounds.fill(-1);

  for (let gy = 0; gy < gridHeight; gy += 1) {
    const row = gy * gridWidth;
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const b = cells[row + gx] * 4;
      if (bounds[b] < 0) {
        bounds[b] = gx;
        bounds[b + 1] = gy;
        bounds[b + 2] = gx;
        bounds[b + 3] = gy;
        continue;
      }
      if (gx < bounds[b]) bounds[b] = gx;
      if (gy < bounds[b + 1]) bounds[b + 1] = gy;
      if (gx > bounds[b + 2]) bounds[b + 2] = gx;
      if (gy > bounds[b + 3]) bounds[b + 3] = gy;
    }
  }

  return { maxProvinceId, bounds };
}

/** Cached per-grid province id extents; one full grid scan shared by all labels. */
export function getGridStats(grid: ProvinceLabelGrid): GridStats {
  const cached = gridStatsCache.get(grid.cells);
  if (cached) return cached;
  const stats = computeGridStats(grid);
  gridStatsCache.set(grid.cells, stats);
  return stats;
}

export function fullGridRect(grid: ProvinceLabelGrid): GridSubRect {
  return { x0: 0, y0: 0, x1: grid.gridWidth - 1, y1: grid.gridHeight - 1 };
}

/**
 * Grid-space bounding box of the cells owned by `provinceIds`, padded so that
 * every cell the distance transform can reach (and every clearance sample the
 * corridor search takes near the blob) stays inside it. Returns null when none
 * of the ids occur in the grid.
 */
export function componentSubRect(
  grid: ProvinceLabelGrid,
  provinceIds: number[]
): GridSubRect | null {
  const { bounds, maxProvinceId } = getGridStats(grid);

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  for (const provinceId of provinceIds) {
    if (!(provinceId >= 0) || provinceId > maxProvinceId) continue;
    const b = provinceId * 4;
    if (bounds[b] < 0) continue;
    if (bounds[b] < x0) x0 = bounds[b];
    if (bounds[b + 1] < y0) y0 = bounds[b + 1];
    if (bounds[b + 2] > x1) x1 = bounds[b + 2];
    if (bounds[b + 3] > y1) y1 = bounds[b + 3];
  }

  if (x1 < x0 || y1 < y0) return null;

  const cellScale = Math.min(grid.scaleX, grid.scaleY);
  const pad = Math.max(
    1,
    Math.ceil(cellScale > 0 ? LABEL_MIN_INSET_PX / cellScale : 1)
  );

  return {
    x0: Math.max(0, x0 - pad),
    y0: Math.max(0, y0 - pad),
    x1: Math.min(grid.gridWidth - 1, x1 + pad),
    y1: Math.min(grid.gridHeight - 1, y1 + pad),
  };
}

export function buildComponentMask(
  grid: ProvinceLabelGrid,
  provinceIds: number[],
  rect?: GridSubRect
): Uint8Array {
  const { cells, gridWidth, gridHeight } = grid;
  const { maxProvinceId } = getGridStats(grid);

  const allowed = new Uint8Array(maxProvinceId + 1);
  for (const provinceId of provinceIds) {
    if (!(provinceId >= 0) || provinceId > maxProvinceId) continue;
    allowed[provinceId] = 1;
  }

  const mask = new Uint8Array(gridWidth * gridHeight);
  const r = rect ?? fullGridRect(grid);

  for (let gy = r.y0; gy <= r.y1; gy += 1) {
    const row = gy * gridWidth;
    for (let gx = r.x0; gx <= r.x1; gx += 1) {
      const idx = row + gx;
      if (allowed[cells[idx]] === 1) {
        mask[idx] = 1;
      }
    }
  }

  return mask;
}

/**
 * Multi-source BFS clearance from forbidden territory, in map pixels (conservative).
 *
 * Seeds distance 0 at sea/foreign cells and owned land on TRUE grid edges.
 * Inland water and black gaps (cell 0) are walkable but do not seed, so
 * riverbanks keep clearance from forbidden borders only.
 *
 * When `rect` is given the work is confined to that sub-rect; cells outside it
 * are left at 0. Sub-rect borders interior to the grid must never seed.
 */
export function distanceTransform(
  mask: Uint8Array,
  grid: ProvinceLabelGrid,
  rect?: GridSubRect
): Float32Array {
  const { cells, gridWidth, gridHeight, scaleX, scaleY } = grid;
  const cellScale = Math.min(scaleX, scaleY);
  const dist = new Float32Array(gridWidth * gridHeight);
  const r = rect ?? fullGridRect(grid);

  const isCrossableGap = (idx: number) => cells[idx] === 0;
  const isWalkable = (idx: number) => mask[idx] === 1 || isCrossableGap(idx);

  for (let gy = r.y0; gy <= r.y1; gy += 1) {
    const row = gy * gridWidth;
    dist.fill(-1, row + r.x0, row + r.x1 + 1);
  }

  const rectArea = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  const queue = new Int32Array(rectArea);
  let tail = 0;

  for (let gy = r.y0; gy <= r.y1; gy += 1) {
    const row = gy * gridWidth;
    const onEdgeRow = gy === 0 || gy === gridHeight - 1;
    for (let gx = r.x0; gx <= r.x1; gx += 1) {
      const idx = row + gx;
      if (mask[idx] === 0) {
        if (isCrossableGap(idx)) {
          continue;
        }
        dist[idx] = 0;
        queue[tail++] = idx;
        continue;
      }
      if (onEdgeRow || gx === 0 || gx === gridWidth - 1) {
        dist[idx] = 0;
        queue[tail++] = idx;
      }
    }
  }

  let head = 0;
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % gridWidth;
    const y = (idx / gridWidth) | 0;
    const nextDist = dist[idx] + 1;

    if (x > r.x0) pushNeighbor(idx - 1, nextDist);
    if (x < r.x1) pushNeighbor(idx + 1, nextDist);
    if (y > r.y0) pushNeighbor(idx - gridWidth, nextDist);
    if (y < r.y1) pushNeighbor(idx + gridWidth, nextDist);
  }

  function pushNeighbor(neighbor: number, nextDist: number) {
    if (!isWalkable(neighbor) || dist[neighbor] >= 0) return;
    dist[neighbor] = nextDist;
    queue[tail++] = neighbor;
  }

  for (let gy = r.y0; gy <= r.y1; gy += 1) {
    const row = gy * gridWidth;
    for (let gx = r.x0; gx <= r.x1; gx += 1) {
      const idx = row + gx;
      if (mask[idx] === 1) {
        if (dist[idx] >= 0) {
          dist[idx] *= cellScale;
        } else {
          dist[idx] = Number.POSITIVE_INFINITY;
        }
      } else {
        dist[idx] = 0;
      }
    }
  }

  return dist;
}

/** Cell 0 = crossable inland water or black gaps. Sea provinces are non-zero and block corridors. */
export function isLabelCorridorWaterCell(
  grid: ProvinceLabelGrid,
  gridIndex: number
): boolean {
  return grid.cells[gridIndex] === 0;
}

function clearanceAt(
  grid: ProvinceLabelGrid,
  dist: Float32Array,
  mapX: number,
  mapY: number
): number {
  const gx = Math.min(
    grid.gridWidth - 1,
    Math.max(0, Math.floor(mapX / grid.scaleX))
  );
  const gy = Math.min(
    grid.gridHeight - 1,
    Math.max(0, Math.floor(mapY / grid.scaleY))
  );
  const idx = gy * grid.gridWidth + gx;
  if (isLabelCorridorWaterCell(grid, idx)) {
    return Number.POSITIVE_INFINITY;
  }
  return dist[idx];
}

function orientLabelEndpoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { x1: number; y1: number; x2: number; y2: number } {
  const rad = Math.atan2(y2 - y1, x2 - x1);
  const deg = (rad * 180) / Math.PI;
  if (deg <= -90 || deg > 90) {
    return { x1: x2, y1: y2, x2: x1, y2: y1 };
  }
  return { x1, y1, x2, y2 };
}

function quadraticPoint(
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  t: number
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * ax + 2 * u * t * cx + t * t * bx,
    y: u * u * ay + 2 * u * t * cy + t * t * by,
  };
}

function arcControlPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { cx: number; cy: number } {
  const oriented = orientLabelEndpoints(x1, y1, x2, y2);
  const ax = oriented.x1;
  const ay = oriented.y1;
  const bx = oriented.x2;
  const by = oriented.y2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return { cx: ax, cy: ay };
  }
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const nx = dy / len;
  const ny = -dx / len;
  const bulge = len * LABEL_ARC_BULGE_RATIO;
  return { cx: mx + nx * bulge, cy: my + ny * bulge };
}

export function corridorClear(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  margin: number,
  grid: ProvinceLabelGrid,
  dist: Float32Array
): boolean {
  const len = segmentPixelLength(x1, y1, x2, y2);
  if (len === 0) {
    return clearanceAt(grid, dist, x1, y1) >= margin;
  }

  const step = Math.max(
    LABEL_CORRIDOR_SAMPLE_STEP_PX,
    Math.min(grid.scaleX, grid.scaleY) * 0.5
  );
  const steps = Math.max(2, Math.ceil(len / step));
  const { cx, cy } = arcControlPoint(x1, y1, x2, y2);

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const chordX = x1 + (x2 - x1) * t;
    const chordY = y1 + (y2 - y1) * t;
    const arc = quadraticPoint(x1, y1, cx, cy, x2, y2, t);

    if (clearanceAt(grid, dist, chordX, chordY) < margin) return false;
    if (clearanceAt(grid, dist, arc.x, arc.y) < margin) return false;
  }

  return true;
}

type CandidatePoint = { x: number; y: number };

function collectCandidates(
  grid: ProvinceLabelGrid,
  mask: Uint8Array,
  dist: Float32Array,
  minClearance: number,
  rect?: GridSubRect
): CandidatePoint[] {
  const { gridWidth, scaleX, scaleY } = grid;
  const points: CandidatePoint[] = [];
  const r = rect ?? fullGridRect(grid);

  for (let gy = r.y0; gy <= r.y1; gy += 1) {
    for (let gx = r.x0; gx <= r.x1; gx += 1) {
      const idx = gy * gridWidth + gx;
      if (mask[idx] === 0) continue;
      if (dist[idx] < minClearance) continue;
      points.push({
        x: (gx + 0.5) * scaleX,
        y: (gy + 0.5) * scaleY,
      });
    }
  }

  if (points.length <= LABEL_GRID_MAX_CANDIDATES) {
    return points;
  }

  const stride = Math.ceil(points.length / LABEL_GRID_MAX_CANDIDATES);
  return points.filter((_, index) => index % stride === 0);
}

/**
 * Every pair of candidates, longest first (ties in the order the pairs were
 * listed), handed out lazily from a heap. A 150-candidate blob has some
 * 11,000 pairs, but a label usually fits within the first thousand or so, so
 * sorting them all was most of the work of placing it. Built once per label
 * and shared by the passes at each margin: the order does not depend on it.
 */
export class LongestFirstPairs {
  readonly a: Uint32Array;
  readonly b: Uint32Array;
  readonly len: Float64Array;
  private readonly heap: Uint32Array;
  private heapSize: number;
  /** The pairs handed out so far, in order. */
  private readonly order: Uint32Array;
  private handedOut = 0;

  constructor(candidates: CandidatePoint[]) {
    const n = candidates.length;
    const count = (n * (n - 1)) / 2;
    this.a = new Uint32Array(count);
    this.b = new Uint32Array(count);
    this.len = new Float64Array(count);
    let k = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        this.a[k] = i;
        this.b[k] = j;
        this.len[k] = segmentPixelLength(
          candidates[i].x,
          candidates[i].y,
          candidates[j].x,
          candidates[j].y
        );
        k += 1;
      }
    }
    this.heap = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) this.heap[i] = i;
    this.heapSize = count;
    for (let i = (count >> 1) - 1; i >= 0; i -= 1) this.siftDown(i);
    this.order = new Uint32Array(count);
  }

  get count(): number {
    return this.len.length;
  }

  /** The `k`th longest pair's index, or -1 past the last. */
  at(k: number): number {
    while (this.handedOut <= k && this.heapSize > 0) {
      this.order[this.handedOut] = this.heap[0];
      this.handedOut += 1;
      this.heapSize -= 1;
      this.heap[0] = this.heap[this.heapSize];
      this.siftDown(0);
    }
    return k < this.handedOut ? this.order[k] : -1;
  }

  /** Strictly before: longer, or as long and listed earlier. */
  private before(x: number, y: number): boolean {
    const lx = this.len[x];
    const ly = this.len[y];
    return lx > ly || (lx === ly && x < y);
  }

  private siftDown(start: number): void {
    const { heap } = this;
    let i = start;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= this.heapSize) return;
      const right = left + 1;
      let best = left;
      if (right < this.heapSize && this.before(heap[right], heap[left])) best = right;
      if (!this.before(heap[best], heap[i])) return;
      const swap = heap[i];
      heap[i] = heap[best];
      heap[best] = swap;
      i = best;
    }
  }
}

function tryFindSegment(
  candidates: CandidatePoint[],
  pairs: LongestFirstPairs,
  text: string,
  grid: ProvinceLabelGrid,
  dist: Float32Array,
  marginScale: number
): LabelEndpoints | null {
  for (let k = 0; k < pairs.count; k += 1) {
    const index = pairs.at(k);
    const pairLen = pairs.len[index];
    const a = candidates[pairs.a[index]];
    const b = candidates[pairs.b[index]];
    const fontSize = fontSizeForLabel(pairLen, text);
    const margin = labelCorridorMargin(pairLen, fontSize) * marginScale;
    if (corridorClear(a.x, a.y, b.x, b.y, margin, grid, dist)) {
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
  }

  return null;
}

export function findLabelAnchor(
  mask: Uint8Array,
  dist: Float32Array,
  grid: ProvinceLabelGrid,
  rect?: GridSubRect
): { x: number; y: number } | null {
  let bestIdx = -1;
  let bestClearance = -1;

  const { gridWidth } = grid;
  const r = rect ?? fullGridRect(grid);

  for (let gy = r.y0; gy <= r.y1; gy += 1) {
    const row = gy * gridWidth;
    for (let gx = r.x0; gx <= r.x1; gx += 1) {
      const idx = row + gx;
      if (mask[idx] === 0) continue;
      const clearance = dist[idx];
      if (clearance > bestClearance) {
        bestClearance = clearance;
        bestIdx = idx;
      }
    }
  }

  if (bestIdx < 0) return null;

  const gx = bestIdx % grid.gridWidth;
  const gy = (bestIdx / grid.gridWidth) | 0;
  return {
    x: (gx + 0.5) * grid.scaleX,
    y: (gy + 0.5) * grid.scaleY,
  };
}

export function raycastHalfExtent(
  anchorX: number,
  anchorY: number,
  angle: number,
  margin: number,
  grid: ProvinceLabelGrid,
  dist: Float32Array,
  mask: Uint8Array
): number {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const step = Math.max(
    LABEL_CORRIDOR_SAMPLE_STEP_PX,
    Math.min(grid.scaleX, grid.scaleY) * 0.5
  );
  const maxDist = Math.max(grid.mapWidth, grid.mapHeight) * 2;
  let distance = 0;

  while (distance + step <= maxDist) {
    const nextDist = distance + step;
    const x = anchorX + ux * nextDist;
    const y = anchorY + uy * nextDist;

    if (x < 0 || y < 0 || x > grid.mapWidth || y > grid.mapHeight) {
      break;
    }

    const gx = Math.floor(x / grid.scaleX);
    const gy = Math.floor(y / grid.scaleY);
    if (gx < 0 || gy < 0 || gx >= grid.gridWidth || gy >= grid.gridHeight) {
      break;
    }

    const idx = gy * grid.gridWidth + gx;
    if (!isLabelCorridorWaterCell(grid, idx) && mask[idx] === 0) {
      break;
    }

    if (clearanceAt(grid, dist, x, y) < margin) {
      break;
    }

    distance = nextDist;
  }

  return distance;
}

export function tryRadialSegment(
  mask: Uint8Array,
  dist: Float32Array,
  grid: ProvinceLabelGrid,
  text: string,
  marginScale: number,
  anchor?: { x: number; y: number },
  rect?: GridSubRect
): LabelEndpoints | null {
  const center = anchor ?? findLabelAnchor(mask, dist, grid, rect);
  if (!center) return null;

  const anchorClearance = clearanceAt(grid, dist, center.x, center.y);
  if (anchorClearance <= 0) return null;

  let best: { endpoints: LabelEndpoints; len: number } | null = null;

  for (let i = 0; i < LABEL_RADIAL_ANGLE_STEPS; i += 1) {
    const angle = (i / LABEL_RADIAL_ANGLE_STEPS) * Math.PI;
    const probeMargin = 1;
    let forward = raycastHalfExtent(
      center.x,
      center.y,
      angle,
      probeMargin,
      grid,
      dist,
      mask
    );
    let backward = raycastHalfExtent(
      center.x,
      center.y,
      angle + Math.PI,
      probeMargin,
      grid,
      dist,
      mask
    );
    let totalLen = forward + backward;
    if (totalLen <= 0) continue;

    const fontSize = fontSizeForLabel(totalLen, text);
    const desiredMargin =
      labelCorridorMargin(totalLen, fontSize) * marginScale;
    const effectiveMargin = Math.min(desiredMargin, anchorClearance);

    forward = raycastHalfExtent(
      center.x,
      center.y,
      angle,
      effectiveMargin,
      grid,
      dist,
      mask
    );
    backward = raycastHalfExtent(
      center.x,
      center.y,
      angle + Math.PI,
      effectiveMargin,
      grid,
      dist,
      mask
    );
    totalLen = forward + backward;
    if (totalLen <= 0) continue;

    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const x1 = center.x - backward * ux;
    const y1 = center.y - backward * uy;
    const x2 = center.x + forward * ux;
    const y2 = center.y + forward * uy;

    if (!corridorClear(x1, y1, x2, y2, effectiveMargin, grid, dist)) {
      continue;
    }

    if (!best || totalLen > best.len) {
      best = {
        endpoints: { x1, y1, x2, y2 },
        len: totalLen,
      };
    }
  }

  return best?.endpoints ?? null;
}

export function insetLabelEndpoints(
  componentIds: number[],
  text: string,
  grid: ProvinceLabelGrid,
  seed: LabelEndpoints
): LabelEndpoints | null {
  const rect = componentSubRect(grid, componentIds) ?? fullGridRect(grid);
  const mask = buildComponentMask(grid, componentIds, rect);
  const dist = distanceTransform(mask, grid, rect);
  const cellScale = Math.min(grid.scaleX, grid.scaleY);
  const candidates = collectCandidates(
    grid,
    mask,
    dist,
    Math.min(LABEL_MIN_INSET_PX, cellScale),
    rect
  );
  candidates.push(
    { x: seed.x1, y: seed.y1 },
    { x: seed.x2, y: seed.y2 }
  );

  if (candidates.length) {
    const pairs = new LongestFirstPairs(candidates);
    for (const marginScale of [1, 0.75, 0.5]) {
      const found = tryFindSegment(candidates, pairs, text, grid, dist, marginScale);
      if (found) {
        return found;
      }
    }
  }

  for (const marginScale of [1, 0.75, 0.5]) {
    const radial = tryRadialSegment(
      mask,
      dist,
      grid,
      text,
      marginScale,
      undefined,
      rect
    );
    if (radial) {
      return radial;
    }
  }

  return null;
}

export async function decompressGzipBuffer(
  compressed: ArrayBuffer
): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is not available in this environment");
  }

  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}
