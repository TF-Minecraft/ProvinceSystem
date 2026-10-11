import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { iconTranslation, recipeIconTransform } from "./recipeIconAlignment";
import RecipeItemIcon from "./RecipeItemIcon";
import CraftingGrid from "./CraftingGrid";
import { materialRecipes } from "../../wiki/data/materials";

describe("visible recipe sprite alignment", () => {
  it("corrects the measured Steel Magical Core padding without changing its size", () => {
    expect(recipeIconTransform("/wiki/textures/magic_crafting/basic_magical_core.png")).toBe(
      "translate(-3.125%, 3.125%)",
    );
    const [x, y] = iconTranslation([16, 16, 3, 2, 14, 13]);
    expect((3 + 14) / 2 + (x * 16) / 100).toBe(8);
    expect((2 + 13) / 2 + (y * 16) / 100).toBe(8);
  });

  it("preserves already centred sprites and handles non-square canvases at contain scale", () => {
    expect(iconTranslation([16, 16, 2, 2, 14, 14])).toEqual([0, 0]);
    expect(iconTranslation([16, 32, 4, 4, 14, 24])).toEqual([-3.125, 6.25]);
    expect(recipeIconTransform("/unknown.png")).toBeUndefined();
  });

  it("keeps hover scale on a separate wrapper so it cannot override the centering correction", () => {
    const html = renderToStaticMarkup(
      RecipeItemIcon({
        src: "/wiki/textures/magic_crafting/basic_magical_core.png",
        alt: "Steel Magical Core",
        enlarge: true,
      }),
    );
    expect(html).toContain("group-hover:scale-125");
    expect(html).toContain("object-contain");
    expect(html).toContain("transform:translate(-3.125%, 3.125%)");
    expect(html).toContain('alt="Steel Magical Core"');
    expect(html.match(/<img[^>]*group-hover/) ?? []).toHaveLength(0);
  });

  it("applies visible-pixel centering to the actual Steel Magical Core recipe output", () => {
    const recipe = materialRecipes.find((candidate) => candidate.output.name === "Steel Magical Core")!;
    const html = renderToStaticMarkup(CraftingGrid({ recipe }));
    expect(html).toMatch(/<img[^>]*alt="Steel Magical Core"[^>]*style="transform:translate\(-3\.125%, 3\.125%\)"/);
    expect(html).toContain("grid grid-cols-3 gap-1");
  });
});
