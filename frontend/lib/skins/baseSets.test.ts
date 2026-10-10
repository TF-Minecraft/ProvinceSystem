import { describe, expect, it } from "vitest";
import {
  ARMOR_METALS,
  ARMOR_TYPES,
  armorTier,
  armorTierLabel,
  baseSetLabel,
  baseSetsForKind,
} from "./baseSets";

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

describe("armour metal lines", () => {
  it("names each set by type and metal", () => {
    expect(armorTier("light", "iron")).toBe("light_iron");
    expect(armorTierLabel("heavy_abyssalite")).toBe("Heavy Abyssalite");
  });

  it("still labels older bare tiers", () => {
    expect(armorTierLabel("mage")).toBe("Mage");
  });

  it("offers one metal per submission and five set types", () => {
    expect(baseSetsForKind("armor_set")).toEqual(ARMOR_METALS);
    expect(ARMOR_TYPES).toHaveLength(5);
  });
});
