import { describe, expect, it } from "vitest";
import { ownerFileNames } from "./ownerFiles";

describe("ownerFileNames", () => {
  it("names each armour set's layers, icons and 3D helmet", () => {
    const names = ownerFileNames({ kind: "armor_set", slug: "x", tiers: ["iron", "mage"] });
    expect(names.iron_layer_1).toBe("iron_layer_1.png");
    expect(names.mage_boots).toBe("mage_boots.png");
    expect(names.iron_helmet_model).toBe("iron_helmet_model.json");
  });

  it("names bow frames as storage writes them", () => {
    expect(ownerFileNames({ kind: "crossbow", slug: "arm" })).toEqual({
      texture: "arm.png",
      pull_0: "arm_0.png",
      pull_1: "arm_1.png",
      pull_2: "arm_2.png",
      charged: "arm_charged.png",
    });
  });

  it("pairs 3D models with their textures, and books with both covers", () => {
    expect(ownerFileNames({ kind: "helmet_3d", slug: "hat" })).toEqual({ texture: "hat.png", model: "hat.json" });
    expect(ownerFileNames({ kind: "gun", slug: "g" }).aim_model).toBe("g_aim.json");
    expect(ownerFileNames({ kind: "book", slug: "j" })).toEqual({ unsigned: "j_unsigned.png", signed: "j_signed.png" });
    expect(ownerFileNames({ kind: "large_handheld", slug: "staff" })).toEqual({ texture: "staff.png" });
  });
});
