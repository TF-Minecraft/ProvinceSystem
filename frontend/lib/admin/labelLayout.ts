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

export const DEFAULT_LAYOUT: LayoutOptions = { markerRadius: 8, gap: 4, pad: 2, radii: [26, 42, 62, 86, 114], crowdRadius: 20 };

type Box = { x: number; y: number; width: number; height: number };
type Segment = { x1: number; y1: number; x2: number; y2: number };

// Directions for leaders, best first: up and down diagonals read as callouts, then sideways, then straight.
const ANGLES = [-35, -145, 35, 145, -60, -120, 60, 120, 0, 180, -90, 90].map((deg) => (deg * Math.PI) / 180);

function overlaps(a: Box, b: Box, pad: number): boolean {
  return a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;
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

/**
 * Places the labels of markers with the fewest neighbours first, so a lone
 * marker beside a crowd keeps its name beside it and the crowd's names fan
 * out around it. Ties keep the order given: pass a stable one, so labels do
 * not jump about between refreshes.
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
  const crowding = new Map(
    points.map((p) => [p, points.filter((q) => q !== p && Math.hypot(q.x - p.x, q.y - p.y) < near).length])
  );
  const order = [...points].sort((a, b) => crowding.get(a)! - crowding.get(b)!);

  for (const point of order) {
    const beside: Box[] = [
      { x: point.x + markerRadius + gap, y: point.y - point.height / 2, width: point.width, height: point.height },
      { x: point.x - markerRadius - gap - point.width, y: point.y - point.height / 2, width: point.width, height: point.height },
    ];
    let placed: PlacedLabel | null = null;
    for (const box of beside) {
      if (free(box) && clearOfMarkers(box, point) && leaders.every((l) => !segmentHitsBox(l, box))) {
        placed = { key: point.key, ...box, leader: null };
        break;
      }
    }
    for (let r = 0; !placed && r < radii.length; r += 1) {
      for (const angle of ANGLES) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const leader = {
          x1: point.x + cos * markerRadius,
          y1: point.y + sin * markerRadius,
          x2: point.x + cos * radii[r],
          y2: point.y + sin * radii[r],
        };
        const box = boxAtLeaderEnd(point, leader.x2, leader.y2, angle);
        if (
          free(box) &&
          clearOfMarkers(box, point) &&
          boxes.every((b) => !segmentHitsBox(leader, b)) &&
          leaders.every((l) => !segmentsCross(l, leader) && !segmentHitsBox(l, box)) &&
          // Markers on top of this one are crossed whichever way the leader goes.
          points.every(
            (p) =>
              Math.hypot(p.x - point.x, p.y - point.y) < 2 * markerRadius ||
              !segmentHitsCircle(leader, p.x, p.y, markerRadius)
          )
        ) {
          placed = { key: point.key, ...box, leader };
          break;
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
