import type { WikiCommandSet, WikiSection } from "./types";

/**
 * BreweryX (base command /breweryx, aliases /brewery and /brew). The
 * `brewery.user` permission group is `default: true`, so every player has its
 * children. The public guide lists the player-facing help and info commands.
 */
export const brewingCommands: WikiCommandSet = {
  system: "BreweryX",
  href: "/wiki/brewing",
  commands: [
    {
      command: "/brew help [page]",
      aliases: ["/brewery help", "/breweryx help"],
      description: "Shows the paged command list.",
      notes: "Available to every player.",
    },
    {
      command: "/brew info",
      aliases: ["/brewery info", "/breweryx info"],
      description: "Shows your current drunkenness percentage and quality.",
      access: "player",
    },
  ],
};

export const brewingSection: WikiSection = {
  nav: {
    href: "/wiki/brewing",
    label: "Brewing",
    category: "food",
    blurb: "Ferment, distil and barrel-age real alcohol: with drunkenness that shows.",
  },
  commands: brewingCommands,
};
