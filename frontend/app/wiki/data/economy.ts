import type { WikiCommandSet, WikiSection } from "./types";

// ---------- Denar Economy ----------

export type DenarCoin = {
  item: string;
  displayName: string;
  value: number;
  withdrawable: boolean;
};

/** `coins.yml`: every physical coin item and its value in denars. */
export const denarCoins: DenarCoin[] = [
  { item: "Pouch of Gold Denars", displayName: "Pouch of Gold Denars", value: 100, withdrawable: true },
  { item: "Stack of Gold Denars", displayName: "Stack of Gold Denars", value: 10, withdrawable: true },
  { item: "Handful of Gold Denars", displayName: "Handful of Gold Denars", value: 5, withdrawable: true },
  { item: "Gold Denar", displayName: "Gold Denar", value: 1, withdrawable: true },
  { item: "Stack of Silver Denars", displayName: "Stack of Silver Denars", value: 0.1, withdrawable: true },
  { item: "Handful of Silver Denars", displayName: "Handful of Silver Denars", value: 0.05, withdrawable: true },
  { item: "Silver Denar", displayName: "Silver Denar", value: 0.01, withdrawable: true },
  { item: "Gold Ingot", displayName: "Gold Ingot (vanilla)", value: 1, withdrawable: false },
];

/**
 * DenarEconomy 0.1.8 ships with no admin command and no permission node at all :
 * every `/deco` and `/pouch` subcommand is open to every player, and balance
 * manipulation by other plugins goes through the API, not a console command.
 */
export const denarCommands: WikiCommandSet = {
  system: "Denar Economy",
  href: "/wiki/economy",
  commands: [
    {
      command: "/pouch",
      description: "Shows a floating hologram of your pouch balance above your head for 5 seconds.",
      notes: "5-second cooldown between uses.",
    },
    {
      command: "/deco bal",
      description: "Prints both your pouch balance and your bank balance in chat.",
    },
    {
      command: "/deco pay <amount>",
      description: "Drops that amount out of your pouch as physical coin items for someone else to pick up.",
      notes: "Drops the coins at your feet. It does not send them straight to a player.",
    },
    {
      command: "/deco toitem <amount>",
      description: "Converts part of your pouch balance into physical coin items in your inventory, largest denomination first.",
      notes: "Gold Ingots can never be withdrawn this way: only the dedicated coin items.",
    },
    {
      command: "/deco deposit <amount>",
      description: "Moves denars from your pouch into your faction's bank.",
      notes: "You must be in a faction and standing inside its claimed bank chunk.",
    },
    {
      command: "/deco withdraw <amount>",
      description: "Moves denars from your faction's bank into your pouch.",
      notes: "Faction leader only, and only while standing in the bank chunk.",
    },
    {
      command: "/deco baltop",
      description: "Prints a leaderboard of the richest pouches on the server.",
    },
  ],
};

export const economySection: WikiSection = {
  nav: {
    href: "/wiki/economy",
    label: "Denar Economy",
    category: "social",
    blurb: "Denars: the coins you carry in your pouch, bank at a faction vault, and drop in full when you die.",
  },
  commands: denarCommands,
};
