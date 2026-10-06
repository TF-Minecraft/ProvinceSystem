import { describe, expect, it } from "vitest";

// Clock-change cases below are written for London.
process.env.TZ = "Europe/London";

import {
  ACTION_LOGIN,
  ACTION_LOGOUT,
  ACTION_PING,
  boundsOf,
  clampMoment,
  clipStretches,
  describeSpan,
  inspect,
  observationTimes,
  observedBands,
  parseLocalInput,
  sessionEndLabel,
  sessionSpanLabel,
  stepObservation,
  timelineTicks,
  zoneLabel,
  fromLocalInput,
  positionAt,
  stretches,
  timeByWorld,
  toLocalInput,
  worldLabel,
  type MovementPoint,
} from "./movement";

const WORLDS = ["TFMC_Map", "TFMC_Map_the_end"];

function p(time: number, x: number, z: number, action = ACTION_PING, world = 0): MovementPoint {
  return [time, world, x, 64, z, action];
}

describe("stretches", () => {
  it("breaks at logins, after logouts, on a world change and across long gaps", () => {
    const points = [
      p(0, 0, 0, ACTION_LOGIN),
      p(60, 10, 0),
      p(120, 20, 0, ACTION_LOGOUT),
      p(500, 0, 0, ACTION_LOGIN),
      p(560, 5, 5),
      p(620, 5, 5, ACTION_PING, 1),
      p(680, 6, 6, ACTION_PING, 1),
      // Not seen for five minutes: a crash or missed pings.
      p(980, 7, 7, ACTION_PING, 1),
    ];
    const out = stretches(points, WORLDS, 60);
    expect(out.map((s) => [s.world, s.samples.map((x) => x.time)])).toEqual([
      ["TFMC_Map", [0, 60, 120]],
      ["TFMC_Map", [500, 560]],
      ["TFMC_Map_the_end", [620, 680]],
      ["TFMC_Map_the_end", [980]],
    ]);
    expect(timeByWorld(out).get("TFMC_Map")).toBe(180);
    expect(timeByWorld(out).get("TFMC_Map_the_end")).toBe(60);
  });
});

describe("positionAt", () => {
  const out = stretches([p(0, 0, 0, ACTION_LOGIN), p(60, 60, 0), p(120, 60, 60), p(180, 5000, 60)], WORLDS, 60);

  it("is exact on a row and interpolated between rows", () => {
    expect(positionAt(out, 60)).toEqual({ world: "TFMC_Map", x: 60, z: 0, exact: true });
    expect(positionAt(out, 90)).toEqual({ world: "TFMC_Map", x: 60, z: 30, exact: false });
  });

  it("does not slide along a teleport", () => {
    expect(positionAt(out, 150)).toEqual({ world: "TFMC_Map", x: 60, z: 60, exact: false });
  });

  it("is null outside every stretch", () => {
    expect(positionAt(out, -1)).toBeNull();
    expect(positionAt(out, 181)).toBeNull();
  });

  it("holds the last sighting while the next ping may still come", () => {
    expect(positionAt(out, 250, 150)).toEqual({ world: "TFMC_Map", x: 5000, z: 60, exact: false, lastSeen: 180 });
    expect(positionAt(out, 331, 150)).toBeNull();
    const loggedOut = stretches([p(0, 1, 1, ACTION_LOGIN), p(60, 2, 2, ACTION_LOGOUT)], WORLDS, 60);
    expect(positionAt(loggedOut, 90, 150)).toBeNull();
  });

});

describe("inspect", () => {
  const out = stretches([p(0, 0, 0, ACTION_LOGIN), p(60, 60, 0), p(120, 60, 60), p(180, 5000, 60)], WORLDS, 60);

  it("says how it knows", () => {
    expect(inspect(out, 60).kind).toBe("observed");
    expect(inspect(out, 90)).toMatchObject({ kind: "estimated", x: 60, z: 30 });
    expect(inspect(out, 150)).toMatchObject({ kind: "unobserved", before: { time: 120 }, after: { time: 180 } });
    expect(inspect(out, 200, 150)).toMatchObject({ kind: "stale", before: { time: 180 } });
    expect(inspect(out, 400, 150)).toMatchObject({ kind: "none", before: { time: 180 } });
    expect(inspect(out, -5)).toEqual({ kind: "none", before: null });
  });

  it("steps between observations and finds the observed bands", () => {
    const times = observationTimes(out);
    expect(stepObservation(times, 90, -1)).toBe(60);
    expect(stepObservation(times, 90, 1)).toBe(120);
    expect(stepObservation(times, 0, -1)).toBeNull();
    expect(stepObservation(times, 180, 1)).toBeNull();
    expect(observedBands(out)).toEqual([[0, 180]]);
    // A point made up at a range's edge is not an observation.
    expect(observationTimes(clipStretches(out, 30, 200), 30, 200)).toEqual([60, 120, 180]);
  });
});

describe("clipStretches", () => {
  it("cuts the row before the window to the window's edge", () => {
    const all = stretches([p(900, 0, 0), p(1010, 110, 0), p(1070, 170, 0)], WORLDS, 60);
    const clipped = clipStretches(all, 1000, 1100);
    expect(clipped[0].samples.map((s) => [s.time, s.x])).toEqual([[1000, 100], [1010, 110], [1070, 170]]);
    expect(timeByWorld(clipped).get("TFMC_Map")).toBe(70);
    // The unclipped stretches still say where they were as the window opened.
    expect(positionAt(all, 1000)?.x).toBe(100);
  });

  it("drops stretches wholly outside the window", () => {
    expect(clipStretches(stretches([p(0, 0, 0), p(60, 1, 1)], WORLDS, 60), 100, 200)).toEqual([]);
  });

  it("keeps the slider inside the window", () => {
    expect(clampMoment(null, 10, 20)).toBeNull();
    expect(clampMoment(5, 10, 20)).toBe(10);
    expect(clampMoment(25, 10, 20)).toBe(20);
  });
});

describe("times", () => {
  it("refuses local times the clocks skip or repeat", () => {
    expect(parseLocalInput("2026-10-06T12:00").time).toBe(Date.UTC(2026, 9, 6, 11, 0) / 1000);
    expect(parseLocalInput("2026-03-29T01:30").error).toMatch(/clocks went forward/);
    expect(parseLocalInput("2026-10-25T01:30").error).toMatch(/clocks went back/);
    expect(parseLocalInput("").error).toMatch(/Enter/);
  });

  it("states the zone and the span", () => {
    const noon = Date.UTC(2026, 9, 6, 11, 0) / 1000;
    expect(zoneLabel(noon)).toBe("Europe/London (UTC+01:00)");
    expect(zoneLabel(noon, noon + 30 * 86400)).toBe("Europe/London (UTC+01:00 → UTC+00:00)");
    expect(describeSpan(noon, noon + 3600)).toBe("Tue 6 Oct 2026, 12:00 → 13:00");
    expect(describeSpan(noon, noon + 86400)).toBe("Tue 6 Oct 2026, 12:00 → Wed 7 Oct 2026, 12:00");
  });

  it("refuses a repeated half hour too", () => {
    process.env.TZ = "Australia/Lord_Howe";
    try {
      expect(parseLocalInput("2026-04-05T01:45").error).toMatch(/clocks went back/);
      expect(parseLocalInput("2026-04-05T03:00").time).toBeDefined();
    } finally {
      process.env.TZ = "Europe/London";
    }
  });

  it("keeps daily ticks on local midnight across a clock change", () => {
    const start = Date.UTC(2026, 9, 23, 12, 0) / 1000;
    const ticks = timelineTicks(start, start + 5 * 86400);
    expect(ticks.map((t) => new Date(t * 1000).getHours())).toEqual(ticks.map(() => 0));
    expect(ticks.map((t) => new Date(t * 1000).getDate())).toEqual([24, 25, 26, 27, 28]);
  });

  it("puts timeline ticks on round local times", () => {
    const noon = Date.UTC(2026, 9, 6, 11, 0) / 1000;
    expect(timelineTicks(noon + 60, noon + 3600 + 60).map((t) => new Date(t * 1000).getMinutes())).toEqual(
      [10, 20, 30, 40, 50, 0]
    );
  });
});

describe("helpers", () => {
  it("names the Nether and the End", () => {
    expect(worldLabel("TFMC_Map_nether")).toBe("the Nether");
    expect(worldLabel("TFMC_Map_the_end")).toBe("the End");
    expect(worldLabel("world #9")).toBe("world #9");
  });

  it("bounds only the map's world", () => {
    const out = stretches([p(0, 10, 20), p(60, 30, 5), p(120, 900, 900, ACTION_PING, 1)], WORLDS, 60);
    expect(boundsOf(out, "TFMC_Map")).toEqual({ x: 10, y: 5, w: 20, h: 15 });
    expect(boundsOf([], "TFMC_Map")).toBeNull();
  });

  it("round-trips datetime-local values to the minute", () => {
    const t = 1_791_293_460;
    expect(fromLocalInput(toLocalInput(t))).toBe(t);
    expect(fromLocalInput("")).toBeNull();
  });
});

describe("session labels", () => {
  const at = (h: number, m: number) => Date.UTC(2026, 9, 6, h - 1, m) / 1000;
  const point = (time: number) => ({ time, world: "TFMC_Map", x: 0, y: 64, z: 0 });
  const session = (end_kind: "logout" | "open" | "last_observed" | "unknown", end: number | null, seen: number) => ({
    id: "s",
    start: point(at(13, 2)),
    end: end === null ? null : point(end),
    end_kind,
    duration_seconds: null,
    last_observed: point(seen),
  });

  it("says only what the record shows", () => {
    expect(sessionEndLabel(session("logout", at(14, 15), at(14, 15)))).toBe("Logged out 14:15");
    expect(sessionEndLabel(session("open", null, at(14, 14)))).toBe("Probably online · last observed 14:14");
    expect(sessionEndLabel(session("last_observed", at(14, 15), at(14, 15)))).toBe(
      "Last observed 14:15 · logout not recorded"
    );
    expect(sessionEndLabel(session("unknown", null, at(13, 2)))).toBe("End unknown");
    expect(sessionSpanLabel(session("logout", at(14, 15), at(14, 15)))).toBe("13:02 → 14:15");
    expect(sessionSpanLabel(session("open", null, at(14, 14)))).toBe("13:02 → now");
  });
});
