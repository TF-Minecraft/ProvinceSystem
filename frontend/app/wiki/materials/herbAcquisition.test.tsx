import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { collectorHerbMaterials } from "../data/herb-acquisition";
import { getMaterialBySlug } from "../data";
import MaterialDetailPage from "./[slug]/page";

const expectedNames = [
  "Dying Leaf", "Birch Seed", "Autumn Leaf", "Spot Leaf", "Fire Leaf", "Long Leaf",
  "Dwindle Leaf", "Burrow Root", "Thorn Root", "Clover", "Pumpkin Spore", "Kelpberry",
];

describe("Alchemist Collector herb acquisition", () => {
  it("covers every active herb output with generic collector acquisition", () => {
    expect(collectorHerbMaterials.map((herb) => herb.name)).toEqual(expectedNames);

    for (const herb of collectorHerbMaterials) {
      const source = herb.acquisition?.[0];
      expect(herb.acquisition).toHaveLength(1);
      expect(source?.detail).toBe("Gather this herb with an Alchemist Collector.");
      expect(source?.detail).not.toMatch(/break|leaves|logs|grass|pumpkin|kelp/i);
    }
  });

  it("registers the four collector herbs that were missing from the material catalogue", () => {
    for (const slug of ["birch-seed", "dwindle-leaf", "pumpkin-spore", "kelpberry"]) {
      expect(getMaterialBySlug(slug)?.acquisition).toHaveLength(1);
    }
  });

  it("gives every other herb the same generic collector source", () => {
    for (const slug of [
      "nightshade", "grapeberries", "arcane-leaf", "fiery-fruit", "barkshroom",
      "caveshroom", "flatshroom", "death-fruit", "blazed-root", "serpent-root",
    ]) {
      expect(getMaterialBySlug(slug)?.acquisition).toEqual(collectorHerbMaterials[0].acquisition);
    }
  });

  it("renders a generic Dying Leaf source without hidden acquisition details", async () => {
    const html = renderToStaticMarkup(
      await MaterialDetailPage({ params: Promise.resolve({ slug: "dying-leaf" }) }),
    );

    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("Harvest with an Alchemist Collector");
    expect(text).toContain("Gather this herb with an Alchemist Collector.");
    // Whole words only: "used in" recipes legitimately name co-ingredients such as Kelpberry.
    expect(html).not.toMatch(/\b(break|leaves|logs|grass|pumpkin|kelp)\b/i);
    expect(html).not.toContain("Chance:");
    expect(html).not.toContain("Acquisition details have not yet been verified");
  });
});
