// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CraftingGrid from "../../components/wiki/CraftingGrid";
import { getItemBySlug, getRecipeItemHref, itemDetails, itemRecipes } from "../data/items";
import { customItemIdentity, itemIdentity } from "../data/item-identity";
import ItemDetailPage, { generateStaticParams } from "./[slug]/page";

function recipeWithOutput(name: string) {
  const recipe = itemRecipes.find((candidate) => candidate.output.name === name);
  expect(recipe, `recipe output ${name}`).toBeDefined();
  return recipe!;
}

describe("custom recipe item links", () => {
  it("uses explicit MMOItems and ItemsAdder IDs for same-name items", () => {
    const mmo = { name: "Shared Name", sourceId: "mmoitem:MATERIALS:SHARED" };
    const itemsAdder = { name: "Shared Name", sourceId: "itemsadder:shared" };
    expect(itemIdentity(mmo)).toBe(mmo.sourceId);
    expect(itemIdentity(itemsAdder)).toBe(itemsAdder.sourceId);
    expect(customItemIdentity(mmo)).toBe(mmo.sourceId);
    expect(customItemIdentity(itemsAdder)).toBe(itemsAdder.sourceId);
  });

  it.each(["Abyssalite Pickaxe", "Demonwood Log"]) (
    "renders %s output as a link to its generated item page",
    (name) => {
      const recipe = recipeWithOutput(name);
      const href = getRecipeItemHref(recipe.output);
      expect(href).toMatch(/^\/wiki\/items\/[a-z0-9-]+(?:--[a-z0-9-]+)*$/);

      const html = renderToStaticMarkup(CraftingGrid({ recipe }));
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(`alt="${name}"`);
    },
  );

  it("keeps the Raw Tin alias on the existing Tin material page", () => {
    const rawTin = itemRecipes
      .flatMap((recipe) => [...recipe.ingredients, recipe.output])
      .find((slot) => slot.name === "Raw Tin");
    expect(rawTin).toBeDefined();
    expect(getRecipeItemHref(rawTin!)).toBe("/wiki/materials/tin");
  });

  it("keeps vehicle previews on the vehicle catalogue query route", () => {
    const vehicleRecipe = itemRecipes.find(
      (recipe) => getRecipeItemHref(recipe.output)?.startsWith("/wiki/vehicles?"),
    );
    expect(vehicleRecipe).toBeDefined();
    expect(getRecipeItemHref(vehicleRecipe!.output)).toMatch(
      /^\/wiki\/vehicles\?vehicle=[a-z0-9-]+#catalogue$/,
    );
    const html = renderToStaticMarkup(CraftingGrid({ recipe: vehicleRecipe! }));
    expect(html).toContain("/wiki/vehicles?vehicle=");
    expect(html).not.toContain("/wiki/items/");
  });

  it("does not link a plain vanilla item even when its display name is familiar", () => {
    const vanillaRecipe = itemRecipes.find(
      (recipe) => recipe.output.sourceId?.startsWith("vanilla:") && recipe.output.name === "Soul Soil",
    );
    expect(vanillaRecipe).toBeDefined();
    expect(getRecipeItemHref(vanillaRecipe!.output)).toBeUndefined();
    const html = renderToStaticMarkup(CraftingGrid({ recipe: vanillaRecipe! }));
    expect(html).not.toContain("/wiki/items/");
    expect(html).not.toContain("/wiki/materials/");
  });
});

describe("generated item detail routes", () => {
  it("has one static route for every generated item and no duplicate params", () => {
    const params = generateStaticParams();
    expect(params).toHaveLength(itemDetails.length);
    expect(new Set(params.map(({ slug }) => slug)).size).toBe(params.length);
    expect(params.every(({ slug }) => getItemBySlug(slug))).toBe(true);
  });

  it("links station items directly to their station pages", () => {
    expect(getRecipeItemHref(recipeWithOutput("Forging Station").output)).toBe("/wiki/stations/weapon-station");
    expect(getRecipeItemHref(recipeWithOutput("Rune Station").output)).toBe("/wiki/stations/rune-station");
    expect(getItemBySlug("rune-station")).toBeUndefined();
    expect(generateStaticParams()).not.toContainEqual({ slug: "weapon-station" });
  });

  it.each(["abyssalite-pickaxe", "demonwood-log"])(
    "renders real recipe and used-in sections for %s",
    async (slug) => {
      const item = getItemBySlug(slug);
      expect(item).toBeDefined();
      const html = renderToStaticMarkup(
        await ItemDetailPage({ params: Promise.resolve({ slug }) }),
      );
      expect(html).toContain(`<h1`);
      expect(html).toContain(item!.name);
      expect(html).toContain("How to craft");
      expect(html).toContain("What can be crafted from it");
      expect(html).toContain(item!.recipes[0]?.title ?? item!.usedIn[0]?.title);
    },
  );
});
