import { slugify } from "./helpers";
import { dropOnlyMaterials, materialRecipes, serverCraftedMaterials } from "./materials";
import { allRecipes } from "./registry";
import { customItemIdentity } from "./item-identity";
import type { MaterialCatalogEntry, Recipe } from "./types";

// ---------- Material catalogue (for cross-linking + detail pages) ----------

export function getRecipesForStation(name: string): Recipe[] {
  return allRecipes.filter((r) => r.station === name);
}

function buildMaterialCatalog(): Map<string, MaterialCatalogEntry> {
  const map = new Map<string, MaterialCatalogEntry>();

  for (const r of materialRecipes) {
    map.set(r.output.name, {
      slug: slugify(r.output.name),
      name: r.output.name,
      texture: r.output.texture,
      recipe: r,
      recipes: [],
      unpackingRecipes: [],
      usedIn: [],
    });
  }
  for (const m of [...serverCraftedMaterials, ...dropOnlyMaterials]) {
    if (!map.has(m.name)) {
      map.set(m.name, {
        slug: slugify(m.name),
        name: m.name,
        texture: m.texture,
        lore: m.lore,
        recipes: [],
        acquisition: m.acquisition,
        unpackingRecipes: allRecipes.filter((r) => m.unpackingRecipeKeys?.includes(r.key)),
        usedIn: [],
      });
    } else {
      const entry = map.get(m.name)!;
      entry.lore = entry.lore ?? m.lore;
    }
  }

  // A material listed without a hand-written recipe still has one if some
  // registered recipe produces it: the server-generated station recipes are
  // where most material recipes now live.
  for (const entry of map.values()) {
    const identity = customItemIdentity(entry);
    entry.recipes = identity
      ? allRecipes.filter(
          (r) =>
            customItemIdentity(r.output) === identity &&
            !entry.unpackingRecipes.some((unpacking) => unpacking.key === r.key),
        )
      : [];
    if (!entry.recipe) entry.recipe = entry.recipes[0];
  }

  for (const r of allRecipes) {
    for (const ing of r.ingredients) {
      const identity = customItemIdentity(ing);
      const entry = identity
        ? [...map.values()].find((material) => customItemIdentity(material) === identity)
        : undefined;
      if (entry && !entry.usedIn.some((recipe) => recipe.key === r.key)) {
        entry.usedIn.push(r);
      }
    }
  }

  return map;
}

export const materialCatalog = buildMaterialCatalog();

export const materialUnpackingRecipeKeys = new Set(
  [...materialCatalog.values()].flatMap((m) => m.unpackingRecipes.map((r) => r.key)),
);

/** Names in the catalogue, for CraftingGrid to decide which slots become clickable material links. */
export const catalogNames = new Set(materialCatalog.keys());

export function getMaterialBySlug(slug: string): MaterialCatalogEntry | undefined {
  for (const entry of materialCatalog.values()) {
    if (entry.slug === slug) return entry;
  }
  return undefined;
}
