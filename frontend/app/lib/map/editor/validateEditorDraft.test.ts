import { describe, expect, it } from "vitest";

import { serializeTitleDraftForSave, validateEditorDraft } from "./validateEditorDraft";

describe("validateEditorDraft", () => {
  it("accepts valid county draft", () => {
    const result = validateEditorDraft({
      tier: "county",
      draft: {
        COUNTY_1: {
          name: "North",
          rgb: "58,132,60",
          provinces: [1, 2],
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects empty draft", () => {
    const result = validateEditorDraft({
      tier: "county",
      draft: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("Title data must be a non-empty object");
  });

  it("rejects duplicate rgb", () => {
    const result = validateEditorDraft({
      tier: "county",
      draft: {
        A: { name: "A", rgb: "10,20,30", provinces: [1] },
        B: { name: "B", rgb: "10,20,30", provinces: [2] },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("Duplicate rgb"))).toBe(true);
  });

  it("rejects duplicate province assignment", () => {
    const result = validateEditorDraft({
      tier: "county",
      draft: {
        A: { name: "A", rgb: "10,20,30", provinces: [1, 2] },
        B: { name: "B", rgb: "40,50,60", provinces: [2] },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("Province 2 is assigned to both"))).toBe(true);
  });

  it("rejects invalid name and rgb", () => {
    const result = validateEditorDraft({
      tier: "county",
      draft: {
        BAD: { name: "", rgb: "invalid", provinces: [1] },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("non-empty name"))).toBe(true);
    expect(result.errors.some((e) => e.includes("invalid rgb"))).toBe(true);
  });

  it("validates duchy child references against child snapshot", () => {
    const result = validateEditorDraft({
      tier: "duchy",
      draft: {
        DUCHY_1: {
          name: "Valoris",
          rgb: "100,100,100",
          titles: ["COUNTY_1", "MISSING"],
        },
      },
      childTierSnapshot: {
        COUNTY_1: { name: "C1", rgb: "1,2,3", provinces: [1] },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("unknown county 'MISSING'"))).toBe(true);
  });

  it("rejects save when prerequisite child tier is dirty", () => {
    const result = validateEditorDraft({
      tier: "duchy",
      draft: {
        DUCHY_1: {
          name: "Valoris",
          rgb: "100,100,100",
          titles: ["COUNTY_1"],
        },
      },
      childTierSnapshot: {
        COUNTY_1: { name: "C1", rgb: "1,2,3", provinces: [1] },
      },
      prerequisiteChildTierDirty: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("before saving duchies"))).toBe(true);
  });
});

describe("serializeTitleDraftForSave", () => {
  it("serializes county provinces and strips extra fields", () => {
    const out = serializeTitleDraftForSave(
      {
        COUNTY_1: {
          name: "North",
          rgb: "1,2,3",
          provinces: [1, 2],
        },
      },
      "county",
    );
    expect(out).toEqual({
      COUNTY_1: { name: "North", rgb: "1,2,3", provinces: [1, 2] },
    });
  });

  it("serializes duchy titles", () => {
    const out = serializeTitleDraftForSave(
      {
        DUCHY_1: {
          name: "D",
          rgb: "4,5,6",
          titles: ["COUNTY_1"],
        },
      },
      "duchy",
    );
    expect(out).toEqual({
      DUCHY_1: { name: "D", rgb: "4,5,6", titles: ["COUNTY_1"] },
    });
  });
});
