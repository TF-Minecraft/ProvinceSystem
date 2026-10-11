import { stationRecipe } from "./station-recipes";
import type { Recipe, WikiCommandSet, WikiSection } from "./types";

export const rodRecipes: Recipe[] = ["fishing-rod", "steel-rod", "abyssalite-rod", "mythril-rod"].map((key) =>
  stationRecipe(`gen-fishing-station-${key}`),
);

export const fishingCommands: WikiCommandSet = {
  system: "Fishing",
  href: "/wiki/fishing",
  commands: [],
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
