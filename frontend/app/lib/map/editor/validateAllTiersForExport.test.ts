import { describe, expect, it } from "vitest";

import type { TitleDraft } from "@/app/hooks/useEditorDraft";

import { validateAllTiersForExport } from "./validateAllTiersForExport";

function emptyDrafts(): Record<"county" | "duchy" | "kingdom" | "empire", TitleDraft> {
  return {
    county: {
      COUNTY_1: {
        name: "North",
        rgb: "58,132,60",
        provinces: [1],
      },
    },
    duchy: {},
    kingdom: {},
    empire: {},
  };
}

describe("validateAllTiersForExport", () => {
  it("accepts valid county drafts with empty higher tiers", () => {
    const result = validateAllTiersForExport(emptyDrafts());
    expect(result.ok).toBe(true);
  });

  it("accepts when all tiers pass validation", () => {
    const drafts = emptyDrafts();
    drafts.duchy = {
      DUCHY_1: {
        name: "North Duchy",
        rgb: "80,90,100",
        titles: ["COUNTY_1"],
      },
    };
    drafts.kingdom = {
      KINGDOM_1: {
        name: "North Kingdom",
        rgb: "110,120,130",
        titles: ["DUCHY_1"],
      },
    };
    drafts.empire = {
      EMPIRE_1: {
        name: "The Empire",
        rgb: "140,150,160",
        titles: ["KINGDOM_1"],
      },
    };

    const result = validateAllTiersForExport(drafts);
    expect(result.ok).toBe(true);
  });

  it("prefixes errors with tier labels", () => {
    const drafts = emptyDrafts();
    drafts.county.COUNTY_1 = {
      name: "",
      rgb: "bad",
      provinces: [1],
    };

    const result = validateAllTiersForExport(drafts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.startsWith("County:"))).toBe(true);
  });

  it("rejects duchy referencing unknown county from cross-tier snapshot", () => {
    const drafts = emptyDrafts();
    drafts.duchy = {
      DUCHY_1: {
        name: "North Duchy",
        rgb: "80,90,100",
        titles: ["MISSING_COUNTY"],
      },
    };

    const result = validateAllTiersForExport(drafts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.startsWith("Duchy:") && e.includes("references unknown county 'MISSING_COUNTY'")),
    ).toBe(true);
  });
});
