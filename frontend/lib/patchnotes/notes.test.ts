import { describe, expect, it } from "vitest";

import { groupBullets, weekLabel } from "./notes";

describe("weekLabel", () => {
  it("names the Monday of the ISO week", () => {
    expect(weekLabel("2026-W01")).toBe("Week of 29 December 2025");
    expect(weekLabel("2026-W02")).toBe("Week of 5 January 2026");
  });

  it("leaves an unrecognised key unchanged", () => {
    expect(weekLabel("this-week")).toBe("this-week");
  });
});

describe("groupBullets", () => {
  it("keeps known sections and drops anything else", () => {
    const groups = groupBullets([
      { id: "1", section: "fixed", body: "Fixed a door" },
      { id: "2", section: "new", body: "Added a station" },
      { id: "3", section: "secret", body: "hidden" },
      { id: "4", section: "technical", body: "Rebuilt a plugin" },
    ]);
    expect(groups.new.map((bullet) => bullet.id)).toEqual(["2"]);
    expect(groups.fixed.map((bullet) => bullet.id)).toEqual(["1"]);
    expect(groups.adjusted).toEqual([]);
    expect(groups.technical.map((bullet) => bullet.id)).toEqual(["4"]);
  });
});
