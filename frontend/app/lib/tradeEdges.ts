import type {
  TradeEdge,
  TradeEdgeMode,
  TradeNetwork,
} from "../components/map/types";

/**
 * Hub links are one pale stroke (`#b6e3f5`, width 9, opacity 0.92) and
 * distinguish mode by dash: sea `20 13`, air `2 14`, rail solid. Trade edges
 * keep that dash language, each mode in its own duller colour, drawn thinner
 * so a guild's own links still read on top.
 */
const MODE_STYLE: Record<
  TradeEdgeMode,
  { color: string; dash?: string; label: string }
> = {
  sea: { color: "#8fb7cc", dash: "20 13", label: "Sea" },
  rail: { color: "#c6b48a", label: "Rail" },
  air: { color: "#b9b3c8", dash: "2 14", label: "Air" },
};

const TRADE_EDGE_WIDTH = 4;
const TRADE_EDGE_OPACITY = 0.5;
const TRADE_EDGE_GLOBAL_WIDTH = 5.5;
const TRADE_EDGE_GLOBAL_OPACITY = 0.72;

/** Screen pixels. Wide enough to catch a thin stroke when the map is zoomed out. */
const TRADE_EDGE_HIT_SCREEN_PX = 8;

/**
 * Map pixels per grid cell. A sea edge is a chain of short province steps, so
 * a cell holds the segments that pass through it and a hover checks that cell
 * rather than every edge. The map is 6400 px; anything that spans more cells
 * than a real route can is filed aside so a bad coordinate cannot fill the grid.
 */
const TRADE_EDGE_CELL = 256;
const TRADE_EDGE_MAX_CELL_SPAN = 64;

export type TradeEdgeStroke = {
  key: string;
  mode: TradeEdgeMode;
  color: string;
  dash?: string;
  width: number;
  opacity: number;
  points: Array<[number, number]>;
  d: string;
  label: string;
};

type SegmentRef = {
  strokeIndex: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type TradeEdgeIndex = {
  cellSize: number;
  buckets: Map<string, SegmentRef[]>;
  long: SegmentRef[];
};

export type TradeEdgeGeometry = {
  strokes: TradeEdgeStroke[];
  index: TradeEdgeIndex;
};

const EMPTY_INDEX: TradeEdgeIndex = {
  cellSize: TRADE_EDGE_CELL,
  buckets: new Map(),
  long: [],
};

export const EMPTY_TRADE_EDGE_GEOMETRY: TradeEdgeGeometry = {
  strokes: [],
  index: EMPTY_INDEX,
};

function finitePoint(x: unknown, y: unknown): [number, number] | null {
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function pathPoints(path: TradeEdge["path"]): Array<[number, number]> {
  if (!Array.isArray(path)) return [];
  const points: Array<[number, number]> = [];
  for (const point of path) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const placed = finitePoint(point[0], point[1]);
    if (placed) points.push(placed);
  }
  return points;
}

function pathD(points: Array<[number, number]>): string {
  const [first, ...rest] = points;
  let d = `M ${first[0]} ${first[1]}`;
  for (const [x, y] of rest) d += ` L ${x} ${y}`;
  return d;
}

function globalNetworkNames(networks: TradeNetwork[]): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(networks)) return names;
  for (const network of networks) {
    if (!network || typeof network !== "object") continue;
    if (network.global !== true) continue;
    if (typeof network.name !== "string" || network.name.length === 0) continue;
    names.add(network.name);
  }
  return names;
}

function strokeFromEdge(
  edge: TradeEdge,
  index: number,
  globalNames: Set<string>
): { stroke: TradeEdgeStroke; global: boolean } | null {
  if (!edge || typeof edge !== "object") return null;
  const style = MODE_STYLE[edge.mode];
  if (!style) return null;
  const from = finitePoint(edge.from?.map_x, edge.from?.map_y);
  const to = finitePoint(edge.to?.map_x, edge.to?.map_y);
  if (!from || !to) return null;

  const points =
    edge.mode === "air" ? [from, to] : [from, ...pathPoints(edge.path), to];
  if (points.length < 2) return null;

  const name = typeof edge.network === "string" ? edge.network : "";
  const global = name.length > 0 && globalNames.has(name);
  return {
    global,
    stroke: {
      key: `${name}:${edge.from?.installation_id ?? ""}:${edge.to?.installation_id ?? ""}:${edge.mode}:${index}`,
      mode: edge.mode,
      color: style.color,
      dash: style.dash,
      width: global ? TRADE_EDGE_GLOBAL_WIDTH : TRADE_EDGE_WIDTH,
      opacity: global ? TRADE_EDGE_GLOBAL_OPACITY : TRADE_EDGE_OPACITY,
      points,
      d: pathD(points),
      label: `${name} · ${style.label}`,
    },
  };
}

function buildIndex(strokes: TradeEdgeStroke[]): TradeEdgeIndex {
  const buckets = new Map<string, SegmentRef[]>();
  const long: SegmentRef[] = [];
  const cellSize = TRADE_EDGE_CELL;
  for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex++) {
    const points = strokes[strokeIndex].points;
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      const segment: SegmentRef = { strokeIndex, x1, y1, x2, y2 };
      const c0x = Math.floor(Math.min(x1, x2) / cellSize);
      const c1x = Math.floor(Math.max(x1, x2) / cellSize);
      const c0y = Math.floor(Math.min(y1, y2) / cellSize);
      const c1y = Math.floor(Math.max(y1, y2) / cellSize);
      if (
        c1x - c0x > TRADE_EDGE_MAX_CELL_SPAN ||
        c1y - c0y > TRADE_EDGE_MAX_CELL_SPAN
      ) {
        long.push(segment);
        continue;
      }
      for (let cx = c0x; cx <= c1x; cx++) {
        for (let cy = c0y; cy <= c1y; cy++) {
          const key = `${cx},${cy}`;
          const bucket = buckets.get(key);
          if (bucket) bucket.push(segment);
          else buckets.set(key, [segment]);
        }
      }
    }
  }
  return { cellSize, buckets, long };
}

export function buildTradeEdgeGeometry(
  edges: TradeEdge[],
  networks: TradeNetwork[]
): TradeEdgeGeometry {
  if (!Array.isArray(edges) || edges.length === 0) return EMPTY_TRADE_EDGE_GEOMETRY;
  const globalNames = globalNetworkNames(networks);
  const plain: TradeEdgeStroke[] = [];
  const prominent: TradeEdgeStroke[] = [];
  for (let i = 0; i < edges.length; i++) {
    const built = strokeFromEdge(edges[i], i, globalNames);
    if (!built) continue;
    (built.global ? prominent : plain).push(built.stroke);
  }
  const strokes = plain.concat(prominent);
  if (strokes.length === 0) return EMPTY_TRADE_EDGE_GEOMETRY;
  return { strokes, index: buildIndex(strokes) };
}

function distanceToSegmentSquared(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) {
    const ox = x - x1;
    const oy = y - y1;
    return ox * ox + oy * oy;
  }
  let t = ((x - x1) * dx + (y - y1) * dy) / length2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  const ox = x - px;
  const oy = y - py;
  return ox * ox + oy * oy;
}

export function pickTradeEdgeAt(
  geometry: TradeEdgeGeometry,
  x: number,
  y: number,
  displayScale: number
): TradeEdgeStroke | null {
  if (!geometry.strokes.length || !(displayScale > 0)) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const tolerance = Math.max(
    TRADE_EDGE_HIT_SCREEN_PX / displayScale,
    TRADE_EDGE_GLOBAL_WIDTH / 2
  );
  const { cellSize, buckets, long } = geometry.index;
  const c0x = Math.floor((x - tolerance) / cellSize);
  const c1x = Math.floor((x + tolerance) / cellSize);
  const c0y = Math.floor((y - tolerance) / cellSize);
  const c1y = Math.floor((y + tolerance) / cellSize);

  let best: TradeEdgeStroke | null = null;
  let bestDist = tolerance * tolerance;
  let bestIndex = -1;
  const consider = (segment: SegmentRef) => {
    const dist2 = distanceToSegmentSquared(
      x,
      y,
      segment.x1,
      segment.y1,
      segment.x2,
      segment.y2
    );
    if (dist2 > bestDist) return;
    if (dist2 < bestDist || segment.strokeIndex > bestIndex) {
      best = geometry.strokes[segment.strokeIndex];
      bestDist = dist2;
      bestIndex = segment.strokeIndex;
    }
  };

  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cy = c0y; cy <= c1y; cy++) {
      const bucket = buckets.get(`${cx},${cy}`);
      if (!bucket) continue;
      for (const segment of bucket) consider(segment);
    }
  }
  for (const segment of long) consider(segment);
  return best;
}
