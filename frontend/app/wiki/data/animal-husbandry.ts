import type { WikiCommandSet, WikiSection } from "./types";

export const animalHusbandryCommands: WikiCommandSet = {
  system: "Animal Husbandry",
  href: "/wiki/animal-husbandry",
  commands: [
    {
      command: "/animals",
      aliases: ["/livestock"],
      description:
        "Lists every animal you own or share, with the last place each one was seen.",
      notes:
        "Each line shows the name, the kind of animal, whether it is growing, and whether it is happy, hungry, or dirty. Click the coordinates in chat to copy them. If a place is missing, visit that animal once so it can be recorded.",
    },
  ],
  excludedStaffCommands: ["/animals <player>"],
};

export const animalHusbandrySection: WikiSection = {
  nav: {
    href: "/wiki/animal-husbandry",
    label: "Animal Husbandry",
    category: "food",
    blurb: "Claim animals, keep them fed and clean, and breed for better food and materials.",
  },
  commands: animalHusbandryCommands,
};
