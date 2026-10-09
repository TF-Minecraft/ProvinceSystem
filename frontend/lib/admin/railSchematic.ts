/**
 * The rail network redrawn as an Underground-style diagram: every run of
 * track straight, at 0, 45 or 90 degrees, and crowded stops spread apart,
 * while each stop keeps its place relative to the others (north stays north
 * of south, west stays west of east).
 *
 * Stops, junctions and track ends are the diagram's nodes. Each axis is
 * stretched on its own (and the whole kept close to square): halfway between the real distances and the nodes'
 * order along that axis, so a cluster of stops gets room and long empty
 * stretches shrink. Nodes then snap to a grid, and each piece of track
 * between them becomes one or two straight runs.
 */
import type { Bounds, RailNetwork, RailPoint } from "./rail";

/** x right, y down, in diagram units. */
export type Pt = [number, number];

export type SchematicTrack = { id: string; line: number; path: Pt[] };

export type SchematicStop = {
  /** Index into `network.stops`. */
  index: number;
  at: Pt;
  /** Unit vector from the stop towards its name: the side its tick points to. */
  side: Pt;
  /** The track's direction at the stop. */
  along: Pt;
  /** At a track end that no junction joins: drawn as a bar across the line. */
  terminus: boolean;
};

export type SchematicEnd = { at: Pt; along: Pt; line: number };

export type SchematicStretch = { kind: "broken" | "damaged"; line: number; path: Pt[] };

export type Schematic = {
  width: number;
  height: number;
  tracks: SchematicTrack[];
  stops: SchematicStop[];
  /** Track ends without a stop or junction. */
  ends: SchematicEnd[];
  stretches: SchematicStretch[];
  /** Where a place in the world falls on the diagram (before snapping). */
  project: (point: RailPoint) => Pt;
};

/** The diagram's longer side, before its margin. */
export const SCHEMATIC_SIZE = 1000;
/** Nodes snap to a grid of this many units. */
export const GRID = 25;
export const MARGIN = 90;
/** Places this close together, in blocks, are the same node. */
const SAME_PLACE = 6;
/** A stop this close to the end of its track, in blocks, is drawn at the end. */
const END_STOP = 120;
/** Half real distance, half order. */
const SPREAD = 0.5;

type Key = { along: number; node: number };
type Mark = { along: number; at: RailPoint; node: number | null };

function cumulative(points: RailPoint[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return out;
}

function pointAlong(points: RailPoint[], cum: number[], along: number): RailPoint {
  if (points.length === 1) return points[0];
  const total = cum[cum.length - 1];
  const s = Math.max(0, Math.min(total, along));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const span = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / span;
  const [x0, z0] = points[i - 1];
  const [x1, z1] = points[i];
  return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
}

/** Distance along the track to the point on it nearest `p`, and how far away that is. */
function project(points: RailPoint[], cum: number[], p: RailPoint): { along: number; distance: number } {
  let best = { along: 0, distance: Infinity };
  for (let i = 1; i < points.length; i++) {
    const [x0, z0] = points[i - 1];
    const [x1, z1] = points[i];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len2 = dx * dx + dz * dz;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - x0) * dx + (p[1] - z0) * dz) / len2)) : 0;
    const d = Math.hypot(x0 + dx * t - p[0], z0 + dz * t - p[1]);
    if (d < best.distance) best = { along: cum[i - 1] + Math.sqrt(len2) * t, distance: d };
  }
  return best;
}

/** Douglas–Peucker: the indices of the points kept. */
function simplify(points: RailPoint[], tolerance: number): number[] {
  const keep = new Set([0, points.length - 1]);
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [x0, z0] = points[a];
    const [x1, z1] = points[b];
    const len = Math.hypot(x1 - x0, z1 - z0);
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, z] = points[i];
      const d = len ? Math.abs((x1 - x0) * (z0 - z) - (x0 - x) * (z1 - z0)) / len : Math.hypot(x - x0, z - z0);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tolerance) {
      keep.add(at);
      stack.push([a, at], [at, b]);
    }
  }
  return [...keep].sort((p, q) => p - q);
}

/** Where a stop is drawn along its track: at the end when it is nearly there, so no stub runs past it. */
function stopAlong(track: { length: number; loop: boolean }, along: number): number {
  if (track.loop) return along;
  if (along <= END_STOP) return 0;
  if (track.length - along <= END_STOP) return track.length;
  return along;
}

/** A monotone stretch of one axis: halfway between the real positions and their order. */
function stretch(values: number[], out: number): (v: number) => number {
  const sorted = [...new Set(values.map((v) => Math.round(v)))].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  if (sorted.length < 2 || hi === lo) return () => out / 2;
  const targets = sorted.map((v, i) => out * (SPREAD * ((v - lo) / (hi - lo)) + (1 - SPREAD) * (i / (sorted.length - 1))));
  return (v) => {
    if (v <= lo) return targets[0] + ((v - lo) / (hi - lo)) * out * SPREAD;
    if (v >= hi) return targets[targets.length - 1] + ((v - hi) / (hi - lo)) * out * SPREAD;
    let i = 1;
    while (sorted[i] < v) i++;
    const t = (v - sorted[i - 1]) / (sorted[i] - sorted[i - 1]);
    return targets[i - 1] + (targets[i] - targets[i - 1]) * t;
  };
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** One or two straight runs from `a` to `b`, the second at 45 degrees to the first; the bend nearest `via` wins. */
export function octilinear(a: Pt, b: Pt, via: Pt | null): Pt[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 1e-6 || ay < 1e-6 || Math.abs(ax - ay) < 1e-6) return [a, b];
  const d = Math.min(ax, ay);
  const diagonal: Pt = [sign(dx) * d, sign(dy) * d];
  const diagonalFirst: Pt = [a[0] + diagonal[0], a[1] + diagonal[1]];
  const straightFirst: Pt = [b[0] - diagonal[0], b[1] - diagonal[1]];
  if (!via) return [a, straightFirst, b];
  const miss = (bend: Pt) => Math.min(segmentDistance(via, a, bend), segmentDistance(via, bend, b));
  return [a, miss(diagonalFirst) < miss(straightFirst) ? diagonalFirst : straightFirst, b];
}

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}

const unit = (v: Pt): Pt => {
  const len = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / len, v[1] / len];
};

/** A path with distances along the track at each point, so a stretch of track can be found on it. */
type Measured = { path: Pt[]; along: number[] };

function directionAt(m: Measured, along: number): Pt {
  const n = m.path.length;
  for (let i = 1; i < n; i++) {
    const seg: Pt = [m.path[i][0] - m.path[i - 1][0], m.path[i][1] - m.path[i - 1][1]];
    if (Math.hypot(seg[0], seg[1]) < 1e-6) continue;
    if (m.along[i] > along + 1e-6 || i === n - 1) return unit(seg);
  }
  return [1, 0];
}

function pointOn(m: Measured, along: number): Pt {
  const n = m.path.length;
  if (along <= m.along[0]) return m.path[0];
  for (let i = 1; i < n; i++) {
    if (m.along[i] >= along) {
      const span = m.along[i] - m.along[i - 1] || 1;
      const t = (along - m.along[i - 1]) / span;
      return [m.path[i - 1][0] + (m.path[i][0] - m.path[i - 1][0]) * t, m.path[i - 1][1] + (m.path[i][1] - m.path[i - 1][1]) * t];
    }
  }
  return m.path[n - 1];
}

function piece(m: Measured, from: number, to: number): Pt[] {
  const out: Pt[] = [pointOn(m, from)];
  for (let i = 0; i < m.path.length; i++) if (m.along[i] > from && m.along[i] < to) out.push(m.path[i]);
  out.push(pointOn(m, to));
  return out;
}

export function buildSchematic(network: RailNetwork): Schematic {
  const tracks = network.tracks.filter((t) => t.points.length >= 2);
  const cums = new Map(tracks.map((t) => [t.id, cumulative(t.points)]));

  // Every place the diagram must show on each track: its ends, its stops and its junctions.
  const marks = new Map<string, Mark[]>();
  for (const track of tracks) {
    const cum = cums.get(track.id)!;
    const list: Mark[] = [
      { along: 0, at: track.points[0], node: null },
      { along: track.length, at: track.points[track.points.length - 1], node: null },
    ];
    for (const stop of network.stops) {
      if (stop.track === track.id) {
        const along = stopAlong(track, stop.along);
        list.push({ along, at: pointAlong(track.points, cum, along), node: null });
      }
    }
    for (const junction of network.junctions) {
      const hit = project(track.points, cum, junction.at);
      if (hit.distance <= SAME_PLACE) list.push({ along: hit.along, at: pointAlong(track.points, cum, hit.along), node: null });
    }
    marks.set(track.id, list);
  }

  // Marks in the same place, on one track or several, are one node.
  const nodes: { at: RailPoint }[] = [];
  for (const list of marks.values()) {
    for (const mark of list) {
      const found = nodes.findIndex((n) => Math.hypot(n.at[0] - mark.at[0], n.at[1] - mark.at[1]) <= SAME_PLACE);
      if (found >= 0) mark.node = found;
      else {
        mark.node = nodes.length;
        nodes.push({ at: mark.at });
      }
    }
  }

  // Each axis stretched separately, keeping the network's shape roughly as wide as it is tall.
  const all = tracks.flatMap((t) => t.points);
  const xs = all.map((p) => p[0]);
  const zs = all.map((p) => p[1]);
  const spanX = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const spanZ = Math.max(1, Math.max(...zs) - Math.min(...zs));
  // Close to square, as the frame is: a long thin network gets taller and its names more room.
  const aspect = Math.max(0.75, Math.min(1.33, spanX / spanZ));
  const width = aspect >= 1 ? SCHEMATIC_SIZE : SCHEMATIC_SIZE * aspect;
  const height = aspect >= 1 ? SCHEMATIC_SIZE / aspect : SCHEMATIC_SIZE;
  const anchors = nodes.map((n) => n.at);
  const fx = all.length ? stretch([...anchors.map((p) => p[0]), Math.min(...xs), Math.max(...xs)], width) : () => 0;
  const fz = all.length ? stretch([...anchors.map((p) => p[1]), Math.min(...zs), Math.max(...zs)], height) : () => 0;
  const toDiagram = ([x, z]: RailPoint): Pt => [fx(x) + MARGIN, fz(z) + MARGIN];

  // Nodes snap to the grid, each to its own point.
  const taken = new Map<string, number>();
  const snapped: Pt[] = nodes.map((n, i) => {
    const [x, y] = toDiagram(n.at);
    const gx = Math.round(x / GRID);
    const gy = Math.round(y / GRID);
    for (let ring = 0; ring < 6; ring++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring || taken.has(`${gx + dx},${gy + dy}`)) continue;
          const d = Math.hypot((gx + dx) * GRID - x, (gy + dy) * GRID - y);
          if (d < bestD) {
            bestD = d;
            best = [gx + dx, gy + dy];
          }
        }
      }
      if (best) {
        taken.set(`${best[0]},${best[1]}`, i);
        return [best[0] * GRID, best[1] * GRID];
      }
    }
    return [gx * GRID, gy * GRID];
  });
  const snap = (p: Pt): Pt => [Math.round(p[0] / GRID) * GRID, Math.round(p[1] / GRID) * GRID];

  // Each track: node to node, keeping the larger bends of the real track, then straightened.
  const tolerance = Math.max(spanX, spanZ) * 0.04;
  const measured = new Map<string, Measured>();
  const out: SchematicTrack[] = [];
  for (const track of tracks) {
    const cum = cums.get(track.id)!;
    const keys: Key[] = [...marks.get(track.id)!]
      .sort((a, b) => a.along - b.along)
      .map((m) => ({ along: Math.max(0, Math.min(track.length, m.along)), node: m.node! }));
    const stations: { at: Pt; along: number; real: RailPoint }[] = [];
    keys.forEach((key, k) => {
      if (k > 0) {
        // The bigger bends between this node and the last, as extra points.
        const prev = keys[k - 1];
        const inner = track.points
          .map((p, i) => ({ p, s: cum[i] }))
          .filter(({ s }) => s > prev.along && s < key.along);
        const run: RailPoint[] = [nodes[prev.node].at, ...inner.map((q) => q.p), nodes[key.node].at];
        const kept = simplify(run, tolerance).slice(1, -1);
        for (const i of kept) {
          const p = snap(toDiagram(run[i]));
          const last = stations[stations.length - 1].at;
          if (p[0] !== last[0] || p[1] !== last[1]) stations.push({ at: p, along: inner[i - 1].s, real: run[i] });
        }
      }
      const at = snapped[key.node];
      const last = stations[stations.length - 1];
      if (last && last.at[0] === at[0] && last.at[1] === at[1]) {
        last.along = key.along;
        return;
      }
      stations.push({ at, along: key.along, real: pointAlong(track.points, cum, key.along) });
    });

    const path: Pt[] = [stations[0].at];
    const along: number[] = [stations[0].along];
    for (let i = 1; i < stations.length; i++) {
      const a = stations[i - 1];
      const b = stations[i];
      const mid = toDiagram(pointAlong(track.points, cum, (a.along + b.along) / 2));
      const route = octilinear(a.at, b.at, mid);
      if (route.length === 3) {
        const l1 = Math.hypot(route[1][0] - a.at[0], route[1][1] - a.at[1]);
        const l2 = Math.hypot(b.at[0] - route[1][0], b.at[1] - route[1][1]);
        path.push(route[1]);
        along.push(a.along + ((b.along - a.along) * l1) / (l1 + l2 || 1));
      }
      path.push(b.at);
      along.push(b.along);
    }
    measured.set(track.id, { path, along });
    out.push({ id: track.id, line: track.line, path });
  }

  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const nodeOfMark = (trackId: string, along: number) =>
    marks.get(trackId)?.find((m) => Math.abs(m.along - along) < 1e-6)?.node ?? null;
  const nodeOfStop = (stop: RailNetwork["stops"][number]) => {
    const track = trackById.get(stop.track);
    return track ? nodeOfMark(track.id, stopAlong(track, stop.along)) : null;
  };
  // A track end is a terminus unless a junction or another track meets it there.
  const tracksAt = new Map<number, Set<string>>();
  for (const [trackId, list] of marks) {
    for (const mark of list) tracksAt.set(mark.node!, (tracksAt.get(mark.node!) ?? new Set()).add(trackId));
  }
  const junctionNodes = new Set<number>();
  for (const junction of network.junctions) {
    const found = nodes.findIndex((n) => Math.hypot(n.at[0] - junction.at[0], n.at[1] - junction.at[1]) <= SAME_PLACE);
    if (found >= 0) junctionNodes.add(found);
  }
  const isEnd = (node: number | null, track: (typeof tracks)[number]) =>
    node !== null && !track.loop && !junctionNodes.has(node) && tracksAt.get(node)!.size === 1;
  const stopNodes = new Set(network.stops.map(nodeOfStop));

  // Track ends, with or without a stop.
  const ends: SchematicEnd[] = [];
  const terminusNodes = new Set<number>();
  for (const track of tracks) {
    const m = measured.get(track.id)!;
    for (const along of [0, track.length]) {
      const node = nodeOfMark(track.id, along);
      if (!isEnd(node, track)) continue;
      terminusNodes.add(node!);
      if (stopNodes.has(node)) continue;
      const dir = directionAt(m, along);
      ends.push({ at: pointOn(m, along), along: dir, line: track.line });
    }
  }

  const segments = out.flatMap((t) => t.path.slice(1).map((p, i) => [t.path[i], p] as [Pt, Pt]));
  const stops: SchematicStop[] = [];
  const nameBoxes: Pt[] = [];
  network.stops.forEach((stop, index) => {
    const m = measured.get(stop.track);
    if (!m) return;
    const along = stopAlong(trackById.get(stop.track)!, stop.along);
    const node = nodeOfStop(stop);
    const at = node !== null ? snapped[node] : pointOn(m, along);
    const dir = directionAt(m, along);
    const terminus = node !== null && terminusNodes.has(node);
    // The name goes on whichever side has the fewest lines and names near it.
    const normal: Pt = [-dir[1], dir[0]];
    const sides: Pt[] = terminus
      ? [along <= 1e-6 ? [-dir[0], -dir[1]] : dir, normal, [-normal[0], -normal[1]]]
      : [normal, [-normal[0], -normal[1]]];
    const crowd = (side: Pt) => {
      const probe: Pt = [at[0] + side[0] * GRID * 1.4, at[1] + side[1] * GRID * 1.4];
      const lines = segments.filter(([a, b]) => segmentDistance(probe, a, b) < GRID * 0.9).length;
      const names = nameBoxes.filter((p) => Math.hypot(p[0] - probe[0], p[1] - probe[1]) < GRID * 2).length;
      // Prefer names above or to the right, as the printed map mostly does.
      return lines * 4 + names * 3 - side[0] * 0.3 - -side[1] * 0.2;
    };
    const side = sides.reduce((best, s) => (crowd(s) < crowd(best) - 1e-6 ? s : best));
    nameBoxes.push([at[0] + side[0] * GRID * 1.4, at[1] + side[1] * GRID * 1.4]);
    stops.push({ index, at, side, along: dir, terminus });
  });

  const stretches: SchematicStretch[] = [];
  for (const track of tracks) {
    const m = measured.get(track.id)!;
    for (const [kind, list] of [
      ["damaged", track.damaged],
      ["broken", track.broken],
    ] as const) {
      for (const s of list) stretches.push({ kind, line: track.line, path: piece(m, s.from, s.to) });
    }
  }

  return {
    width: width + MARGIN * 2,
    height: height + MARGIN * 2,
    tracks: out,
    stops,
    ends,
    stretches,
    project: toDiagram,
  };
}

/** A box in the world as a box on the diagram (each axis is stretched on its own, so boxes stay boxes). */
export function projectBounds(schematic: Schematic, bounds: Bounds, min = GRID * 14): Bounds {
  const [x0, y0] = schematic.project([bounds.x, bounds.y]);
  const [x1, y1] = schematic.project([bounds.x + bounds.w, bounds.y + bounds.h]);
  const w = Math.max(min, x1 - x0);
  const h = Math.max(min, y1 - y0);
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}

/** An SVG path through `points` with rounded corners of radius `r`. */
export function roundedPath(points: Pt[], r: number): string {
  const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  if (!pts.length) return "";
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const v1 = unit([a[0] - b[0], a[1] - b[1]]);
    const v2 = unit([c[0] - b[0], c[1] - b[1]]);
    if (Math.abs(v1[0] * v2[1] - v1[1] * v2[0]) < 1e-6) {
      d += `L${b[0]} ${b[1]}`;
      continue;
    }
    const rr = Math.min(r, Math.hypot(a[0] - b[0], a[1] - b[1]) / 2, Math.hypot(c[0] - b[0], c[1] - b[1]) / 2);
    d += `L${b[0] + v1[0] * rr} ${b[1] + v1[1] * rr}Q${b[0]} ${b[1]} ${b[0] + v2[0] * rr} ${b[1] + v2[1] * rr}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${last[0]} ${last[1]}`;
}
