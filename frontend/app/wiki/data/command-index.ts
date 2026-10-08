import type { WikiSection } from "./types";

/**
 * The master command index at `/wiki/commands`.
 *
 * It registers no commands of its own. It *is* the index, built from every
 * other section's `commands`. It still goes through the registry like any other
 * page so it gets its sidebar entry and overview card for free.
 */
export const commandIndexSection: WikiSection = {
  nav: {
    href: "/wiki/commands",
    label: "Command Index",
    category: "reference",
    blurb:
      "Every command a player can type, A–Z, with the page that documents it.",
  },
};
