/**
 * Names for markers on a busy map. Each label sits beside its marker when
 * there is room; otherwise it moves out to free space with a leader line
 * back to the marker, as on a crowded street map; failing that it is left
 * out (the marker still shows). Everything is in screen pixels.
 */

export type LabelPoint = { key: string; x: number; y: number; width: number; height: number };

export type PlacedLabel = {
  key: string;
  /** The label's box: left, top, width, height. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** From the marker's edge to the label, when the label is not beside it. */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
};

export type LayoutOptions = {
  /** Marker radius: labels and leaders keep clear of every marker. */
  markerRadius: number;
  /** Gap between a marker and a label beside it. */
  gap: number;
  /** Space kept around each label. */
  pad: number;
  /** Leader lengths tried, shortest first. */
  radii: readonly number[];
  /** Markers closer than this to one another (about touching) count as crowded together. */
  crowdRadius: number;
};

export const DEFAULT_LAYOUT: LayoutOptions = {
  markerRadius: 8,
  gap: 4,
  pad: 2,
  radii: [24, 40, 60, 84],
  crowdRadius: 20,
};

type Box = { x: number; y: number; width: number; height: number };
type Segment = { x1: number; y1: number; x2: number; y2: number };

// Directions for leaders, best first: up and down diagonals read as callouts, then sideways, then straight.
const ANGLES = [-35, -145, 35, 145, -60, -120, 60, 120, 0, 180, -90, 90].map((deg) => (deg * Math.PI) / 180);

function overlaps(a: Box, b: Box, pad: number): boolean {
  return (
    a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad
  );
}

function boxHitsCircle(box: Box, cx: number, cy: number, r: number): boolean {
  const nx = Math.max(box.x, Math.min(cx, box.x + box.width));
  const ny = Math.max(box.y, Math.min(cy, box.y + box.height));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentsCross(p: Segment, q: Segment): boolean {
  const d1 = cross(q.x1, q.y1, q.x2, q.y2, p.x1, p.y1);
  const d2 = cross(q.x1, q.y1, q.x2, q.y2, p.x2, p.y2);
  const d3 = cross(p.x1, p.y1, p.x2, p.y2, q.x1, q.y1);
  const d4 = cross(p.x1, p.y1, p.x2, p.y2, q.x2, q.y2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function segmentHitsBox(s: Segment, box: Box): boolean {
  const inside = (x: number, y: number) => x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height;
  if (inside(s.x1, s.y1) || inside(s.x2, s.y2)) return true;
  const { x, y, width: w, height: h } = box;
  return [
    { x1: x, y1: y, x2: x + w, y2: y },
    { x1: x + w, y1: y, x2: x + w, y2: y + h },
    { x1: x, y1: y + h, x2: x + w, y2: y + h },
    { x1: x, y1: y, x2: x, y2: y + h },
  ].some((edge) => segmentsCross(s, edge));
}

function segmentHitsCircle(s: Segment, cx: number, cy: number, r: number): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const length = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((cx - s.x1) * dx + (cy - s.y1) * dy) / length));
  return (s.x1 + t * dx - cx) ** 2 + (s.y1 + t * dy - cy) ** 2 < r * r;
}

/** The label's box when its leader ends at (ex, ey), heading at `angle` away from the marker. */
function boxAtLeaderEnd(point: LabelPoint, ex: number, ey: number, angle: number): Box {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = Math.abs(cos) < 0.2 ? ex - point.width / 2 : cos > 0 ? ex : ex - point.width;
  const y = sin < -0.5 ? ey - point.height : sin > 0.5 ? ey : ey - point.height / 2;
  return { x, y, width: point.width, height: point.height };
}

const HALF_TURN = Math.PI / 2 + 1e-9;

/** How far apart two directions are, in radians (0 to π). */
function turn(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/**
 * Places the labels of markers with the fewest neighbours first, so a lone
 * marker beside a crowd keeps its name beside it and the crowd's names fan
 * out around it. Ties keep the order given: pass a stable one, so labels do
 * not jump about between refreshes.
 *
 * A marker touching others puts its name on its own side of the group: the
 * directions nearest "away from the markers it touches" are tried first, so
 * names do not swap sides and leaders do not cross. Leaders are kept off
 * every other marker where a leader of that length allows it; otherwise it
 * may pass under a marker lying on top of its own.
 */
export function layoutLabels(points: readonly LabelPoint[], options: LayoutOptions = DEFAULT_LAYOUT): PlacedLabel[] {
  const { markerRadius, gap, pad, radii } = options;
  const boxes: Box[] = [];
  const leaders: Segment[] = [];
  const out: PlacedLabel[] = [];
  const clearOfMarkers = (box: Box, own: LabelPoint) =>
    points.every((p) => p === own || !boxHitsCircle(box, p.x, p.y, markerRadius + pad)) &&
    !boxHitsCircle(box, own.x, own.y, markerRadius);
  const free = (box: Box) => boxes.every((placed) => !overlaps(box, placed, pad));

  const near = options.crowdRadius;
  const touching = new Map(
    points.map((p) => [p, points.filter((q) => q !== p && Math.hypot(q.x - p.x, q.y - p.y) < near)])
  );
  const order = [...points].sort((a, b) => touching.get(a)!.length - touching.get(b)!.length);

  for (const point of order) {
    // Away from the middle of the markers it touches; null when alone, or right on top of them.
    const others = touching.get(point)!;
    let away: number | null = null;
    if (others.length) {
      const dx = point.x - others.reduce((sum, q) => sum + q.x, 0) / others.length;
      const dy = point.y - others.reduce((sum, q) => sum + q.y, 0) / others.length;
      if (Math.hypot(dx, dy) >= 1) away = Math.atan2(dy, dx);
    }
    const outward = (angles: readonly number[]) =>
      away === null ? angles : [...angles].sort((a, b) => turn(a, away!) - turn(b, away!));
    // A marker in a group looks on its own side first, at every length, and only then on the far side.
    const sides =
      away === null
        ? [() => true]
        : [(a: number) => turn(a, away!) <= HALF_TURN, (a: number) => turn(a, away!) > HALF_TURN];

    const top = point.y - point.height / 2;
    // Set by the tries below; `as` keeps TypeScript from narrowing it to null for good.
    let placed = null as PlacedLabel | null;
    const tryBeside = (side: number) => {
      const box =
        side === 0
          ? { x: point.x + markerRadius + gap, y: top, width: point.width, height: point.height }
          : { x: point.x - markerRadius - gap - point.width, y: top, width: point.width, height: point.height };
      if (free(box) && clearOfMarkers(box, point) && leaders.every((l) => !segmentHitsBox(l, box))) {
        placed = { key: point.key, ...box, leader: null };
      }
    };
    const tryLeader = (angle: number, length: number, strict: boolean) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const leader = {
        x1: point.x + cos * markerRadius,
        y1: point.y + sin * markerRadius,
        x2: point.x + cos * length,
        y2: point.y + sin * length,
      };
      const box = boxAtLeaderEnd(point, leader.x2, leader.y2, angle);
      if (
        free(box) &&
        clearOfMarkers(box, point) &&
        boxes.every((b) => !segmentHitsBox(leader, b)) &&
        leaders.every((l) => !segmentsCross(l, leader) && !segmentHitsBox(l, box)) &&
        points.every(
          (p) =>
            p === point ||
            (!strict && Math.hypot(p.x - point.x, p.y - point.y) < 2 * markerRadius) ||
            !segmentHitsCircle(leader, p.x, p.y, markerRadius)
        )
      ) {
        placed = { key: point.key, ...box, leader };
      }
    };
    for (const onSide of sides) {
      for (const side of outward([0, Math.PI]).filter(onSide)) {
        if (!placed) tryBeside(side);
      }
      const angles = outward(ANGLES).filter(onSide);
      // Shortest leaders first. At each length, first keeping the leader off every other marker, then
      // letting it pass under a marker lying on top of this one (leaders are drawn beneath markers).
      for (const length of radii) {
        for (const strict of [true, false]) {
          for (const angle of angles) {
            if (!placed) tryLeader(angle, length, strict);
          }
        }
      }
    }
    if (placed) {
      boxes.push(placed);
      if (placed.leader) leaders.push(placed.leader);
      out.push(placed);
    }
  }
  return out;
}
