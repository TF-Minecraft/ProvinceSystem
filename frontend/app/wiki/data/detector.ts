import { stationRecipe } from "./station-recipes";
import type { Recipe, WikiCommandSet, WikiSection } from "./types";

// ---------- Arcane Trace Detector ("Geiger Counter") ----------

/** Engineer Station recipes, registered once by `stationsSection`. */
export const detectorRecipes: Recipe[] = [
  stationRecipe("gen-engineer-station-dead_geiger_counter"),
  stationRecipe("gen-engineer-station-fuel"),
  stationRecipe("gen-engineer-station-geiger_counter"),
];

export const signalTable = [
  { signal: "1 ring", meaning: "Over 1000 blocks away." },
  { signal: "2 rings", meaning: "Within 1000 blocks." },
  { signal: "3 rings", meaning: "Within 300 blocks." },
  { signal: "Very dark purple, almost black", meaning: "Near the far edge of range (~2500 blocks)." },
  { signal: "Bright purple", meaning: "~200 blocks out." },
  { signal: "Turning white", meaning: "Under 200 blocks: the whiter, the closer." },
  { signal: "Slow clicking (~1 every 2s)", meaning: "Outer limit of the signal." },
  { signal: "Rapid clicking (a stream)", meaning: "Almost at the source." },
];

/** geiger_counter 1.1.2 exposes only an op-default admin command. */
export const detectorCommands: WikiCommandSet = {
  system: "Arcane Trace Detector",
  href: "/wiki/arcane-trace-detector",
  commands: [],
  excludedStaffCommands: ["/geiger <locate|move|limits|resetlimits|droplist|reload>"],
};

export const detectorSection: WikiSection = {
  nav: {
    href: "/wiki/arcane-trace-detector",
    label: "Arcane Trace Detector",
    category: "magic",
    blurb:
      "Hunt the server's single hidden source of Arcane Radiation with a clicking, glowing detector. A serverwide loot race.",
  },
  // `detectorRecipes` are server recipes registered by `stationsSection`; listing
  // them again here would put them in the recipe index twice.
  commands: detectorCommands,
};
