import { stationRecipe } from "./station-recipes";
import type { Recipe, WikiCommandSet, WikiSection } from "./types";

export const rodRecipes: Recipe[] = ["fishing-rod", "steel-rod", "abyssalite-rod", "mythril-rod"].map(key => stationRecipe(`gen-fishing-station-${key}`));

export const fishingCommands: WikiCommandSet = {
  system: "Fishing",
  href: "/wiki/fishing",
  commands: [],
  excludedStaffCommands: [
    "/customfishing reload",
    "/customfishing items get",
    "/customfishing items give",
    "/customfishing items give-by-uuid",
    "/customfishing items import",
    "/customfishing competition start",
    "/customfishing competition stop",
    "/customfishing competition end",
    "/customfishing open market",
    "/customfishing open bag",
    "/customfishing fishingbag edit-online",
    "/customfishing fishingbag edit-offline",
    "/customfishing data unlock",
    "/customfishing data export",
    "/customfishing data import",
    "/customfishing statistics set",
    "/customfishing statistics reset",
    "/customfishing statistics query",
    "/customfishing statistics add",
    "/customfishing debug loot",
    "/customfishing debug biome",
    "/customfishing debug snbt",
  ],
};

export const fishingSection: WikiSection = {
  nav: {
    href: "/wiki/fishing",
    label: "Fishing",
    category: "gathering",
    blurb: "Rod tiers, bait, hooks and a bite-timing minigame: then sell the catch.",
  },
  commands: fishingCommands,
};
