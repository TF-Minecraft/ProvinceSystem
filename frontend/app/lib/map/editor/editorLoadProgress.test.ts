import { describe, expect, it } from "vitest";

import { computeEditorLoadProgress, getEnabledStages, type EditorLoadStageId } from "./editorLoadProgress";

describe("getEnabledStages", () => {
  it("includes province stages for county mode", () => {
    const stages = getEnabledStages({
      needsProvinceIndex: true,
      childTierMode: false,
    });
    expect(stages).toEqual(["titles", "provinceCatalog", "provinceGrid", "mapImage"]);
  });

  it("includes child pick for child tier mode", () => {
    const stages = getEnabledStages({
      needsProvinceIndex: true,
      childTierMode: true,
    });
    expect(stages).toContain("childPick");
  });
});

describe("computeEditorLoadProgress", () => {
  const countyStages = getEnabledStages({
    needsProvinceIndex: true,
    childTierMode: false,
  });

  it("returns 100% when all county stages complete", () => {
    const completed = new Set<EditorLoadStageId>(countyStages);
    const result = computeEditorLoadProgress(countyStages, completed, null);
    expect(result.percent).toBe(100);
    expect(result.ready).toBe(true);
  });

  it("includes child pick weight for child tier", () => {
    const childStages = getEnabledStages({
      needsProvinceIndex: true,
      childTierMode: true,
    });
    const partial = new Set<EditorLoadStageId>(countyStages);
    const partialResult = computeEditorLoadProgress(childStages, partial, null);
    const withoutChild = computeEditorLoadProgress(countyStages, partial, null);
    expect(partialResult.percent).toBeLessThan(withoutChild.percent);
  });

  it("matches partial completion weights", () => {
    const completed = new Set<EditorLoadStageId>(["titles", "provinceCatalog"]);
    const result = computeEditorLoadProgress(countyStages, completed, "provinceGrid");
    expect(result.percent).toBe(29);
    expect(result.label).toBe("Loading province index...");
    expect(result.ready).toBe(false);
  });

  it("uses active stage label when provided", () => {
    const result = computeEditorLoadProgress(countyStages, new Set(), "mapImage");
    expect(result.label).toBe("Loading map image...");
  });
});
