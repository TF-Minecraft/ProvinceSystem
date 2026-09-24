import { describe, expect, it } from "vitest";
import { baseSetLabel, baseSetsForKind } from "./baseSets";

describe("lute base set", () => {
  it("offers Lutes for 16×16 handheld and item 3D", () => {
    expect(baseSetsForKind("handheld")).toContain("lutes");
    expect(baseSetsForKind("item_3d")).toContain("lutes");
    expect(baseSetLabel("lutes")).toBe("Lutes");
  });

  it("keeps Lutes off large handheld", () => {
    expect(baseSetsForKind("large_handheld")).not.toContain("lutes");
  });
});
