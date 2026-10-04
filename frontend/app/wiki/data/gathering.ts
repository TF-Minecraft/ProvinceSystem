import type { WikiCommandSet, WikiSection } from "./types";

// ---------- Gathering ----------
//
// Gathering has no crafting-table recipe of its own: spots spawn in the
// world automatically, there is nothing to build. No `recipes` export here.

export const gatheringCommands: WikiCommandSet = {
  system: "Gathering",
  href: "/wiki/gathering",
  commands: [],
  excludedStaffCommands: [
    "/gathering reload",
    "/gathering clearcache [world]",
    "/gathering status",
    "/gathering forcespawn <spotType> [chunkX chunkZ]",
    "/gathering adminmode <on|off>",
  ],
};

export const gatheringSection: WikiSection = {
  nav: {
    href: "/wiki/gathering",
    label: "Gathering",
    category: "professions",
    blurb: "Hidden herb spots in the wild: walk close, notice them, right-click to harvest.",
  },
  commands: gatheringCommands,
};
