import { describe, expect, it } from "vitest";

import { DEFAULT_LAYOUT, layoutLabels, type LabelPoint, type PlacedLabel } from "./labelLayout";

const point = (key: string, x: number, y: number, width = 60): LabelPoint => ({ key, x, y, width, height: 16 });

function overlap(a: PlacedLabel, b: PlacedLabel): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("layoutLabels", () => {
  it("puts a lone label beside its marker, with no leader", () => {
    const [placed] = layoutLabels([point("a", 100, 100)]);
    expect(placed).toMatchObject({ key: "a", x: 112, y: 92, leader: null });
  });

  it("uses the left side when the right is taken", () => {
    const [, b] = layoutLabels([point("a", 100, 100), point("b", 100, 90)]);
    expect(b.leader).toBeNull();
    expect(b.x + b.width).toBe(88);
  });

  it("moves crowded labels out on leaders, never overlapping, and never over a marker", () => {
    // A town: twelve players within a few pixels of each other, two on the very same spot.
    const points = Array.from({ length: 12 }, (_, i) => point(`p${i}`, 200 + (i % 4) * 6, 200 + Math.floor(i / 4) * 6));
    points.push(point("twin", 200, 200));
    const placed = layoutLabels(points);
    expect(placed.length).toBeGreaterThan(8);
    expect(placed.filter((p) => p.leader).length).toBeGreaterThan(4);
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) expect(overlap(a, b)).toBe(false);
      for (const m of points) {
        const nx = Math.max(a.x, Math.min(m.x, a.x + a.width));
        const ny = Math.max(a.y, Math.min(m.y, a.y + a.height));
        expect(Math.hypot(m.x - nx, m.y - ny)).toBeGreaterThanOrEqual(8);
      }
    }
    // Each leader starts at its own marker's edge and ends on its label's box.
    for (const label of placed.filter((p) => p.leader)) {
      const own = points.find((p) => p.key === label.key)!;
      expect(Math.hypot(label.leader!.x1 - own.x, label.leader!.y1 - own.y)).toBeCloseTo(8);
      const { x2, y2 } = label.leader!;
      expect(x2 >= label.x - 0.01 && x2 <= label.x + label.width + 0.01).toBe(true);
      expect(y2 >= label.y - 0.01 && y2 <= label.y + label.height + 0.01).toBe(true);
    }
  });

  it("leaves a label out when there is nowhere for it", () => {
    const points = Array.from({ length: 200 }, (_, i) => point(`p${i}`, 300 + (i % 10), 300 + Math.floor(i / 10), 120));
    const placed = layoutLabels(points);
    expect(placed.length).toBeLessThan(points.length);
    expect(new Set(placed.map((p) => p.key)).size).toBe(placed.length);
  });

  it("keeps a lone marker's name beside it, next to a crowd", () => {
    const crowd = Array.from({ length: 9 }, (_, i) => point(`c${i}`, 200 + (i % 3) * 5, 200 + Math.floor(i / 3) * 5));
    const lone = point("lone", 250, 205);
    const placed = layoutLabels([...crowd, lone]);
    expect(placed.find((p) => p.key === "lone")).toMatchObject({ leader: null });
  });

  it("puts each name in a touching group on its own side, with no leader over another marker", () => {
    // Three players overlapping, as seen on Main: yellow upper left, cyan below, blue to the right.
    const width = (name: string) => name.length * 13 * 0.62;
    const yellow = point("EstienneHavenga", 126, 95, width("EstienneHavenga"));
    const cyan = point("keterkcy", 133.3, 100.7, width("keterkcy"));
    const blue = point("Mabwy", 144, 94, width("Mabwy"));
    const markers = [yellow, cyan, blue];
    const placed = new Map(layoutLabels(markers).map((p) => [p.key, p]));
    expect(placed.size).toBe(3);
    const middle = (p: PlacedLabel) => ({ x: p.x + p.width / 2, y: p.y + p.height / 2 });
    expect(middle(placed.get("Mabwy")!).x).toBeGreaterThan(blue.x);
    expect(middle(placed.get("EstienneHavenga")!).x).toBeLessThan(yellow.x);
    expect(middle(placed.get("keterkcy")!).y).toBeGreaterThan(cyan.y);
    for (const label of placed.values()) {
      if (!label.leader) continue;
      const { x1, y1, x2, y2 } = label.leader;
      for (const m of markers.filter((m) => m.key !== label.key)) {
        const along = ((m.x - x1) * (x2 - x1) + (m.y - y1) * (y2 - y1)) / ((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const t = Math.max(0, Math.min(1, along));
        expect(Math.hypot(x1 + t * (x2 - x1) - m.x, y1 + t * (y2 - y1) - m.y)).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("keeps names inside the map at its edges", () => {
    const area = { width: 400, height: 300 };
    const options = { ...DEFAULT_LAYOUT, area };
    // As seen on Main: a name beside a marker by the east edge ran off the map.
    const [east] = layoutLabels([point("east", 390, 150)], options);
    expect(east).toMatchObject({ leader: null });
    expect(east.x + east.width).toBe(378);
    // Two markers by the west edge: the right side holds one name, the other goes out on a leader.
    const placed = layoutLabels([point("a", 10, 20), point("b", 10, 36)], options);
    expect(placed).toHaveLength(2);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(area.width);
      expect(p.y + p.height).toBeLessThanOrEqual(area.height);
    }
    // A marker at the very top: its name moves down.
    const [top] = layoutLabels([point("top", 200, 3)], options);
    expect(top.y).toBeGreaterThanOrEqual(0);
  });

  it("gives earlier labels the better spots, so the same order lays out the same", () => {
    const points = [point("a", 100, 100), point("b", 104, 100), point("c", 108, 100)];
    expect(layoutLabels(points)).toEqual(layoutLabels(points));
    expect(layoutLabels(points)[0].leader).toBeNull();
  });
});
