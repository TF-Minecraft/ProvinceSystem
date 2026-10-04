import { empty, V } from "./helpers";
import type { Recipe, WikiCommandSet, WikiSection } from "./types";

// ---------- Market Block ----------

export const marketBlockRecipe: Recipe = {
  key: "market-block",
  title: "Market Block",
  station: "Crafting Table",
  requirement: "None",
  ingredients: [
    { name: "Ink Sac", qty: 1, texture: V("ink_sac.png") },
    { name: "Paper", qty: 1, texture: V("paper.png") },
    empty,
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
    empty,
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
  ],
  note: "Synthetic Ink can replace the Ink Sac. Use one Oak Plank in each of the five plank slots.",
  output: {
    name: "Market Block",
    qty: 1,
    model: {
      url: "/wiki/models/market-block.json",
      textures: {
        "4": "/wiki/textures/market-block/wood_m.png",
        "8": "/wiki/textures/market-block/wood2.png",
        "9": "/wiki/textures/market-block/wood1.png",
        "10": "/wiki/textures/market-block/coin.png",
        "11": "/wiki/textures/market-block/manifest.png",
        "12": "/wiki/textures/market-block/ink_bottle.png",
        "13": "/wiki/textures/market-block/apple.png",
      },
    },
  },
};

/**
 * The jar contains zero permission checks on `/marketblock`, so every
 * subcommand below is technically runnable by any player right now. That is
 * documented as a known bug, not the intended design. By design MarketBlock
 * has no player-facing command: you interact with the block.
 */
export const marketBlockCommands: WikiCommandSet = {
  system: "Market Block",
  href: "/wiki/market-blocks",
  commands: [],
  excludedStaffCommands: [
    "/marketblock reload",
    "/marketblock add",
    "/marketblock delete <id>",
    "/marketblock reset <id>",
    "/marketblock resetall",
  ],
};

export const marketBlockSection: WikiSection = {
  nav: {
    href: "/wiki/market-blocks",
    label: "Market Block",
    category: "social",
    blurb: "A sell-only shop block: dump raw materials for denars at a price that sags the more you sell.",
  },
  recipes: [marketBlockRecipe],
  commands: marketBlockCommands,
};

