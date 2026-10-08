import type { WikiCommandSet, WikiSection } from "./types";

// ---------- GSit ----------

export const sittingCommands: WikiCommandSet = {
  system: "Sitting, Crawling & Posing",
  href: "/wiki/sitting",
  commands: [
    {
      command: "/sit",
      description: "Sit down where you're standing.",
    },
    {
      command: "/sit toggle",
      description: "Turns your click-to-sit (right-clicking stairs/slabs/carpets) on or off.",
      notes: "On by default.",
    },
    {
      command: "/lay",
      aliases: ["/glay"],
      description: "Lie down on your back.",
    },
    {
      command: "/layback",
      aliases: ["/glayback"],
      description: "A lie-back pose.",
    },
    {
      command: "/bellyflop",
      aliases: ["/gbellyflop"],
      description: "A bellyflop pose.",
    },
    {
      command: "/spin",
      aliases: ["/gspin"],
      description: "A spinning pose.",
    },
    {
      command: "/crawl",
      aliases: ["/gcrawl"],
      description: "Drop to a prone, crawling position.",
      notes: "Double-tapping sneak to crawl is turned off here, so this command is the only way in.",
    },
  ],
  excludedStaffCommands: ["/gsitreload"],
};

export const sittingSection: WikiSection = {
  nav: {
    href: "/wiki/sitting",
    label: "Sitting, Crawling & Posing",
    category: "character",
    blurb: "Sit on stairs and slabs, crawl, or strike a pose, for roleplay, not for buffs.",
  },
  commands: sittingCommands,
};
