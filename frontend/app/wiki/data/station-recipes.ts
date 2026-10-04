import { generatedStationRecipes } from "./generated/stationRecipes";
import type { Recipe, Slot } from "./types";

// ---------- Server crafting-station recipes ----------

/**
 * Player-facing notes preserved from the hand-written recipes that the server
 * YAML superseded. The YAML is authoritative for the recipe *data*; these are
 * prose the config cannot carry, so they are re-attached by recipe key.
 */
const CURATED_NOTES: Record<string, string> = {
  "gen-instrument-station-flute": "Shift: higher octave.",
  "gen-instrument-station-lute": "Shift: chords.",
  "gen-instrument-station-vielle": "Shift: chords.",
  "gen-instrument-station-trumpet": "Shift: higher octave.",
  "gen-instrument-station-celtic-harp": "Shift: chords.",
  "gen-instrument-station-kalimba": "Shift: chords.",
  "gen-instrument-station-dulcimer": "Shift: chords.",
  "gen-instrument-station-accordion": "Shift: chords.",
  "gen-instrument-station-bagpipe": "Shift: higher octave (same scale, one octave up).",
  "gen-engineer-station-fuel": "Yields 16 fuel per craft.",
  "gen-engineer-station-geiger_counter":
    "The same recipe recharges a dead detector: no need to re-craft the base item.",
};

const furnitureModel = (id: string, texture = id) => ({
  url: `/wiki/models/furniture/${id}.json`,
  texture: `/wiki/textures/furniture/${texture}.png`,
});

/**
 * ItemsAdder furniture has no flat inventory sprite, so the generator can only give it the
 * PAPER base item. These outputs get their 3D model instead, keyed by source id. Several
 * cookware pieces share one texture sheet, as in the furniture gallery.
 */
const FURNITURE_MODELS: Record<string, NonNullable<Slot["model"]>> = {
  "itemsadder:frying_pan": furnitureModel("frying_pan"),
  "itemsadder:saucepan": furnitureModel("saucepan", "frying_pan"),
  "itemsadder:pot": furnitureModel("pot"),
  "itemsadder:bread_tray": furnitureModel("bread_tray", "tray"),
  "itemsadder:oven_bottom": furnitureModel("oven_bottom", "oven"),
  "itemsadder:oven_top": furnitureModel("oven_top", "oven"),
  "itemsadder:fire_pit": furnitureModel("fire_pit"),
  "itemsadder:mixing_bowl": furnitureModel("mixing_bowl", "plate"),
  "itemsadder:cutting_board": furnitureModel("cutting_board"),
  "itemsadder:butter_churn": furnitureModel("butter_churn"),
  "itemsadder:butter_plate": furnitureModel("butter_plate", "plate"),
  "itemsadder:plate": furnitureModel("plate"),
  "itemsadder:bowl": furnitureModel("bowl", "plate"),
  "itemsadder:tool_shelf": furnitureModel("tool_shelf"),
  "itemsadder:trough": furnitureModel("trough"),
  "itemsadder:meat_hook": furnitureModel("meat_hook"),
  "itemsadder:sausage_maker": furnitureModel("sausage_maker"),
  "itemsadder:liquid_container": furnitureModel("liquid_container"),
  "itemsadder:milling_stone": furnitureModel("milling_stone"),
  "itemsadder:pedestal": furnitureModel("pedestal"),
  "itemsadder:artifact_display": furnitureModel("artifact_display"),
  "itemsadder:lure": furnitureModel("lure"),
  "itemsadder:voting_booth": furnitureModel("voting_booth"),
  "itemsadder:marauder_coins": furnitureModel("marauder_coins", "marauder/marauder_coins"),
  "itemsadder:marauder_coins_small": furnitureModel("marauder_coins_small", "marauder/marauder_coins_small"),
  "itemsadder:marauder_goldbars": furnitureModel("marauder_goldbars", "marauder/marauder_goldbars"),
  "itemsadder:marauder_goldbag": furnitureModel("marauder_goldbag", "marauder/marauder_goldbag"),
  "itemsadder:archeology_cabinet": { url: "/wiki/models/archeology-cabinet.json", texture: "/wiki/textures/stations/archeology-cabinet.png" },
};

/**
 * Doctor's gear has no pack sprite. The mask is a PLAYER_HEAD wearing the skull texture from
 * MMOItems/item/armors.yml, so it gets a head model built from that skin; the rest is leather
 * armour dyed 23 23 23, so it gets the vanilla sprite re-tinted to that dye.
 */
const DOCTORS_GEAR: Record<string, Partial<Slot>> = {
  "mmoitem:ARMORS:DOCTORS_MASK": { model: { url: "/wiki/models/doctors-mask.json", texture: "/wiki/textures/doctors-gear/doctors_mask_skin.png" } },
  "mmoitem:ARMORS:DOCTORS_COAT": { texture: "/wiki/textures/doctors-gear/doctors_chestplate.png" },
  "mmoitem:ARMORS:DOCTORS_LEGGINGS": { texture: "/wiki/textures/doctors-gear/doctors_leggings.png" },
  "mmoitem:ARMORS:DOCTORS_BOOTS": { texture: "/wiki/textures/doctors-gear/doctors_boots.png" },
};

const withFurnitureModel = (slot: Slot): Slot => {
  if (slot?.sourceId && DOCTORS_GEAR[slot.sourceId]) return { ...slot, ...DOCTORS_GEAR[slot.sourceId] };
  const model = slot?.sourceId ? FURNITURE_MODELS[slot.sourceId] : undefined;
  return model && !slot.model ? { ...slot, model } : slot;
};

/**
 * Every recipe read off the server's crafting-station configs, with curated
 * notes applied. This is THE list of station recipes: pages that used to keep
 * their own hand-written copies now select out of this array by key, so a
 * recipe can never be documented twice with two different sets of ingredients.
 */
export const stationRecipes: Recipe[] = generatedStationRecipes.map((recipe) => ({
  ...recipe,
  ...(CURATED_NOTES[recipe.key] ? { note: CURATED_NOTES[recipe.key] } : {}),
  ingredients: recipe.ingredients.map(withFurnitureModel),
  output: withFurnitureModel(recipe.output),
}));

const byKey = new Map(stationRecipes.map((r) => [r.key, r]));

/**
 * Looks a generated recipe up by key, throwing if it is gone. A page that
 * names a recipe that the server config no longer contains is a build failure,
 * not a silently missing card.
 */
export function stationRecipe(key: string): Recipe {
  const recipe = byKey.get(key);
  if (!recipe) {
    throw new Error(
      `No generated station recipe "${key}". Re-run scripts/build-station-recipes.mjs, ` +
        "or update the caller if the server config dropped it."
    );
  }
  return recipe;
}
