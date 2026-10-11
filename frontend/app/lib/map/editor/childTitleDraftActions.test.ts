import { describe, expect, it } from "vitest";

import { removeTitleFromDraft, toggleChildInParent } from "./childTitleDraftActions";

describe("childTitleDraftActions", () => {
  it("toggleChildInParent adds child", () => {
    const entry = { name: "PARENT_1", rgb: "128,128,128", titles: [] };
    const next = toggleChildInParent(entry, "CHILD_1", {
      childRgb: "58,132,60",
      usedRgbs: ["10,20,30"],
    });
    expect(next.titles).toEqual(["CHILD_1"]);
    expect(next.rgb).not.toBe("128,128,128");
  });

  it("toggleChildInParent removes child", () => {
    const entry = {
      name: "PARENT_1",
      rgb: "180,80,80",
      titles: ["CHILD_1", "CHILD_2"],
    };
    const next = toggleChildInParent(entry, "CHILD_1");
    expect(next.titles).toEqual(["CHILD_2"]);
  });

  it("removeTitleFromDraft deletes title key", () => {
    const draft = {
      PARENT_1: { name: "A", rgb: "1,2,3", titles: ["CHILD_1"] },
      PARENT_2: { name: "B", rgb: "4,5,6", titles: ["CHILD_2"] },
    };
    const next = removeTitleFromDraft(draft, "PARENT_1");
    expect(next).toEqual({
      PARENT_2: { name: "B", rgb: "4,5,6", titles: ["CHILD_2"] },
    });
  });
});
