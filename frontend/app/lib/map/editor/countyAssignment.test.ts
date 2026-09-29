import { describe, expect, it } from "vitest";

import {
  buildProvinceToCountyId,
  canSelectProvince,
  findDuplicateProvinceIds,
  getProvinceOwnerName,
  unassignedProvinces,
} from "./countyAssignment";

describe("countyAssignment", () => {
  const draft = {
    COUNTY_1: { name: "Elvaris", rgb: "1,1,1", provinces: [1, 2] },
    COUNTY_2: { name: "Northmarch", rgb: "2,2,2", provinces: [3] },
  };

  const assignment = buildProvinceToCountyId(draft);

  it("buildProvinceToCountyId maps provinces to counties", () => {
    expect(assignment.get(1)).toBe("COUNTY_1");
    expect(assignment.get(3)).toBe("COUNTY_2");
    expect(assignment.get(99)).toBeUndefined();
  });

  it("unassignedProvinces returns ids not in assignment", () => {
    expect(unassignedProvinces([1, 2, 3, 4], assignment)).toEqual([4]);
  });

  it("canSelectProvince allows unassigned and own county", () => {
    expect(canSelectProvince(4, "COUNTY_1", assignment)).toBe(true);
    expect(canSelectProvince(1, "COUNTY_1", assignment)).toBe(true);
    expect(canSelectProvince(3, "COUNTY_1", assignment)).toBe(false);
  });

  it("canSelectProvince requires editing id", () => {
    expect(canSelectProvince(4, null, assignment)).toBe(false);
  });

  it("findDuplicateProvinceIds detects duplicates", () => {
    const dupDraft = {
      COUNTY_1: { name: "A", rgb: "1,1,1", provinces: [1, 2] },
      COUNTY_2: { name: "B", rgb: "2,2,2", provinces: [2, 3] },
    };
    expect(findDuplicateProvinceIds(dupDraft)).toEqual([2]);
    expect(findDuplicateProvinceIds(draft)).toEqual([]);
  });

  it("getProvinceOwnerName returns county display name", () => {
    expect(getProvinceOwnerName(3, assignment, draft)).toBe("Northmarch");
    expect(getProvinceOwnerName(99, assignment, draft)).toBeNull();
  });
});
