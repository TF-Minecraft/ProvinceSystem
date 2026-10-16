import { describe, expect, it } from "vitest";

import { buildChildPickIndex } from "./useEditorChildPick";
import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import type { TitleLayers } from "@/app/lib/titleProvinces";

describe("buildChildPickIndex", () => {
  it("county children pick by their provinces, including a black-coloured county", () => {
    const childDraft: TitleDraft = {
      BlackCounty: { name: "Black", rgb: "0,0,0", provinces: [7, 8] },
      GreenCounty: { name: "Green", rgb: "0,200,0", provinces: [9] },
    };
    const index = buildChildPickIndex("county", childDraft, { county: {} });
    expect(index?.get(7)).toBe("BlackCounty");
    expect(index?.get(8)).toBe("BlackCounty");
    expect(index?.get(9)).toBe("GreenCounty");
    expect(index?.get(10)).toBeUndefined();
  });

  it("two counties sharing a colour stay distinct children", () => {
    const childDraft: TitleDraft = {
      First: { name: "First", rgb: "10,10,10", provinces: [1] },
      Second: { name: "Second", rgb: "10,10,10", provinces: [2] },
    };
    const index = buildChildPickIndex("county", childDraft, { county: {} });
    expect(index?.get(1)).toBe("First");
    expect(index?.get(2)).toBe("Second");
  });

  it("duchy children resolve through the county layer, following the child draft", () => {
    const layers: TitleLayers = {
      county: {
        CountyA: { provinces: [1, 2] },
        CountyB: { provinces: [3] },
      },
      // The fetched duchy layer disagrees with the child draft; the draft
      // is the pick-id source, so its titles win.
      duchy: { DuchyA: { titles: [] } },
    };
    const childDraft: TitleDraft = {
      DuchyA: { name: "DuchyA", rgb: "0,0,0", titles: ["CountyA"] },
      DuchyB: { name: "DuchyB", rgb: "1,1,1", titles: ["CountyB"] },
    };
    const index = buildChildPickIndex("duchy", childDraft, layers);
    expect(index?.get(1)).toBe("DuchyA");
    expect(index?.get(3)).toBe("DuchyB");
  });

  it("kingdom children resolve through county and duchy layers, following the child draft", () => {
    const layers: TitleLayers = {
      county: { CountyA: { provinces: [5] } },
      duchy: { DuchyA: { titles: ["CountyA"] } },
      kingdom: { KingdomA: { titles: [] } },
    };
    const childDraft: TitleDraft = {
      KingdomA: { name: "KingdomA", rgb: "0,0,0", titles: ["DuchyA"] },
    };
    const index = buildChildPickIndex("kingdom", childDraft, layers);
    expect(index?.get(5)).toBe("KingdomA");
  });

  it("withholds while a layer the chain needs has not loaded", () => {
    const childDraft: TitleDraft = {
      KingdomA: { name: "KingdomA", rgb: "0,0,0", titles: ["DuchyA"] },
    };
    expect(buildChildPickIndex("kingdom", childDraft, { county: {} })).toBeNull();
    expect(buildChildPickIndex("kingdom", childDraft, null)).toBeNull();
    expect(buildChildPickIndex(null, childDraft, { county: {} })).toBeNull();
  });
});
