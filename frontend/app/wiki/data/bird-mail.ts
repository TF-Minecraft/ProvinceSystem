import type { WikiCommandSet, WikiSection } from "./types";

// ---------- BirdMessenger ----------

export const birdMailCommands: WikiCommandSet = {
  system: "BirdMessenger",
  href: "/wiki/bird-mail",
  commands: [],
};

export const birdMailSection: WikiSection = {
  nav: {
    href: "/wiki/bird-mail",
    label: "Bird Mail",
    category: "character",
    blurb: "Send a Letter to another character's bird coop and wait for it to arrive.",
  },
  commands: birdMailCommands,
};
