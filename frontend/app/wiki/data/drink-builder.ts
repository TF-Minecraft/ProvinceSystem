import type { WikiCommandSet, WikiSection } from "./types";

/** DrinkBuilder has no in-game commands: drinks are designed on the website. */
export const drinkBuilderCommands: WikiCommandSet = {
  system: "Drink Builder",
  href: "/wiki/drink-builder",
  commands: [],
  excludedStaffCommands: [
    "/drinkbuilder reload",
    "/drinkbuilder catalog sync",
    "/drinkbuilder pack pull [force]",
    "/drinkbuilder pack reapply <id>",
    "/drinkbuilder drink delete <id>",
  ],
};

export const drinkBuilderSection: WikiSection = {
  nav: {
    href: "/wiki/drink-builder",
    label: "Drink Builder",
    category: "food",
    blurb: "Design your own donator drink on the website; it brews like any server recipe.",
  },
  commands: drinkBuilderCommands,
};
