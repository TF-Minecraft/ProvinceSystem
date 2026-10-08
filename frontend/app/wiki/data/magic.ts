import { M, T, V, empty } from "./helpers";
import { stationRecipe } from "./station-recipes";
import type { Recipe, WikiCommandSet, WikiSection } from "./types";

// ---------- Magic (elements, shrines, spell runes, attunement) ----------
//
// Sources: https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/docs/wiki-research/a-magic-knowledge.md section 1 (live Magic/*.yml,
// MMOItems rune/charge definitions, the jar's plugin.yml). No source repository
// exists for the Magic plugin, so everything here is config-derived.

/** The Magic Station furniture is a plain vanilla 3x3 craft. */
export const magicStationRecipe: Recipe = {
  key: "magic-station",
  title: "Magic Station",
  station: "Crafting Table",
  requirement: "None",
  ingredients: [
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    { name: "Gold Ingot", qty: 1, texture: V("gold_ingot.png") },
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    { name: "Amethyst Shard", qty: 1, texture: V("amethyst_shard.png") },
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
  ],
  output: {
    name: "Magic Station",
    qty: 1,
    sourceId: "itemsadder:magic_crafting_station",
    model: { url: M("magic-station.json"), texture: T("stations/magic-station.png") },
  },
  note: "Place it, then interact to open the weapon assembly menu.",
};

/** ItemsAdder `tfmc:rune_crafting_station`: the Magic Station pattern without the Amethyst Shard. */
export const runeStationRecipe: Recipe = {
  key: "rune-station",
  title: "Rune Station",
  station: "Crafting Table",
  requirement: "None",
  ingredients: [
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    { name: "Gold Ingot", qty: 1, texture: V("gold_ingot.png") },
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
    empty,
    { name: "Blackstone", qty: 1, texture: V("blackstone.png") },
  ],
  output: {
    name: "Rune Station",
    qty: 1,
    sourceId: "itemsadder:rune_crafting_station",
    model: { url: M("stations/rune-station.json"), textures: { "1": T("stations/rune-station.png") } },
  },
  note: "Place it, then interact to craft blank runestones and Enchanted Charges from Enchanted Dust.",
};

/** Everything the Rune Station crafts, from `MMOItems/crafting-stations/rune-station.yml`. Each takes 10 s. */
export const runestoneRecipes: Recipe[] = ["minor-runestone", "lesser-runestone", "greater-runestone", "ascendant-runestone"]
  .map(key => stationRecipe(`gen-rune-station-${key}`));
// `lesser-armor-` is the recipe key as written in the server config.
export const armorRunestoneRecipes: Recipe[] = ["minor-armor-runestone", "lesser-armor-", "greater-armor-runestone", "ascendant-armor-runestone"]
  .map(key => stationRecipe(`gen-rune-station-${key}`));
export const enchantedChargeRecipes: Recipe[] = ["minor", "lesser", "greater", "ascendant"]
  .map(key => stationRecipe(`gen-rune-station-enchanted-charge-${key}`));

export const magicRecipes: Recipe[] = [magicStationRecipe, runeStationRecipe];

// ---------- Commands ----------

export const magicCommands: WikiCommandSet = {
  system: "Magic",
  href: "/wiki/magic",
  commands: [
    {
      command: "/magic rune keybind",
      description: "While holding a rune, use this command to change its casting key.",
    },
    {
      command: "/resonance",
      aliases: ["/res"],
      description:
        "Opens your Resonance profile: a bar per element, your Equilibrium (Corruption vs Tranquility), your Mental Points, and the Surge / Flow cast-mode toggle.",
      notes:
        "Requires an active character.",
    },
  ],
  excludedStaffCommands: [
    "/magic reload",
    "/magic open",
    "/magic resonance <get|set|add|reset> ...",
    "/magic artifact <roll|give|create|path|setfill> ...",
    "/magic fillchest <element|random|all>",
    "/magic shrine fill <element> <amount>",
    "/magic refresh",
  ],
};

export const magicSection: WikiSection = {
  nav: {
    href: "/wiki/magic",
    label: "Magic",
    category: "magic",
    blurb: "Mage weapon parts, spell runes and shrines.",
  },
  recipes: magicRecipes,
  commands: magicCommands,
};
