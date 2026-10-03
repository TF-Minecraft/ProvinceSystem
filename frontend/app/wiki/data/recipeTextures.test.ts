import { existsSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FishingPage from "../fishing/page";
import GunsPage from "../guns/page";
import mmoitems from "./generated/mmoitemsItems.json";
import itemsadder from "./generated/itemsadderItems.json";
import { allRecipes } from "./registry";
import { stationRecipes } from "./station-recipes";
import { gunAmmo, gunParts } from "./guns";

type TextureManifestRecord = {
  name?: string;
  material?: string;
  texture?: string;
  sourceKind?: string;
  sourceModel?: string;
  sourceTexture?: string;
};
const mmoitemRecords = mmoitems as Record<string, TextureManifestRecord>;
const itemsadderRecords = itemsadder as Record<string, TextureManifestRecord>;

const publicRoot = path.join(process.cwd(), "public");
const pluginsRoot = "C:/Users/MSI/Desktop/plugins/ItemsAdder/contents";

function publicAsset(url: string) {
  return path.join(publicRoot, decodeURIComponent(url.split("?")[0]).replace(/^\//, ""));
}

function recipeAssets() {
  return allRecipes.flatMap((recipe) => [
    ...recipe.ingredients.map((slot) => ({ recipe: recipe.key, role: "ingredient", slot })),
    { recipe: recipe.key, role: "output", slot: recipe.output },
  ]);
}

describe("recipe textures", () => {
  it("gives every globally registered named recipe slot a visual whose assets exist", () => {
    const slots = recipeAssets();
    const missingVisual = slots.filter(({ slot }) => slot.name && !slot.texture && !slot.model);
    expect(missingVisual).toEqual([]);

    const missingAssets: string[] = [];
    for (const { recipe, role, slot } of slots) {
      if (slot.texture && !existsSync(publicAsset(slot.texture))) {
        missingAssets.push(`${recipe} ${role}: ${slot.texture}`);
      }
      if (slot.model) {
        for (const url of [
          slot.model.url,
          slot.model.texture,
          slot.model.textureAnimationUrl,
          ...Object.values(slot.model.textures ?? {}),
        ].filter((value): value is string => Boolean(value))) {
          if (!existsSync(publicAsset(url))) missingAssets.push(`${recipe} ${role}: ${url}`);
        }
      }
    }
    expect(missingAssets).toEqual([]);
  });

  it("keeps generated station coverage complete", () => {
    const slots = stationRecipes.flatMap((recipe) => [...recipe.ingredients, recipe.output]);
    expect(stationRecipes).toHaveLength(752);
    expect(slots).toHaveLength(1751);
    expect(slots.filter((slot) => slot.name && (slot.texture || slot.model))).toHaveLength(1751);
  });

  it("uses the exact TFMC sprites for lockpicks, collectors, and no-CMD tool families", () => {
    const exact: Record<string, string> = {
      BASIC_LOCKPICK: "item/tools/basic_lockpick.png",
      STRONG_LOCKPICK: "item/tools/strong_lockpick.png",
      STEEL_ALCHEMY_COLLECTOR: "item/tools/steel_alchemy_collector.png",
      ABYSSALITE_AXE: "item/tools/abyssalite_axe.png",
      ABYSSALITE_PICKAXE: "item/tools/abyssalite_pickaxe.png",
      ABYSSALITE_HOE: "item/tools/abyssalite_hoe.png",
      ABYSSALITE_SHOVEL: "item/tools/abyssalite_shovel.png",
      MYTHRIL_AXE: "item/tools/mythril_axe.png",
      MYTHRIL_PICKAXE: "item/tools/mythril_pickaxe.png",
      MYTHRIL_HOE: "item/tools/mythril_hoe.png",
      MYTHRIL_SHOVEL: "item/tools/mythril_shovel.png",
    };
    for (const [id, suffix] of Object.entries(exact)) {
      const record = mmoitemRecords[id];
      expect(record.sourceTexture, id).toBe(`tfmc_pack/resourcepack/assets/minecraft/textures/${suffix}`);
      if (existsSync(pluginsRoot)) {
        expect(existsSync(path.join(pluginsRoot, record.sourceTexture!)), id).toBe(true);
        expect(existsSync(path.join(pluginsRoot, record.sourceModel!)), id).toBe(true);
      }
      expect(existsSync(path.join(publicRoot, "wiki", "textures", record.texture!)), id).toBe(true);
    }
  });

  it("never treats a Blockbench UV atlas as a flat item sprite", () => {
    expect(Object.values(itemsadderRecords).filter((record) => record.sourceKind === "model-atlas")).toEqual([]);
    const modelOnlyIds = ["archeology_cabinet", "marauder_coins", "saucepan", "voting_booth"] as const;
    for (const id of modelOnlyIds) {
      expect(itemsadderRecords[id].material).toBe("PAPER");
      expect("texture" in itemsadderRecords[id]).toBe(false);
    }
  });

  it("renders every local guns and fishing recipe output with an image", () => {
    const guns = renderToStaticMarkup(GunsPage());
    for (const name of [...gunParts.map((part) => part.part), ...gunAmmo.map((ammo) => ammo.ammo)]) {
      expect(guns, name).toContain(`alt="${name}"`);
    }
    const fishing = renderToStaticMarkup(FishingPage());
    for (const name of ["Iron Rod", "Steel Rod", "Abyssalite Rod", "Mythril Rod"]) {
      expect(fishing, name).toContain(`alt="${name}"`);
    }
  });
});
