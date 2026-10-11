import type { WikiCommandSet, WikiSection } from "./types";

/**
 * Cooking (drefvelin/cooking) has no in-game player commands at all: every
 * interaction is right-clicking furniture. Recorded as an empty array per the
 * README rule: "no commands" is a fact, not an omission.
 */
export const cookingCommands: WikiCommandSet = {
  system: "Cooking",
  href: "/wiki/cooking",
  commands: [],
};

export const cookingSection: WikiSection = {
  nav: {
    href: "/wiki/cooking",
    label: "Cooking",
    category: "food",
    blurb: "Furniture cooking: pans, pots, ovens and a 1–5 star quality system.",
  },
  commands: cookingCommands,
};
