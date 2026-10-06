import { describe, expect, it } from "vitest";

import {
  ACTION_LOGIN,
  ACTION_LOGOUT,
  ACTION_PING,
  boundsOf,
  distanceTravelled,
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

  it("leaves teleports out of the distance", () => {
    expect(distanceTravelled(out)).toBe(120);
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
