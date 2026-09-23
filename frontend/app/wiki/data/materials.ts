import { T } from "./helpers";
import { collectorHerbMaterials, collectorSource } from "./herb-acquisition";
import type { CatalogMaterial, DropOnlyMaterial, Recipe, WikiSection } from "./types";

// ---------- Materials ----------

/**
 * Hand-written material recipes: the Magic Station ones, which have no server
 * crafting-station config to generate from.
 *
 * The Ingot, Alchemy, Engineer and Medicine Station material recipes used to
 * live here too. The server YAML is authoritative for those, so they were
 * removed and now come from `data/generated/stationRecipes.ts`; the materials
 * they produce are still catalogued, via `serverCraftedMaterials` below.
 */
export const materialRecipes: Recipe[] = [
  // Magic Station
  {
    key: "basic-handle",
    title: "Basic Magical Handle",
    station: "Magic Station",
    requirement: "Mage class",
    ingredients: [
      { name: "Enchanted Dust", qty: 8, texture: T("magic_crafting/enchanted_dust.png") },
      { name: "Stick", qty: 2, texture: T("vanilla/stick.png") },
    ],
    output: { name: "Basic Magical Handle", qty: 1, texture: T("magic_crafting/basic_magical_handle.png") },
  },
  {
    key: "petty-handle",
    title: "Petty Magical Handle",
    station: "Magic Station",
    requirement: "Mage class",
    ingredients: [
      { name: "Basic Magical Handle", qty: 1, texture: T("magic_crafting/basic_magical_handle.png") },
      { name: "Enchanted Dust", qty: 8, texture: T("magic_crafting/enchanted_dust.png") },
    ],
    output: { name: "Petty Magical Handle", qty: 1, texture: T("magic_crafting/petty_magical_handle.png") },
  },
  {
    key: "heavy-handle",
    title: "Heavy Magical Handle",
    station: "Magic Station",
    requirement: "Mage class",
    ingredients: [
      { name: "Petty Magical Handle", qty: 1, texture: T("magic_crafting/petty_magical_handle.png") },
      { name: "Enchanted Dust", qty: 8, texture: T("magic_crafting/enchanted_dust.png") },
    ],
    output: { name: "Heavy Magical Handle", qty: 1, texture: T("magic_crafting/heavy_magical_handle.png") },
  },
  {
    key: "petty-tome",
    title: "Petty Magical Tome",
    station: "Magic Station",
    requirement: "Mage class",
    ingredients: [
      { name: "Enchanted Dust", qty: 8, texture: T("magic_crafting/enchanted_dust.png") },
      { name: "Book", qty: 1, texture: T("vanilla/book.png") },
    ],
    output: { name: "Petty Magical Tome", qty: 1, texture: T("magic_crafting/binding_tome.png") },
  },
  {
    key: "heavy-tome",
    title: "Heavy Magical Tome",
    station: "Magic Station",
    requirement: "Mage class",
    ingredients: [
      { name: "Petty Magical Tome", qty: 1, texture: T("magic_crafting/binding_tome.png") },
      { name: "Enchanted Dust", qty: 8, texture: T("magic_crafting/enchanted_dust.png") },
    ],
    output: { name: "Heavy Magical Tome", qty: 1, texture: T("magic_crafting/strong_binding_tome.png") },
  },
  {
    key: "iron-core",
    title: "Iron Magical Core",
    station: "Magic Station",
    requirement: "Mage class",
    ingredients: [
      { name: "Iron Ingot", qty: 4, texture: T("vanilla/iron_ingot.png") },
      { name: "Enchanted Dust", qty: 4, texture: T("magic_crafting/enchanted_dust.png") },
    ],
    output: { name: "Iron Magical Core", qty: 1, texture: T("magic_crafting/makeshift_magical_core.png") },
  },
  {
    key: "steel-core",
    title: "Steel Magical Core",
    station: "Magic Station",
    requirement: "Mage class",
    ingredients: [
      { name: "Steel Ingot", qty: 4, texture: T("materials/steel_ingot.png") },
      { name: "Enchanted Dust", qty: 4, texture: T("magic_crafting/enchanted_dust.png") },
    ],
    output: { name: "Steel Magical Core", qty: 1, texture: T("magic_crafting/basic_magical_core.png") },
  },
  {
    key: "abyssalite-core",
    title: "Abyssalite Magical Core",
    station: "Magic Station",
    requirement: "Mage class",
    ingredients: [
      { name: "Abyssalite Ingot", qty: 4, texture: T("materials/abyssalite_ingot.png") },
      { name: "Enchanted Dust", qty: 4, texture: T("magic_crafting/enchanted_dust.png") },
    ],
    output: { name: "Abyssalite Magical Core", qty: 1, texture: T("magic_crafting/petty_magical_core.png") },
  },
  {
    key: "mythril-core",
    title: "Mythril Magical Core",
    station: "Magic Station",
    requirement: "Mage class",
    ingredients: [
      { name: "Mythril Ingot", qty: 4, texture: T("materials/mythril_ingot.png") },
      { name: "Enchanted Dust", qty: 4, texture: T("magic_crafting/enchanted_dust.png") },
    ],
    output: { name: "Mythril Magical Core", qty: 1, texture: T("magic_crafting/heavy_magical_core.png") },
  },
  {
    key: "enchanted-leather",
    title: "Enchanted Leather",
    station: "Magic Station",
    requirement: "Mage class",
    ingredients: [
      { name: "Leather", qty: 4, texture: T("vanilla/leather.png") },
      { name: "Enchanted Dust", qty: 4, texture: T("magic_crafting/enchanted_dust.png") },
    ],
    output: { name: "Enchanted Leather", qty: 8, texture: T("magic_crafting/enchanted_leather.png") },
  },
];

/**
 * Custom materials whose recipe now comes from the server's crafting-station
 * configs rather than from `materialRecipes`.
 *
 * They are listed so the material catalogue keeps their name and texture; the
 * recipe itself is resolved out of the global recipe index in `catalog.ts`.
 */
export const serverCraftedMaterials: CatalogMaterial[] = [
  { name: "Coke", texture: T("materials/coke.png") },
  { name: "Steel Ingot", texture: T("materials/steel_ingot.png") },
  { name: "Bronze Ingot", texture: T("materials/bronze_ingot.png") },
  { name: "Abyssalite Ingot", texture: T("materials/abyssalite_ingot.png") },
  { name: "Mythril Ingot", texture: T("materials/mythril_ingot.png") },
  { name: "Barkwood", texture: T("materials/barkwood.png") },
  { name: "Maplewood", texture: T("materials/maplewood.png") },
  { name: "Elderwood", texture: T("materials/elderwood.png") },
  { name: "Demonwood", texture: T("materials/demonwood.png") },
  { name: "Refined Barkwood", texture: T("materials/refined_barkwood.png") },
  { name: "Refined Maplewood", texture: T("materials/refined_maplewood.png") },
  { name: "Refined Elderwood", texture: T("materials/refined_elderwood.png") },
  { name: "Refined Demonwood", texture: T("materials/refined_demonwood.png") },
  { name: "Alchemy Powder", texture: T("materials/alchemy_powder.png") },
  { name: "Carbon Powder", texture: T("materials/carbon_powder.png") },
  { name: "Synthetic Ink", texture: T("materials/synthetic_ink.png") },
  { name: "Potash", texture: T("materials/potash.png") },
  { name: "Fertilizer", texture: T("materials/fertilizer.png") },
  { name: "Transmutation Powder", texture: T("materials/transmutation_powder.png") },
  { name: "Sulfur", texture: T("materials/sulfur.png") },
  { name: "Saltpeter", texture: T("materials/saltpeter.png") },
  { name: "Dynamite", texture: T("materials/dynamite.png") },
  { name: "Detoxed Leather", texture: T("materials/detoxed_leather.png") },
];

// Historical export name retained for the station recipe generator's catalogue scan.
// Gathered/loot materials may also have unpacking recipes. Acquisition evidence:
// https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/docs/wiki-research/material-acquisition.md (cloned server config + local drop implementation).
export const dropOnlyMaterials: DropOnlyMaterial[] = [
  { name: "Enchanted Dust", texture: T("magic_crafting/enchanted_dust.png"), lore: "A magical crafting ingredient used in equipment and material recipes." },
  {
    name: "Ignitium", texture: T("materials/ignitium.png"), lore: "Uncommon crystal: catalyst in Coke production.",
    unpackingRecipeKeys: ["gen-ingot-station-ignitium-block2"],
    acquisition: [
      { method: "Mining with Lucky Miner I", detail: "Mine iron, gold, diamond, redstone, lapis, emerald or copper ore, including their deepslate variants. Requires the Crafter profession perk Lucky Miner I." },
      { method: "Logging with Tree Gatherer IV", detail: "Break spruce, oak, birch, jungle, dark oak, acacia, cherry, mangrove or pale oak logs. Requires the Herborist profession perk Tree Gatherer IV." },
      { method: "Detector rewards", detail: "Find a source with the detector." },
      { method: "Pouch of Rare Materials", detail: "Right-click a Pouch of Rare Materials to receive Ignitium." },
    ],
  },
  {
    name: "Tin", texture: T("materials/raw_tin.png"), lore: "Malleable metal used to produce alloys like Bronze.",
    unpackingRecipeKeys: ["gen-ingot-station-tin-block2"],
  },
  {
    name: "Abyssalite Fragment",
    texture: T("materials/abyssalite.png"),
    lore: "Tough fragment of metal, an upgrade path from Steel.",
  },
  {
    name: "Mythril Fragment",
    texture: T("materials/mythril_fragment.png"),
    lore: "A metal of legend: the successor to Abyssalite in utility.",
  },
  {
    name: "Mythrilite",
    texture: T("materials/mythrilite.png"),
    lore: "One of the rarest materials in Cerrith; unlocks Mythril's potential.",
  },
  { name: "Bark", texture: T("materials/bark.png") },
  { name: "Bloodmagic Essence", texture: T("magic_crafting/bloodmagic_essence.png") },
  { name: "Necromancy Essence", texture: T("magic_crafting/necromancy_essence.png") },
  { name: "Wood Core", texture: T("materials/wood_core.png") },
  { name: "Flower Core", texture: T("materials/flower_core.png") },
  { name: "Valewood", texture: T("materials/valewood.png"), acquisition: [
    { method: "Logging with Tree Gatherer III", detail: "Break spruce, oak, birch, jungle, dark oak, acacia, cherry, mangrove or pale oak logs. Requires the Herborist profession perk Tree Gatherer III." },
    { method: "Rare Wood Forestry production", detail: "Select the Rare Wood Forestry production focus on a Forestry resource node to include Valewood in its output pool." },
  ] },
  { name: "Runebark", texture: T("materials/runebark.png"), acquisition: [
    { method: "Logging with Tree Gatherer III", detail: "Break spruce, oak, birch, jungle, dark oak, acacia, cherry, mangrove or pale oak logs. Requires the Herborist profession perk Tree Gatherer III." },
    { method: "Rare Wood Forestry production", detail: "Select the Rare Wood Forestry production focus on a Forestry resource node to include Runebark in its output pool." },
  ] },
  { name: "Amberpine", texture: T("materials/amberpine.png"), acquisition: [
    { method: "Logging with Tree Gatherer III", detail: "Break spruce, oak, birch, jungle, dark oak, acacia, cherry, mangrove or pale oak logs. Requires the Herborist profession perk Tree Gatherer III." },
    { method: "Rare Wood Forestry production", detail: "Select the Rare Wood Forestry production focus on a Forestry resource node to include Amberpine in its output pool." },
  ] },
  { name: "Goldmaple", texture: T("materials/goldmaple.png"), acquisition: [
    { method: "Logging with Tree Gatherer III", detail: "Break spruce, oak, birch, jungle, dark oak, acacia, cherry, mangrove or pale oak logs. Requires the Herborist profession perk Tree Gatherer III." },
    { method: "Rare Wood Forestry production", detail: "Select the Rare Wood Forestry production focus on a Forestry resource node to include Goldmaple in its output pool." },
  ] },
  { name: "Silk", texture: T("materials/silk.png"), acquisition: [
    { method: "Logging with Tree Gatherer III", detail: "Break spruce, oak, birch, jungle, dark oak, acacia, cherry, mangrove or pale oak logs. Requires the Herborist profession perk Tree Gatherer III." },
    { method: "Rare Wood Forestry production", detail: "Select the Rare Wood Forestry production focus on a Forestry resource node to include Silk in its output pool." },
  ] },
  {
    name: "Moldable Gold",
    texture: T("materials/moldable_gold.png"),
    lore: "Uncommon gold variant with Goldsmithing applications.",
  },
  {
    name: "Rough Gold",
    texture: T("materials/rough_gold.png"),
    lore: "Common gold variant with Goldsmithing applications.",
  },
  {
    name: "Shiny Gold",
    texture: T("materials/shiny_gold.png"),
    lore: "Rare gold variant with Goldsmithing applications.",
  },
  {
    name: "Arcane Crystal", texture: T("materials/arcane_crystal.png"), lore: "Found deep below the earth: not of this Plane.",
    acquisition: [
      { method: "Mining with Lucky Miner I", detail: "Mine iron, gold, diamond, redstone, lapis, emerald or copper ore, including their deepslate variants. Requires the Crafter profession perk Lucky Miner I." },
      { method: "Rare Ore Mine production", detail: "Select the Rare Ore Mine production focus on an Ore Mine resource node to include Arcane Crystal in its output pool." },
      { method: "War Crate rewards", detail: "Arcane Crystals are in the War Crate reward pool. Check crate availability in game." },
    ],
  },
  {
    name: "Niter", texture: T("materials/niter.png"),
    acquisition: [
      { method: "Mining with Lucky Miner I", detail: "Mine iron, gold, diamond, redstone, lapis, emerald or copper ore, including their deepslate variants. Requires the Crafter profession perk Lucky Miner I." },
      { method: "Rare Ore Mine production", detail: "Select the Rare Ore Mine production focus on an Ore Mine resource node to include Niter in its output pool." },
    ],
  },
  { name: "Smokeless Powder", texture: T("materials/smokeless_powder.png") },
  { name: "Raw Iron Fragment", texture: T("materials/rawiron_fragment.png"), lore: "Crafted into Iron Ingots at a Fishing Station." },
  { name: "Raw Gold Fragment", texture: T("materials/rawgold_fragment.png"), lore: "Crafted into Gold Ingots at a Fishing Station." },
  { name: "Diamond Fragment", texture: T("materials/diamond_fragment.png"), lore: "Crafted into Diamonds at a Fishing Station." },
  { name: "Fossil", texture: T("materials/fossil.png") },
  { name: "Good Quality Leather", texture: T("pets/rareleather.png"), lore: "Used to make weapons and armor on the Anvil." },
  { name: "Great Quality Leather", texture: T("pets/epicleather.png"), lore: "Used to make weapons and armor on the Anvil." },
  { name: "Perfect Quality Leather", texture: T("pets/legendaryleather.png"), lore: "Used to make weapons and armor on the Anvil." },
  { name: "Good Quality Feather", texture: T("pets/rarefeather.png"), lore: "Used to make weapons and armor on the Anvil." },
  { name: "Great Quality Feather", texture: T("pets/epicfeather.png"), lore: "Used to make weapons and armor on the Anvil." },
  { name: "Perfect Quality Feather", texture: T("pets/legendaryfeather.png"), lore: "Used to make weapons and armor on the Anvil." },
  { name: "Good Quality Wool", texture: T("pets/rarewool.png"), lore: "Used to make weapons and armor on the Anvil." },
  { name: "Great Quality Wool", texture: T("pets/epicwool.png"), lore: "Used to make weapons and armor on the Anvil." },
  { name: "Perfect Quality Wool", texture: T("pets/legendarywool.png"), lore: "Used to make weapons and armor on the Anvil." },
  // Alchemy herbs: gathered from the world, used as Alchemy Station reagents.
  { name: "Nightshade", texture: T("herbs/icon36.png"), lore: "Herbal reagent gathered from the world.", acquisition: [collectorSource()] },
  { name: "Grapeberries", texture: T("herbs/icon33.png"), lore: "Herbal reagent gathered from the world.", acquisition: [collectorSource()] },
  { name: "Arcane Leaf", texture: T("herbs/icon5.png"), lore: "Herbal reagent gathered from the world.", acquisition: [collectorSource()] },
  { name: "Fiery Fruit", texture: T("herbs/icon20.png"), lore: "Herbal reagent gathered from the world.", acquisition: [collectorSource()] },
  { name: "Barkshroom", texture: T("herbs/icon24.png"), lore: "Herbal reagent gathered from the world.", acquisition: [collectorSource()] },
  { name: "Caveshroom", texture: T("herbs/icon21.png"), lore: "Herbal reagent gathered from the world.", acquisition: [collectorSource()] },
  { name: "Flatshroom", texture: T("herbs/icon45.png"), lore: "Herbal reagent gathered from the world.", acquisition: [collectorSource()] },
  { name: "Death Fruit", texture: T("herbs/icon42.png"), lore: "Herbal reagent gathered from the world.", acquisition: [collectorSource()] },
  { name: "Blazed Root", texture: T("herbs/icon44.png"), lore: "Herbal reagent gathered from the world.", acquisition: [collectorSource()] },
  { name: "Serpent Root", texture: T("herbs/icon18.png"), lore: "Herbal reagent gathered from the world.", acquisition: [collectorSource()] },
  ...collectorHerbMaterials,
  {
    name: "Universal Feed", texture: T("mmoitems/universal_feed.png"), lore: "Used daily to feed your animals.",
    acquisition: [
      { method: "Made in a Trough", detail: "Craft a Trough at the Animal Station, place it, and fill it with any vegetable mix to make Universal Feed." },
    ],
  },
];

export const materialsSection: WikiSection = {
  nav: {
    href: "/wiki/materials",
    label: "Materials",
    category: "reference",
    blurb:
      "The full custom material catalogue: Mythril, Coke, and everything else players craft or find.",
  },
  recipes: materialRecipes,
};
