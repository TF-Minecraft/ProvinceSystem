import type { WikiCommandSet, WikiSection } from "./types";
export const codexCommands: WikiCommandSet = {
  system: "Codex",
  href: "/wiki/codex",
  commands: [
    { command: "/codex", description: "Opens the discovery journal." },
    { command: "/codex help", description: "Shows the commands available to you." },
  ],
};
export const codexSection: WikiSection = {
  nav: {
    href: "/wiki/codex",
    label: "Codex",
    category: "magic",
    blurb: "Browse lore, character entries and achievements.",
  },
  commands: codexCommands,
};
