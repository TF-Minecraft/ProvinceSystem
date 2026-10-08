import type { CommandRow, WikiCommandSet, WikiSection } from "./types";

// ---------- Thievery ----------
//
// Sourced from https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/docs/wiki-research/e-adventure.md, "Thievery" section.
// Jar: thievery-1.0.0.jar. No `permissions:` block exists in plugin.yml, so
// every command below is open to a normal player except where noted.

export type ThieveryKeyCopy = { pickUp: string; clickOnto: string; result: string; message: string };

/** Dragging one item onto another in your own inventory copies a key. */
export const thieveryKeyCopies: ThieveryKeyCopy[] = [
  { pickUp: "Clay Ball", clickOnto: "a master key", result: "Key Mold", message: "Key mold created." },
  { pickUp: "Copper Ingot", clickOnto: "a key mold", result: "Copper Key (permanent)", message: "Key copy created." },
  { pickUp: "Paper", clickOnto: "a master key or copper copy", result: "Paper Key (single-use, doors only)", message: "Paper key created." },
];

export const thieveryCommands: CommandRow[] = [
  {
    command: "/thievery",
    description: "Lists the player subcommands (loadout, clearclues).",
    notes: "Use the subcommands below to manage your loadout and activities.",
  },
  {
    command: "/thievery loadout",
    description: "Choose what you can steal.",
    notes: 'Requires the "thief" character trait, else you are told you lack the needed trait(s).',
  },
  {
    command: "/thievery clearclues",
    description: "Then right-click to wipe clues from one door or container.",
  },
  { command: "/pickpocket", description: "Shows pickpocket usage." },
  {
    command: "/pickpocket start",
    description: "Then right-click to pickpocket a player within 4 blocks.",
    notes: 'Requires the "thief" trait.',
  },
  { command: "/robbery", description: "Shows robbery usage." },
  {
    command: "/robbery start",
    description: "Then right-click to demand a robbery from a player within 4 blocks.",
    notes: 'Requires the "bandit" trait.',
  },
  {
    command: "/robbery accept",
    description: "Accepts a robbery demand aimed at you.",
    notes: "No trait or permission needed: any player can accept.",
  },
];

/**
 * Every player command Thievery registers, per its plugin.yml (no
 * `permissions:` block exists, so everything below is open to a normal
 * player at the command level: several subcommands additionally require a
 * character trait, noted per row).
 */
export const thieveryCommandSet: WikiCommandSet = {
  system: "Thievery",
  href: "/wiki/thievery",
  commands: thieveryCommands,
  excludedStaffCommands: [
    "/thievery reload",
    "/thievery resetcooldowns <player|all>",
    "/thievery setrisk <player|all> <0.0-1.0>",
    "/thievery itemvalue",
    "/thievery keychain",
    "/thievery feedback",
  ],
};

export const thieverySection: WikiSection = {
  nav: {
    href: "/wiki/thievery",
    label: "Thievery",
    category: "combat",
    blurb: "Lock your doors and chests, or break into someone else's: lockpicking, pickpocketing, and consensual robbery.",
  },
  commands: thieveryCommandSet,
};
