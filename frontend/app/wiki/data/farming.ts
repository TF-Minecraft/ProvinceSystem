import type { WikiCommandSet, WikiSection } from "./types";

/** CustomCrops has no player commands; every command in commands.yml carries an admin node. */
export const farmingCommands: WikiCommandSet = {
  system: "Farming",
  href: "/wiki/farming",
  commands: [],
};

export const farmingSection: WikiSection = {
  nav: {
    href: "/wiki/farming",
    label: "Farming",
    category: "gathering",
    blurb: "Watered pots, 30 custom crops, sprinklers and fertilisers: plant, water, harvest.",
  },
  commands: farmingCommands,
};
