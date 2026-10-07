import { describe, expect, it } from "vitest";

// Day and clock-change cases below are written for London.
process.env.TZ = "Europe/London";

import type { PlayerSession, WorldPoint } from "./api";
import { dayLabel, groupByDay, sessionRow } from "./sessionDays";

/** Unix seconds for a London wall-clock time in 2026 (BST until 25 Oct). */
function london(month: number, day: number, hour: number, minute = 0, year = 2026): number {
  return new Date(year, month - 1, day, hour, minute).getTime() / 1000;
}

function point(time: number): WorldPoint {
  return { time, world: "TFMC_Map", x: 0, y: 64, z: 0 };
}

function session(
  id: string,
  start: number,
  end_kind: PlayerSession["end_kind"],
  end: number | null,
  duration_seconds: number | null
): PlayerSession {
  return { id, start: point(start), end: end === null ? null : point(end), end_kind, duration_seconds,
           last_observed: point(end ?? start) };
}

const NOW = london(10, 7, 14);

describe("dayLabel", () => {
  it("names today and yesterday by the calendar, not by 24 hours", () => {
    expect(dayLabel(london(10, 7, 0, 5), NOW)).toBe("Today");
    expect(dayLabel(london(10, 6, 23, 59), london(10, 7, 0, 1))).toBe("Yesterday");
    expect(dayLabel(london(10, 5, 23, 59), london(10, 7, 0, 1))).toBe("Mon 5 Oct");
  });

  it("adds the year only for another year", () => {
    expect(dayLabel(london(10, 2, 12), NOW)).toBe("Fri 2 Oct");
    expect(dayLabel(london(12, 30, 12, 0, 2025), NOW)).toBe("Tue 30 Dec 2025");
  });

  it("finds yesterday across a new year and a clock change", () => {
    expect(dayLabel(london(12, 31, 23, 0), london(1, 1, 9, 0, 2027))).toBe("Yesterday");
    // Clocks went back at 02:00 on 25 Oct 2026, so that day had 25 hours.
    expect(dayLabel(london(10, 25, 0, 30), london(10, 26, 0, 30))).toBe("Yesterday");
    expect(dayLabel(london(10, 24, 23, 30), london(10, 26, 0, 30))).toBe("Sat 24 Oct");
  });
});

describe("groupByDay", () => {
  it("keeps a session past midnight under its login day", () => {
    const late = session("a", london(10, 6, 23, 10), "logout", london(10, 7, 0, 40), 5400);
    const days = groupByDay([late], NOW);
    expect(days.map((d) => [d.label, d.sessions.map((s) => s.id)])).toEqual([["Yesterday", ["a"]]]);
  });

  it("joins a day split across loaded pages, newest first", () => {
    const rows = [
      session("a", london(10, 7, 13), "open", null, 600),
      session("b", london(10, 2, 19), "logout", london(10, 2, 20), 3600),
      // The next page starts mid-day.
      session("c", london(10, 2, 12), "logout", london(10, 2, 13), 3600),
      session("d", london(10, 1, 12), "logout", london(10, 1, 13), 3600),
    ];
    expect(groupByDay(rows, NOW).map((d) => [d.label, d.sessions.map((s) => s.id)])).toEqual([
      ["Today", ["a"]],
      ["Fri 2 Oct", ["b", "c"]],
      ["Thu 1 Oct", ["d"]],
    ]);
  });
});

describe("sessionRow", () => {
  it("shows a logout as a plain span", () => {
    expect(sessionRow(session("a", london(10, 4, 18, 20), "logout", london(10, 4, 19, 27), 4020))).toEqual({
      start: "18:20", end: "19:27", duration: "1 h 7 min", note: null,
    });
  });

  it("names the end day past midnight, and the year past new year", () => {
    expect(sessionRow(session("a", london(10, 6, 23, 10), "logout", london(10, 7, 0, 40), 5400)).end).toBe("Wed 7 Oct 00:40");
    expect(sessionRow(session("a", london(12, 31, 23, 30), "logout", london(1, 1, 0, 10, 2027), 2400)).end)
      .toBe("Fri 1 Jan 2027 00:10");
  });

  it("hedges an open session", () => {
    expect(sessionRow(session("a", london(10, 7, 13, 32), "open", null, 2520))).toEqual({
      start: "13:32", end: "now", duration: "42 min so far", note: "Probably online",
    });
  });

  it("gives a missing logout as a lower bound from the last sighting", () => {
    expect(sessionRow(session("a", london(10, 6, 23, 10), "last_observed", london(10, 7, 0, 40), 5400))).toEqual({
      start: "23:10", end: "?", duration: "at least 1 h 30 min", note: "No logout recorded · last seen Wed 7 Oct 00:40",
    });
  });

  it("claims no length when nothing was seen after the login", () => {
    expect(sessionRow(session("a", london(9, 20, 13, 2), "last_observed", null, null))).toEqual({
      start: "13:02", end: "?", duration: null, note: "No logout recorded",
    });
    expect(sessionRow(session("a", london(10, 7, 13, 2), "unknown", null, null))).toEqual({
      start: "13:02", end: "?", duration: null, note: "End unknown",
    });
  });
});
