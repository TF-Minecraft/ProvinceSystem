import { describe, expect, it } from "vitest";

import { buildChildToParentId, canSelectChild, findDuplicateChildIds, getChildOwnerName } from "./childTitleAssignment";

describe("childTitleAssignment", () => {
  const draft = {
    PARENT_1: { name: "Valoris", rgb: "1,2,3", titles: ["CHILD_1", "CHILD_2"] },
    PARENT_2: { name: "North", rgb: "4,5,6", titles: ["CHILD_3"] },
  };

  const assignment = buildChildToParentId(draft);

  it("buildChildToParentId maps children to parents", () => {
    expect(assignment.get("CHILD_1")).toBe("PARENT_1");
    expect(assignment.get("CHILD_3")).toBe("PARENT_2");
    expect(assignment.get("CHILD_99")).toBeUndefined();
  });

  it("canSelectChild allows unassigned and own parent", () => {
    expect(canSelectChild("CHILD_4", "PARENT_1", assignment)).toBe(true);
    expect(canSelectChild("CHILD_1", "PARENT_1", assignment)).toBe(true);
    expect(canSelectChild("CHILD_3", "PARENT_1", assignment)).toBe(false);
  });

  it("findDuplicateChildIds detects duplicates", () => {
    const dupDraft = {
      PARENT_1: { titles: ["CHILD_1"] },
      PARENT_2: { titles: ["CHILD_1", "CHILD_2"] },
    };
    expect(findDuplicateChildIds(dupDraft)).toEqual(["CHILD_1"]);
    expect(findDuplicateChildIds(draft)).toEqual([]);
  });

  it("getChildOwnerName returns parent display name", () => {
    expect(getChildOwnerName("CHILD_3", assignment, draft)).toBe("North");
    expect(getChildOwnerName("CHILD_99", assignment, draft)).toBeNull();
  });
});
