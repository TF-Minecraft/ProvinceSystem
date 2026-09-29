import { describe, expect, it } from "vitest";

import {
  buildCountyToDuchyId,
  canSelectCounty,
  findDuplicateCountyIds,
  getCountyOwnerName,
} from "./duchyAssignment";

describe("duchyAssignment", () => {
  const draft = {
    DUCHY_1: { name: "Valoris", rgb: "1,1,1", titles: ["COUNTY_1", "COUNTY_2"] },
    DUCHY_2: { name: "North", rgb: "2,2,2", titles: ["COUNTY_3"] },
  };

  const assignment = buildCountyToDuchyId(draft);

  it("buildCountyToDuchyId maps counties to duchies", () => {
    expect(assignment.get("COUNTY_1")).toBe("DUCHY_1");
    expect(assignment.get("COUNTY_3")).toBe("DUCHY_2");
    expect(assignment.get("COUNTY_99")).toBeUndefined();
  });

  it("canSelectCounty allows unassigned and own duchy", () => {
    expect(canSelectCounty("COUNTY_4", "DUCHY_1", assignment)).toBe(true);
    expect(canSelectCounty("COUNTY_1", "DUCHY_1", assignment)).toBe(true);
    expect(canSelectCounty("COUNTY_3", "DUCHY_1", assignment)).toBe(false);
  });

  it("findDuplicateCountyIds detects duplicates", () => {
    const dupDraft = {
      DUCHY_1: { name: "A", rgb: "1,1,1", titles: ["COUNTY_1"] },
      DUCHY_2: { name: "B", rgb: "2,2,2", titles: ["COUNTY_1", "COUNTY_2"] },
    };
    expect(findDuplicateCountyIds(dupDraft)).toEqual(["COUNTY_1"]);
    expect(findDuplicateCountyIds(draft)).toEqual([]);
  });

  it("getCountyOwnerName returns duchy display name", () => {
    expect(getCountyOwnerName("COUNTY_3", assignment, draft)).toBe("North");
    expect(getCountyOwnerName("COUNTY_99", assignment, draft)).toBeNull();
  });
});
