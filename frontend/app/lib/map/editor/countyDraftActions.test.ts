import { describe, expect, it } from "vitest";

import { removeCountyFromDraft, toggleProvinceInCounty } from "./countyDraftActions";

describe("countyDraftActions", () => {
  it("toggleProvinceInCounty adds province", () => {
    const entry = { name: "COUNTY_1", rgb: "128,128,128", provinces: [] };
    const next = toggleProvinceInCounty(entry, 5, {
      provinceRgb: "58,132,60",
      usedRgbs: ["10,20,30"],
    });
    expect(next.provinces).toEqual([5]);
    expect(next.rgb).not.toBe("128,128,128");
  });

  it("toggleProvinceInCounty removes province", () => {
    const entry = { name: "COUNTY_1", rgb: "180,80,80", provinces: [1, 2] };
    const next = toggleProvinceInCounty(entry, 1);
    expect(next.provinces).toEqual([2]);
    expect(next.rgb).toBe("180,80,80");
  });

  it("toggleProvinceInCounty keeps rgb when not first add", () => {
    const entry = { name: "COUNTY_1", rgb: "180,80,80", provinces: [1] };
    const next = toggleProvinceInCounty(entry, 2, {
      provinceRgb: "58,132,60",
    });
    expect(next.provinces).toEqual([1, 2]);
    expect(next.rgb).toBe("180,80,80");
  });

  it("removeCountyFromDraft deletes county key", () => {
    const draft = {
      COUNTY_1: { name: "A", rgb: "1,2,3", provinces: [1] },
      COUNTY_2: { name: "B", rgb: "4,5,6", provinces: [2] },
    };
    const next = removeCountyFromDraft(draft, "COUNTY_1");
    expect(next).toEqual({
      COUNTY_2: { name: "B", rgb: "4,5,6", provinces: [2] },
    });
  });
});
