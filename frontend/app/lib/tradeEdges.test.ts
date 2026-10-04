import { describe, expect, it } from "vitest";

import type { TradeEdge, TradeNetwork } from "../components/map/types";
import {
  buildTradeEdgeGeometry,
  pickTradeEdgeAt,
} from "./tradeEdges";

const networks: TradeNetwork[] = [
  {
    name: "The Vardera Network",
    global: true,
    nodes: [{ installation_id: "a", owner: "Faction", province_id: 1 }],
  },
  {
    name: "Local",
    global: false,
    nodes: [{ installation_id: "b", owner: "Other", province_id: 2 }],
  },
];

const sea: TradeEdge = {
  mode: "sea",
  network: "The Vardera Network",
  provinces: [12, 13],
  path: [[15, 25], [Number.NaN, 1], [18, 28]],
  from: { installation_id: "a", owner: "Faction", map_x: 10, map_y: 20 },
  to: { installation_id: "b", owner: "Other", map_x: 30, map_y: 40 },
};

const air: TradeEdge = {
  mode: "air",
  network: "Local",
  path: [[1000, 1000]],
  from: { installation_id: "a", owner: "Faction", map_x: 10, map_y: 20 },
  to: { installation_id: "c", owner: "Other", map_x: 10, map_y: 80 },
};

describe("tradeEdges", () => {
  it("builds sea and rail polylines and a straight air line", () => {
    const rail: TradeEdge = {
      ...sea,
      mode: "rail",
      network: "Local",
      path: [[12, 22]],
    };
    const geometry = buildTradeEdgeGeometry(
      [sea, rail, { ...air, from: { ...air.from, map_x: undefined } }],
      networks
    );
    expect(geometry.strokes.map((stroke) => stroke.mode)).toEqual(["rail", "sea"]);
    const [railStroke, seaStroke] = geometry.strokes;
    expect(railStroke.points).toEqual([
      [10, 20],
      [12, 22],
      [30, 40],
    ]);
    expect(railStroke.dash).toBeUndefined();
    expect(railStroke.label).toBe("Local · Rail");
    expect(seaStroke.points).toEqual([
      [10, 20],
      [15, 25],
      [18, 28],
      [30, 40],
    ]);
    expect(seaStroke.d).toBe("M 10 20 L 15 25 L 18 28 L 30 40");
    expect(seaStroke.dash).toBe("20 13");
    expect(seaStroke.label).toBe("The Vardera Network · Sea");
    expect(seaStroke.color).not.toBe(railStroke.color);
    expect(seaStroke.color).not.toBe("#b6e3f5");
    expect(seaStroke.width).toBeGreaterThan(railStroke.width);
    expect(seaStroke.opacity).toBeGreaterThan(railStroke.opacity);
    expect(seaStroke.width).toBeLessThan(9);
    expect(seaStroke.opacity).toBeLessThan(0.92);

    const airGeometry = buildTradeEdgeGeometry([air], networks);
    expect(airGeometry.strokes[0].points).toEqual([
      [10, 20],
      [10, 80],
    ]);
    expect(airGeometry.strokes[0].dash).toBe("2 14");
    expect(airGeometry.strokes[0].label).toBe("Local · Air");
    expect(airGeometry.strokes[0].color).not.toBe(seaStroke.color);
    expect(airGeometry.strokes[0].color).not.toBe(railStroke.color);
  });

  it("picks the nearest edge, and a global edge wins an exact tie", () => {
    const geometry = buildTradeEdgeGeometry([sea, air], networks);
    expect(pickTradeEdgeAt(geometry, 15, 25, 1)?.label).toBe(
      "The Vardera Network · Sea"
    );
    expect(pickTradeEdgeAt(geometry, 10, 50, 1)?.label).toBe("Local · Air");
    expect(pickTradeEdgeAt(geometry, 10, 20, 1)?.label).toBe(
      "The Vardera Network · Sea"
    );
    expect(pickTradeEdgeAt(geometry, 1000, 1000, 1)).toBeNull();
    expect(pickTradeEdgeAt(geometry, 19, 50, 1)).toBeNull();
    expect(pickTradeEdgeAt(geometry, 10, 50, 0)).toBeNull();
  });
});
