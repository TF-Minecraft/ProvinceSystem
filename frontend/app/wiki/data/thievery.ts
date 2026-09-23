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

export type ThieveryNumber = { label: string; value: string; note?: string };

/** The numbers a player is most likely to run into, from config.yml. */
export const thieveryNumbers: ThieveryNumber[] = [
  { label: "Interact cooldown", value: "3 seconds" },
  { label: "Door lockpick max distance", value: "3 blocks" },
  { label: "Max success chance (any pick)", value: "95%" },
  { label: "Failed-pick cooldown", value: "60 seconds" },
  { label: "Door unlock window after a successful pick", value: "60 minutes", note: "opens for anyone during this window" },
  { label: "Minimum lockpick-to-lock strength ratio", value: "0.5", note: "a lock more than twice your pick's strength is impossible" },
  { label: "Lockpick penalty cap", value: "up to 50% reduction" },
  { label: "Chest probing", value: "100% base success", note: "+10% break chance per slot probed" },
  { label: "Display furniture lock strength", value: "fixed 0.5" },
  { label: "Loadout points", value: "30 held", note: "+24 per gain interval" },
  { label: "Pickpocket budget / cooldown / range", value: "10 points / 1 hour / 4 blocks" },
  { label: "Robbery budget / cooldown / duration / range", value: "30 points / 3 days / 120 s / 4 blocks" },
  { label: "Robbery accept timeout", value: "30 seconds" },
  { label: "Robbery pouch click / shift-click", value: "10 / 100 denar" },
  { label: "Grave steal budget", value: "10 points" },
  { label: "Key-to-paper copy cooldown", value: "240 minutes (4 hours)", note: "per player, per key" },
  { label: "Keychain capacity", value: "5 keys" },
];

export const thieveryCommands: CommandRow[] = [
  {
    command: "/thievery",
    description: "Lists the player subcommands (loadout, clearclues).",
    notes: "Use the subcommands below to manage your loadout and activities.",
  },
  {
    command: "/thievery loadout",
    description: "Opens the 30-point steal-category loadout GUI.",
    notes: 'Requires the "thief" character trait, else you are told you lack the needed trait(s).',
  },
  {
    command: "/thievery clearclues",
    description: "Arms a right-click to wipe clues from one door or container.",
    notes: "No permission check exists in the code for this command.",
  },
  { command: "/pickpocket", description: "Shows pickpocket usage." },
  {
    command: "/pickpocket start",
    description: "Arms a right-click to pickpocket a player within 4 blocks.",
    notes: 'Requires the "thief" trait.',
  },
  { command: "/robbery", description: "Shows robbery usage." },
  {
    command: "/robbery start",
    description: "Arms a right-click to demand a robbery from a player within 4 blocks.",
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
    draft: true,
  },
  commands: thieveryCommandSet,
};
