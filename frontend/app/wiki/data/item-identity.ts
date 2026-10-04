import { generatedStationRecipes } from "./generated/stationRecipes";
import { dropOnlyMaterials, materialRecipes, serverCraftedMaterials } from "./materials";
import type { Slot } from "./types";

const byName = new Map<string, Set<string>>();
for (const recipe of generatedStationRecipes) {
  for (const slot of [...recipe.ingredients, recipe.output]) {
    if (!slot.sourceId) continue;
    const ids = byName.get(slot.name) ?? new Set<string>();
    ids.add(slot.sourceId);
    byName.set(slot.name, ids);
  }
}

/** Hand-authored material records are curated custom-item provenance. */
const materialNames = new Set([
  ...materialRecipes.map(recipe => recipe.output.name),
  ...serverCraftedMaterials.map(item => item.name),
  ...dropOnlyMaterials.map(item => item.name),
]);

// These objects are defined by the corresponding hand-authored station recipes.
const recipeObjects: Record<string, string> = {
  "Forging Station": "itemsadder:weapon_station",
  "Weapon Station": "itemsadder:weapon_station",
  "Ingredient Converter": "itemsadder:ingredient_converter",
  "Alloy Forge": "itemsadder:alloy_forge",
  "Magic Station": "itemsadder:magic_crafting_station",
  "Recycling Station": "itemsadder:recycling_station",
  "Archeology Table": "itemsadder:archeology_station",
  "Market Block": "tfmc:market_block",
  "Engineering Table": "itemsadder:engineering_table",
  "Dockyard": "itemsadder:dockyard",
  "Letter": "tfmc:letter",
};

/** Explicit vanilla provenance always wins, even when a custom item shares its name. */
export function itemIdentity(slot: Pick<Slot, "name" | "sourceId">): string | undefined {
  if (slot.sourceId) return slot.sourceId;
  const ids = byName.get(slot.name);
  if (ids?.size === 1) return [...ids][0];
  if (ids?.size) return undefined; // Ambiguous item names require explicit provenance.
  if (recipeObjects[slot.name]) return recipeObjects[slot.name];
  if (materialNames.has(slot.name)) return `material:${slot.name}`;
  return undefined;
}

export function customItemIdentity(slot: Pick<Slot, "name" | "sourceId">): string | undefined {
  const identity = itemIdentity(slot);
  return identity && !identity.startsWith("vanilla:") ? identity : undefined;
}
