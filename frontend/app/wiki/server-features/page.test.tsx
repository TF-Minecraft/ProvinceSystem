// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { allRecipes } from "../data";
import { stationRecipe } from "../data/station-recipes";
import ItemDetailPage from "../items/[slug]/page";
import ServerFeaturesPage from "./page";

const recipes = [stationRecipe("gen-tool-station-lorestone"), stationRecipe("gen-tool-station-namestone")];

describe("Lorestone and Namestone guide", () => {
  it("uses the two source-generated Tool Station recipes exactly once", () => {
    expect(
      recipes.map((recipe) => ({
        key: recipe.key,
        station: recipe.station,
        time: recipe.time,
        ingredient: recipe.ingredients[0]?.sourceId,
        ingredientQty: recipe.ingredients[0]?.qty,
        output: recipe.output.sourceId,
        outputQty: recipe.output.qty,
      })),
    ).toEqual([
      {
        key: "gen-tool-station-lorestone",
        station: "Tool Station",
        time: 5,
        ingredient: "vanilla:gold_ingot",
        ingredientQty: 1,
        output: "mmoitem:UTILS:LORESTONE",
        outputQty: 1,
      },
      {
        key: "gen-tool-station-namestone",
        station: "Tool Station",
        time: 5,
        ingredient: "vanilla:iron_ingot",
        ingredientQty: 1,
        output: "mmoitem:UTILS:NAMESTONE",
        outputQty: 1,
      },
    ]);
    for (const recipe of recipes) {
      expect(allRecipes.filter((candidate) => candidate.key === recipe.key)).toHaveLength(1);
    }
  });

  it("shows both recipes and canonical links in the Server Features guide", () => {
    const html = renderToStaticMarkup(<ServerFeaturesPage />);
    expect(html).toContain('href="/wiki/stations/tool-station"');
    expect(html).toContain('href="/wiki/items/lorestone"');
    expect(html).toContain('href="/wiki/items/namestone"');
    expect(html).not.toContain("Hold Shift and right-click a crafting table to craft lore stones");
  });

  it.each(["lorestone", "namestone"])("shows the acquisition recipe on /wiki/items/%s", async (slug) => {
    const page = await ItemDetailPage({ params: Promise.resolve({ slug }) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("How to craft");
    expect(html).toContain('href="/wiki/stations/tool-station"');
  });
});
