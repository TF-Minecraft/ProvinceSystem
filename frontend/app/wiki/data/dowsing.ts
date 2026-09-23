import { M, T, V } from "./helpers";
import type { Recipe, WikiSection } from "./types";

// Source: plugins/Dowsing (config.yml, blocks.yml, types.yml, slots.yml, production_methods.yml),
// ItemsAdder ia_tfmc/contents/nodes.yml, and https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/docs/wiki-research/a2-gems-dowsing-archaeo.md.

const planks = { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") };

export const generalNodeModel = {
  url: M("stations/general-node.json"),
  textures: {
    "1": T("stations/general-node/node_bottom.png"),
    "3": T("stations/general-node/node_side_right_general.png"),
    "5": T("stations/general-node/node_top.png"),
  },
};

/** The only node recipe enabled on the server. */
export const generalNodeRecipe: Recipe = {
  key: "general-node",
  title: "General Node",
  station: "Crafting Table",
  requirement: "None",
  ingredients: [
    planks, planks, planks,
    planks, { name: "Gold Ingot", qty: 1, texture: V("gold_ingot.png") }, planks,
    planks, planks, planks,
  ],
  output: { name: "General Node", qty: 1, sourceId: "itemsadder:general_node", model: generalNodeModel },
  note: "One General Node can run any of the six node types.",
};

export type NodeType = { name: string; cycle: string; focuses: string[]; fittings: string[] };

/** Base cycle length is the type's timer; node level and fittings shorten it. */
export const nodeTypes: NodeType[] = [
  { name: "Ore Mine", cycle: "240", focuses: ["Iron Ore Mine", "Copper Ore Mine", "Rare Ore Mine", "Gemstone Mine"], fittings: ["Tools", "Refinery", "Light", "Explosives"] },
  { name: "Magical Mine", cycle: "240", focuses: ["Dust Mine", "Artifact Mine"], fittings: ["Tools", "Refinery", "Light", "Explosives"] },
  { name: "Farm", cycle: "120", focuses: ["Vegetable Farm", "Onion Farm", "Exotic Farm", "Yeast Production", "Fruit Orchard", "Exotic Fruit Orchard"], fittings: ["Hoes", "Fertilizer", "Irrigation"] },
  { name: "Plantation", cycle: "120", focuses: ["Material Plantation", "Spice Plantation", "Sweet Spice Plantation"], fittings: ["Hoes", "Fertilizer", "Irrigation"] },
  { name: "Forestry", cycle: "60", focuses: ["Log Forestry", "Bark Forestry", "Rare Wood Forestry"], fittings: ["Axes", "Refinery", "Irrigation"] },
  { name: "Quarry", cycle: "60", focuses: ["Stone Quarry", "Salt Quarry", "Gold Quarry"], fittings: ["Shovels", "Refinery", "Light", "Explosives"] },
];

/** Identical for all six node types. Paid from the guild bank. */
export const nodeLevels = [
  { level: 1, cost: "0" }, { level: 2, cost: "40" }, { level: 3, cost: "80" }, { level: 4, cost: "160" }, { level: 5, cost: "320" },
  { level: 6, cost: "640" }, { level: 7, cost: "1,280" }, { level: 8, cost: "2,560" }, { level: 9, cost: "5,120" }, { level: 10, cost: "10,060" },
];

export const dowsingSection: WikiSection = {
  nav: {
    href: "/wiki/dowsing",
    label: "Resource Nodes",
    category: "gathering",
    blurb: "Place a guild-owned node, pick what it produces, and collect its output every cycle.",
  },
  recipes: [generalNodeRecipe],
};
