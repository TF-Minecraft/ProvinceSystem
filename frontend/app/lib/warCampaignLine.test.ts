import { describe, expect, it } from "vitest";

import type { WarExport } from "../components/map/types";
import {
  buildSvgPathD,
  buildWarCampaignPathD,
  buildWarCampaignPathPair,
  campaignFrontAxisIndex,
  catmullRomSpline,
  resolveWarWaypoints,
  warLineStrokeStyle,
} from "./warCampaignLine";

const sampleWar = (overrides: Partial<WarExport> = {}): WarExport => ({
  id: "war-1",
  campaign_line_points: [
    { province_id: 10, map_x: 100, map_y: 100 },
    { province_id: 20, map_x: 200, map_y: 150 },
    { province_id: 30, map_x: 300, map_y: 120 },
    { province_id: 40, map_x: 400, map_y: 200 },
  ],
  ...overrides,
});

describe("resolveWarWaypoints", () => {
  it("resolves waypoints from campaign_line_points", () => {
    const waypoints = resolveWarWaypoints(sampleWar());
    expect(waypoints).toEqual([
      { x: 100, y: 100, provinceId: 10 },
      { x: 200, y: 150, provinceId: 20 },
      { x: 300, y: 120, provinceId: 30 },
      { x: 400, y: 200, provinceId: 40 },
    ]);
  });

  it("falls back to centroids when line points are missing", () => {
    const waypoints = resolveWarWaypoints(
      sampleWar({
        campaign_line_points: undefined,
        campaign_provinces: [10, 20, 30],
      }),
      {
        "10": { x: 50, y: 60, pixel_count: 100 },
        "20": { x: 150, y: 160, pixel_count: 100 },
        "30": { x: 250, y: 260, pixel_count: 100 },
      },
    );
    expect(waypoints).toEqual([
      { x: 50, y: 60, provinceId: 10 },
      { x: 150, y: 160, provinceId: 20 },
      { x: 250, y: 260, provinceId: 30 },
    ]);
  });

  it("prepends attacker capital when not already first", () => {
    const waypoints = resolveWarWaypoints(
      sampleWar({
        campaign_line_points: [
          { province_id: 20, map_x: 200, map_y: 150 },
          { province_id: 30, map_x: 300, map_y: 120 },
        ],
        attacker_capital: {
          province_id: 10,
          map_x: 80,
          map_y: 90,
        },
      }),
    );
    expect(waypoints[0]).toEqual({ x: 80, y: 90, provinceId: 10 });
    expect(waypoints).toHaveLength(3);
  });

  it("returns empty when fewer than two points resolve", () => {
    expect(resolveWarWaypoints(sampleWar({ campaign_line_points: [] }))).toEqual([]);
    expect(
      resolveWarWaypoints(
        sampleWar({
          campaign_line_points: [{ province_id: 1, map_x: 10, map_y: 10 }],
        }),
      ),
    ).toEqual([]);
  });

  it("overlays siege slot coords onto the matching province waypoint", () => {
    const waypoints = resolveWarWaypoints(
      sampleWar({
        campaign_battle_schedule: [
          {
            schedule_index: 0,
            leg: "invasion",
            province_id: 20,
            kind: "siege",
            kind_label: "Siege",
            status: "next",
            map_x: 210,
            map_y: 160,
          },
        ],
      }),
    );
    expect(waypoints[1]).toEqual({ x: 210, y: 160, provinceId: 20 });
  });

  it("overlays field battle coords onto the matching province waypoint", () => {
    const waypoints = resolveWarWaypoints(
      sampleWar({
        campaign_battle_schedule: [
          {
            schedule_index: 0,
            leg: "invasion",
            province_id: 30,
            kind: "field",
            kind_label: "Field Battle",
            status: "upcoming",
            map_x: 250,
            map_y: 180,
          },
        ],
      }),
    );
    expect(waypoints[2]).toEqual({ x: 250, y: 180, provinceId: 30 });
  });

  it("inserts a siege fort that is not on the campaign province axis", () => {
    const waypoints = resolveWarWaypoints(
      sampleWar({
        campaign_battle_schedule: [
          {
            schedule_index: 0,
            leg: "invasion",
            province_id: 99,
            kind: "siege",
            kind_label: "Siege",
            status: "upcoming",
            map_x: 250,
            map_y: 135,
            fort_installation_id: "Greenfort",
          },
        ],
      }),
    );
    expect(waypoints).toHaveLength(5);
    expect(waypoints[2]).toEqual({ x: 250, y: 135, provinceId: 99 });
    const spline = catmullRomSpline(waypoints);
    const nearest = spline.reduce((best, point) => {
      const dist = Math.hypot(point.x - 250, point.y - 135);
      const bestDist = Math.hypot(best.x - 250, best.y - 135);
      return dist < bestDist ? point : best;
    });
    expect(Math.hypot(nearest.x - 250, nearest.y - 135)).toBeLessThan(1);
  });
});

describe("catmullRomSpline", () => {
  const waypoints = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("resamples more densely than input waypoints", () => {
    const spline = catmullRomSpline(waypoints);
    expect(spline.length).toBeGreaterThan(waypoints.length);
  });

  it("keeps endpoints near original waypoints", () => {
    const spline = catmullRomSpline(waypoints);
    const first = spline[0];
    const last = spline[spline.length - 1];
    expect(Math.hypot(first.x - waypoints[0].x, first.y - waypoints[0].y)).toBeLessThan(1);
    expect(
      Math.hypot(last.x - waypoints[waypoints.length - 1].x, last.y - waypoints[waypoints.length - 1].y),
    ).toBeLessThan(1);
  });

  it("returns two points unchanged for a straight segment", () => {
    const segment = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    expect(catmullRomSpline(segment)).toEqual(segment);
  });

  it("passes through every waypoint far from the origin", () => {
    const farWaypoints = [
      { x: 1000, y: 1000 },
      { x: 2000, y: 1200 },
      { x: 3000, y: 1800 },
      { x: 4000, y: 2000 },
    ];
    const spline = catmullRomSpline(farWaypoints);
    expect(spline.length).toBeGreaterThan(farWaypoints.length);

    for (const waypoint of farWaypoints) {
      const nearest = spline.reduce((best, point) => {
        const dist = Math.hypot(point.x - waypoint.x, point.y - waypoint.y);
        const bestDist = Math.hypot(best.x - waypoint.x, best.y - waypoint.y);
        return dist < bestDist ? point : best;
      });
      expect(Math.hypot(nearest.x - waypoint.x, nearest.y - waypoint.y)).toBeLessThan(1);
    }
  });

  it("does not scale interior samples toward the origin", () => {
    const farWaypoints = [
      { x: 1000, y: 1000 },
      { x: 2000, y: 1200 },
      { x: 3000, y: 1800 },
      { x: 4000, y: 2000 },
    ];
    const spline = catmullRomSpline(farWaypoints);
    const interior = spline.slice(1, -1);
    expect(interior.length).toBeGreaterThan(0);
    for (const point of interior) {
      expect(point.x).toBeGreaterThan(900);
      expect(point.y).toBeGreaterThan(900);
    }
  });
});

describe("buildSvgPathD", () => {
  it("builds move/line path commands", () => {
    expect(
      buildSvgPathD([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]),
    ).toBe("M 1 2 L 3 4");
  });
});

describe("buildWarCampaignPathD", () => {
  it("returns empty path when war has insufficient waypoints", () => {
    expect(buildWarCampaignPathD(sampleWar({ campaign_line_points: [] }))).toBe("");
  });

  it("returns non-empty path for valid war", () => {
    const path = buildWarCampaignPathD(sampleWar());
    expect(path.startsWith("M ")).toBe(true);
    expect(path.includes("L ")).toBe(true);
  });
});

describe("warLineStrokeStyle", () => {
  it("uses white dashes for progressed and gray for remaining", () => {
    const progressed = warLineStrokeStyle("progressed");
    const remaining = warLineStrokeStyle("remaining");
    expect(progressed.dashColor).toBe("#ffffff");
    expect(remaining.dashColor).toBe("#5a5a5a");
    expect(progressed.dashWidth).toBe(8);
    expect(progressed.dashArray).toBe("12 16");
    expect(progressed.opacity).toBe(1);
  });
});

describe("campaignFrontAxisIndex", () => {
  it("uses cursor_index and extends with attacker occupation", () => {
    const war = sampleWar({
      campaign_provinces: [10, 20, 30, 40],
      cursor_index: 1,
      occupied_by_attacker: [30],
    });
    expect(campaignFrontAxisIndex(war)).toBe(2);
  });
});

describe("buildWarCampaignPathPair", () => {
  it("returns empty paths when war has insufficient waypoints", () => {
    expect(buildWarCampaignPathPair(sampleWar({ campaign_line_points: [] }))).toEqual({
      progressedD: "",
      remainingD: "",
    });
  });

  it("splits progressed white from remaining gray at the front", () => {
    const pair = buildWarCampaignPathPair(
      sampleWar({
        campaign_provinces: [10, 20, 30, 40],
        cursor_index: 1,
      }),
    );
    expect(pair.progressedD.startsWith("M ")).toBe(true);
    expect(pair.remainingD.startsWith("M ")).toBe(true);
    expect(pair.progressedD).not.toBe(pair.remainingD);
    expect(pair.progressedD.includes("400 200")).toBe(false);
    expect(pair.remainingD.includes("100 100")).toBe(false);
  });

  it("caps progressed white at the next battle when occupation is further", () => {
    const pair = buildWarCampaignPathPair(
      sampleWar({
        campaign_provinces: [10, 20, 30, 40],
        cursor_index: 1,
        occupied_by_attacker: [40],
        campaign_battle_schedule: [
          {
            schedule_index: 0,
            leg: "invasion",
            province_id: 20,
            kind: "field",
            kind_label: "Field Battle",
            status: "next",
            map_x: 200,
            map_y: 150,
          },
        ],
      }),
    );
    expect(pair.progressedD.includes("400 200")).toBe(false);
    expect(pair.progressedD.includes("300 120")).toBe(false);
    expect(pair.remainingD.includes("200 150")).toBe(true);
    expect(pair.progressedD.includes("200 150")).toBe(true);
  });
});
