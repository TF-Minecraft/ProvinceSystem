import { M, T, V, empty } from "./helpers";
import type { Recipe, WikiCommandSet, WikiSection } from "./types";

// ---------- Recycler ----------

export const recyclingStationRecipe: Recipe = {
  key: "craft-recycling-station",
  title: "Recycling Station",
  station: "Crafting Table",
  requirement: "None",
  ingredients: [
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    empty,
    empty,
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
  ],
  output: {
    name: "Recycling Station",
    qty: 1,
    sourceId: "itemsadder:recycling_station",
    model: {
      url: M("recycling-station.json"),
      texture: T("stations/recycling-station.png"),
    },
  },
};

export const recyclerRecipes: Recipe[] = [recyclingStationRecipe];

export const recyclerCommands: WikiCommandSet = {
  system: "Recycler",
  href: "/wiki/recycler",
  commands: [],
};

export const recyclerSection: WikiSection = {
  nav: {
    href: "/wiki/recycler",
    label: "Recycler",
    category: "professions",
    blurb: "Break a crafted item back down into a share of the materials that made it.",
  },
  recipes: recyclerRecipes,
  commands: recyclerCommands,
};
