import type { WikiCommandSet, WikiSection } from "./types";

/** FarmingUpgrade has no player commands. It is purely passive vanilla-crop mechanics. */
export const harvestingCommands: WikiCommandSet = {
  system: "FarmingUpgrade",
  href: "/wiki/harvesting",
  commands: [],
};

export const harvestingSection: WikiSection = {
  nav: {
    href: "/wiki/harvesting",
    label: "Crop Harvesting",
    category: "gathering",
    blurb: "Hoe-based area harvesting and auto-replanting for vanilla wheat, potato and carrot.",
  },
  commands: harvestingCommands,
};
