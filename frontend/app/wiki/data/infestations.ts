import type { WikiCommandSet, WikiSection } from "./types";

/**
 * No player commands exist. infestations-0.1.0.jar declares exactly one
 * command, `/infestation` (alias `/infestations`), and it is
 * `infestations.admin`/op-only end to end: there is nothing here for a player
 * to type.
 */
export const infestationsCommands: WikiCommandSet = {
  system: "Infestations",
  href: "/wiki/infestations",
  commands: [],
  excludedStaffCommands: [
    "/infestation reload",
    "/infestation set",
    "/infestation clear",
    "/infestation list",
  ],
};

export const infestationsSection: WikiSection = {
  nav: {
    href: "/wiki/infestations",
    label: "Infestations",
    category: "combat",
    blurb: "Swamp provinces overrun by Bog Monsters: fight the ambient spawns or clear the whole thing with a Lure.",
  },
  commands: infestationsCommands,
};
