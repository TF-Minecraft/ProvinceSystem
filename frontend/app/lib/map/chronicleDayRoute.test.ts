import { describe, expect, it } from "vitest";

import {
  CHRONICLE_DAY_PATTERN,
  chronicleDayHref,
  chronicleDayWalk,
  chronicleStudioHref,
  isValidChronicleDay,
  liveMapHref,
  liveMapIdFrom,
  setLiveMapId,
  parseChronicleDayRange,
  parseMapRouteSegment,
} from "./chronicleDayRoute";

describe("isValidChronicleDay", () => {
  it("accepts a well-formed day", () => {
    expect(isValidChronicleDay("2026-08-25")).toBe(true);
    expect(isValidChronicleDay("0001-01-01")).toBe(true);
  });

  it("rejects anything that is not exactly YYYY-MM-DD", () => {
    for (const bad of [
      "",
      "2026-8-25",
      "2026-08-5",
      "26-08-25",
      "2026-08-25T00:00:00Z",
      "2026-08-250",
      " 2026-08-25",
      "2026-08-25 ",
      "2026/08/25",
      "latest",
    ]) {
      expect(isValidChronicleDay(bad), bad).toBe(false);
    }
  });

  it("rejects traversal and injection shapes", () => {
    for (const bad of [
      "..",
      "../../etc/passwd",
      "2026-08-25/../../secret",
      "%2e%2e%2f",
      "2026-08-25?x=1",
      "__proto__",
    ]) {
      expect(isValidChronicleDay(bad), bad).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    for (const bad of [null, undefined, 20260825, ["2026-08-25"], {}]) {
      expect(isValidChronicleDay(bad)).toBe(false);
    }
  });

  it("is anchored at both ends", () => {
    // A newline is the classic way an unanchored `$` still matches.
    expect(CHRONICLE_DAY_PATTERN.test("2026-08-25\nrm -rf")).toBe(false);
    expect(CHRONICLE_DAY_PATTERN.test("x2026-08-25")).toBe(false);
  });

  it("is not a calendar check, only a shape check", () => {
    // Whether the day exists is the chronicle index's job, not this regex's.
    expect(isValidChronicleDay("2026-02-31")).toBe(true);
    expect(isValidChronicleDay("2026-13-99")).toBe(true);
  });

  it("has no lastIndex state to leak between calls", () => {
    // A `/g` regex would alternate true/false here.
    expect(isValidChronicleDay("2026-08-25")).toBe(true);
    expect(isValidChronicleDay("2026-08-25")).toBe(true);
  });
});

describe("chronicle route hrefs", () => {
  it("maps the dev map id onto its public segment", () => {
    expect(liveMapHref("main")).toBe("/map");
    setLiveMapId("dev");
    expect(liveMapHref("dev")).toBe("/map");
    expect(liveMapHref("main")).toBe("/map/main");
    setLiveMapId("main");
    expect(liveMapIdFrom([{ id: "main" }, { id: "dev", live: true }])).toBe("dev");
    expect(liveMapIdFrom([{ id: "main" }])).toBe("main");
    expect(liveMapHref("dev")).toBe("/map/r3b1rth");
    expect(chronicleStudioHref("main")).toBe("/map/main/chronicle");
    expect(chronicleStudioHref("dev")).toBe("/map/r3b1rth/chronicle");
    expect(liveMapHref("calavorn")).toBe("/map/calavorn");
    expect(chronicleStudioHref("calavorn")).toBe("/map/calavorn/chronicle");
  });

  it("parses public URL segments into wire map ids", () => {
    expect(parseMapRouteSegment("r3b1rth")).toBe("dev");
    expect(parseMapRouteSegment("R3B1RTH")).toBe("dev");
    expect(parseMapRouteSegment("calavorn")).toBe("calavorn");
    expect(parseMapRouteSegment("main")).toBe("main");
    expect(parseMapRouteSegment("dev")).toBe("dev");
    expect(parseMapRouteSegment("map_vardera")).toBeNull();
    expect(parseMapRouteSegment("editor")).toBeNull();
    expect(parseMapRouteSegment("")).toBeNull();
    expect(parseMapRouteSegment("  ")).toBeNull();
  });

  it("builds a day href under the studio route", () => {
    expect(chronicleDayHref("main", "2026-08-25")).toBe(
      "/map/main/chronicle/2026-08-25"
    );
    expect(chronicleDayHref("dev", "2026-08-25")).toBe(
      "/map/r3b1rth/chronicle/2026-08-25"
    );
  });

  it("encodes the day segment rather than interpolating it raw", () => {
    // Never reachable through a validated day, but the helper must not be the
    // weak link if some future caller passes something unvalidated.
    expect(chronicleDayHref("main", "../secret")).toBe(
      "/map/main/chronicle/..%2Fsecret"
    );
  });

  it("leaves the two-argument form free of a query string", () => {
    expect(chronicleDayHref("main", "2026-08-25")).not.toContain("?");
    expect(chronicleDayHref("main", "2026-08-25", null)).not.toContain("?");
    expect(chronicleDayHref("main", "2026-08-25", undefined)).not.toContain("?");
  });

  it("appends the timelapse range when one is given", () => {
    expect(
      chronicleDayHref("main", "2026-08-25", {
        start: "2026-08-01",
        end: "2026-08-31",
      })
    ).toBe("/map/main/chronicle/2026-08-25?from=2026-08-01&to=2026-08-31");
  });

  it("encodes the range values too", () => {
    expect(
      chronicleDayHref("main", "2026-08-25", { start: "a&b", end: "c d" })
    ).toBe("/map/main/chronicle/2026-08-25?from=a%26b&to=c%20d");
  });
});

describe("parseChronicleDayRange", () => {
  it("accepts a well-formed ascending range", () => {
    expect(parseChronicleDayRange("2026-08-01", "2026-08-31")).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
  });

  it("accepts a single-day range", () => {
    expect(parseChronicleDayRange("2026-08-01", "2026-08-01")).toEqual({
      start: "2026-08-01",
      end: "2026-08-01",
    });
  });

  it("rejects a reversed range", () => {
    expect(parseChronicleDayRange("2026-08-31", "2026-08-01")).toBeNull();
  });

  it("rejects malformed or half-present input", () => {
    expect(parseChronicleDayRange("2026-8-1", "2026-08-31")).toBeNull();
    expect(parseChronicleDayRange("2026-08-01", "latest")).toBeNull();
    expect(parseChronicleDayRange(null, "2026-08-31")).toBeNull();
    expect(parseChronicleDayRange("2026-08-01", null)).toBeNull();
    expect(parseChronicleDayRange("../etc", "../etc")).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(parseChronicleDayRange(20260801, 20260831)).toBeNull();
    expect(parseChronicleDayRange(["2026-08-01"], ["2026-08-31"])).toBeNull();
    expect(parseChronicleDayRange({}, {})).toBeNull();
  });
});

describe("chronicleDayWalk", () => {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"];

  it("finds both neighbours for a day mid-list", () => {
    expect(chronicleDayWalk(days, "2026-08-02", null)).toEqual({
      days,
      position: 2,
      total: 4,
      previous: "2026-08-01",
      next: "2026-08-03",
    });
  });

  it("has no previous at the first day and no next at the last", () => {
    const first = chronicleDayWalk(days, "2026-08-01", null);
    expect(first.previous).toBeNull();
    expect(first.next).toBe("2026-08-02");
    expect(first.position).toBe(1);

    const last = chronicleDayWalk(days, "2026-08-04", null);
    expect(last.previous).toBe("2026-08-03");
    expect(last.next).toBeNull();
    expect(last.position).toBe(4);
  });

  it("still offers neighbours for a day that is not in the list", () => {
    // A reader can land on a day the timelapse skipped; navigation must not
    // dead-end there.
    const walk = chronicleDayWalk(
      ["2026-08-01", "2026-08-04"],
      "2026-08-02",
      null
    );
    expect(walk.position).toBe(0);
    expect(walk.previous).toBe("2026-08-01");
    expect(walk.next).toBe("2026-08-04");
  });

  it("walks only the days inside the range", () => {
    const walk = chronicleDayWalk(days, "2026-08-03", {
      start: "2026-08-02",
      end: "2026-08-03",
    });
    expect(walk.days).toEqual(["2026-08-02", "2026-08-03"]);
    expect(walk.total).toBe(2);
    expect(walk.position).toBe(2);
    expect(walk.previous).toBe("2026-08-02");
    expect(walk.next).toBeNull();
  });

  it("sorts and dedupes, and drops entries that are not days", () => {
    const walk = chronicleDayWalk(
      ["2026-08-03", "2026-08-01", "2026-08-03", "latest", null, 42],
      "2026-08-01",
      null
    );
    expect(walk.days).toEqual(["2026-08-01", "2026-08-03"]);
    expect(walk.next).toBe("2026-08-03");
  });

  it("treats a non-array index as an empty walk rather than throwing", () => {
    for (const bad of [null, undefined, "2026-08-01", {}, 7]) {
      const walk = chronicleDayWalk(bad, "2026-08-01", null);
      expect(walk).toEqual({
        days: [],
        position: 0,
        total: 0,
        previous: null,
        next: null,
      });
    }
  });
});
