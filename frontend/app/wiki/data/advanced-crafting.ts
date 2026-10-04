import { M, T, V, empty } from "./helpers";
import type { Recipe, WikiCommandSet, WikiSection } from "./types";

// ---------- AdvancedCrafting: the three station blocks ----------
//
// Only the physical station blocks are ordinary 3x3 crafting-table recipes :
// what happens *at* those stations (hammering a weapon, inventing an alloy)
// is a multi-step interaction, not a single recipe, so it is documented as
// prose + reference tables on the page rather than forced into a Recipe shape.

const weaponStationModel = {
  url: M("weapon-station.json"),
  texture: T("stations/weapon-station.png"),
};
const ingredientConverterModel = {
  url: M("ingredient-converter.json"),
  texture: T("stations/ingredient-converter.png"),
};
const alloyForgeModel = {
  url: M("alloy-forge.json"),
  texture: T("stations/alloy-forge.png"),
  textureAnimationUrl: T("stations/alloy-forge.png.mcmeta"),
};

export const weaponStationRecipe: Recipe = {
  key: "craft-weapon-station",
  title: "Forging Station",
  station: "Crafting Table",
  requirement: "None",
  ingredients: [
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    empty,
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
  ],
  output: { name: "Forging Station", qty: 1, sourceId: "itemsadder:weapon_station", model: weaponStationModel },
};

export const ingredientConverterRecipe: Recipe = {
  key: "craft-ingredient-converter",
  title: "Ingredient Converter",
  station: "Crafting Table",
  requirement: "None",
  ingredients: [
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
    empty,
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") },
  ],
  output: { name: "Ingredient Converter", qty: 1, sourceId: "itemsadder:ingredient_converter", model: ingredientConverterModel },
};

export const alloyForgeRecipe: Recipe = {
  key: "craft-alloy-forge",
  title: "Alloy Forge",
  station: "Crafting Table",
  requirement: "None",
  ingredients: [
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    empty,
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
    { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") },
  ],
  output: { name: "Alloy Forge", qty: 1, sourceId: "itemsadder:alloy_forge", model: alloyForgeModel },
  note: "Right-click it with a Lava Bucket to forge; the bucket is emptied.",
};

export const advancedCraftingRecipes: Recipe[] = [
  weaponStationRecipe,
  ingredientConverterRecipe,
  alloyForgeRecipe,
];

// ---------- Commands ----------

export const advancedCraftingCommands: WikiCommandSet = {
  system: "AdvancedCrafting",
  href: "/wiki/advanced-crafting",
  commands: [
    {
      command: "/alloy name <NewName>",
      description:
        "Names the alloy you just invented at the Alloy Forge, inside a 60-second naming prompt.",
      notes:
        "Names may only contain letters and underscores. Underscores appear as spaces, and the naming prompt is available to every player who reaches it.",
    },
  ],
  excludedStaffCommands: [
    "/ac reload",
    "/ac sync recipes [repair]",
    "/ac refresh",
    "/ac inspect",
    "/ac give alloy <id> [player]",
    "/ac info alloy <id>",
    "/ac craft <percent>",
  ],
};

// ---------- Section ----------

export const advancedCraftingSection: WikiSection = {
  nav: {
    href: "/wiki/advanced-crafting",
    label: "AdvancedCrafting",
    category: "professions",
    blurb: "Hammer your own weapons and armor, then invent and name your own metal alloys.",
  },
  recipes: advancedCraftingRecipes,
  commands: advancedCraftingCommands,
};

// ---------- Forging Station recipe templates ----------
//
// Source: plugins/AdvancedCrafting/recipes/{weapons,armor,bows}.yml (35 entries).
//
// These are NOT 3x3 crafting-table recipes and deliberately do not use the
// `Recipe`/`Slot` shape. A station recipe asks for ingredient *types* with a
// count ("metal.4" = four ingredients of type `metal`) and the player chooses
// which concrete metal / wood / leather / ... fills each one. An ingredient
// type is not an item and has no texture, so forcing it into a `CraftingGrid`
// would mean inventing item icons that do not exist. Rendered as a table.
//
// No entry in any of the three files declares a time, a cost, a level or a
// permission, so none of those fields exist here.

/** The eight ingredient types, from `ingredient-types.yml`. */
export type IngredientTypeId =
  | "metal"
  | "wood"
  | "crystal"
  | "leather"
  | "feather"
  | "wool"
  | "paper"
  | "enchanted_dust";

/** Display label and in-game colour for each type (`ingredient-types.yml`). */
export const ingredientTypes: Record<IngredientTypeId, { label: string; color: string }> = {
  metal: { label: "Metal", color: "#9e968a" },
  wood: { label: "Wood", color: "#964B00" },
  crystal: { label: "Crystal", color: "#ce89d6" },
  leather: { label: "Leather", color: "#f29857" },
  feather: { label: "Feather", color: "#faf9f7" },
  wool: { label: "Wool", color: "#ede2af" },
  paper: { label: "Paper", color: "#faf9f7" },
  enchanted_dust: { label: "Enchanted Dust", color: "#FF55FF" },
};

/** One `<type>.<count>` entry of a recipe ingredient list. */
export type TemplateIngredient = { type: IngredientTypeId; qty: number };

export type StationRecipeCategory = "armor" | "weapons" | "bows";

/**
 * A Forging Station recipe template.
 *
 * `name` is kept verbatim from the config, including the `%material%`
 * placeholder that the plugin replaces at craft time with a procedurally
 * generated material name (`naming-schemes/basic.yml`).
 */
export type StationRecipeTemplate = {
  /** Config key in the YAML file. */
  id: string;
  /** Output name, still containing `%material%`. */
  name: string;
  category: StationRecipeCategory;
  /** Sub-grouping for armor: the five armor classes. Absent elsewhere. */
  group?: string;
  ingredients: TemplateIngredient[];
  socketGroup: "gemstones" | "mage_armor_runes";
};

const gem = "gemstones" as const;

/** recipes/weapons.yml: 12 entries, in file order. */
export const weaponRecipeTemplates: StationRecipeTemplate[] = [
  { id: "sword", name: "%material% Sword", category: "weapons", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
  { id: "battleaxe", name: "%material% Battleaxe", category: "weapons", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
  { id: "dagger", name: "%material% Dagger", category: "weapons", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
  { id: "warhammer", name: "%material% Warhammer", category: "weapons", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
  { id: "spear", name: "%material% Spear", category: "weapons", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
  { id: "polearm", name: "%material% Polearm", category: "weapons", socketGroup: gem, ingredients: [{ type: "metal", qty: 8 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
  { id: "greathammer", name: "%material% Greathammer", category: "weapons", socketGroup: gem, ingredients: [{ type: "metal", qty: 8 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
  { id: "longsword", name: "%material% Longsword", category: "weapons", socketGroup: gem, ingredients: [{ type: "metal", qty: 8 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
  { id: "greataxe", name: "%material% Greataxe", category: "weapons", socketGroup: gem, ingredients: [{ type: "metal", qty: 8 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
  { id: "shortswords", name: "%material% Shortsword", category: "weapons", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
  { id: "shield", name: "%material% Shield", category: "weapons", socketGroup: gem, ingredients: [{ type: "wood", qty: 4 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
  { id: "banner", name: "%material% Battle Standard", category: "weapons", socketGroup: gem, ingredients: [{ type: "wood", qty: 4 }, { type: "leather", qty: 2 }, { type: "wool", qty: 2 }] },
];

/** recipes/bows.yml: 3 entries, in file order. */
export const bowRecipeTemplates: StationRecipeTemplate[] = [
  { id: "shortbow", name: "%material% Shortbow", category: "bows", socketGroup: gem, ingredients: [{ type: "wood", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "crossbow", name: "%material% Crossbow", category: "bows", socketGroup: gem, ingredients: [{ type: "wood", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "longbow", name: "%material% Longbow", category: "bows", socketGroup: gem, ingredients: [{ type: "wood", qty: 8 }, { type: "feather", qty: 4 }] },
];

/** recipes/armor.yml: 20 entries (5 classes x 4 slots), in file order. */
export const armorRecipeTemplates: StationRecipeTemplate[] = [
  { id: "light_helmet", name: "Light %material% Helmet", category: "armor", group: "Light", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "light_chestplate", name: "Light %material% Chestplate", category: "armor", group: "Light", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "light_leggings", name: "Light %material% Leggings", category: "armor", group: "Light", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "light_boots", name: "Light %material% Boots", category: "armor", group: "Light", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "medium_helmet", name: "Medium %material% Helmet", category: "armor", group: "Medium", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "leather", qty: 4 }] },
  { id: "medium_chestplate", name: "Medium %material% Chestplate", category: "armor", group: "Medium", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "leather", qty: 4 }] },
  { id: "medium_leggings", name: "Medium %material% Leggings", category: "armor", group: "Medium", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "leather", qty: 4 }] },
  { id: "medium_boots", name: "Medium %material% Boots", category: "armor", group: "Medium", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "leather", qty: 4 }] },
  { id: "heavy_helmet", name: "Heavy %material% Helmet", category: "armor", group: "Heavy", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "wool", qty: 4 }] },
  { id: "heavy_chestplate", name: "Heavy %material% Chestplate", category: "armor", group: "Heavy", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "wool", qty: 4 }] },
  { id: "heavy_leggings", name: "Heavy %material% Leggings", category: "armor", group: "Heavy", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "wool", qty: 4 }] },
  { id: "heavy_boots", name: "Heavy %material% Boots", category: "armor", group: "Heavy", socketGroup: gem, ingredients: [{ type: "metal", qty: 4 }, { type: "wool", qty: 4 }] },
  { id: "infantry_helmet", name: "Infantry %material% Cap", category: "armor", group: "Infantry", socketGroup: gem, ingredients: [{ type: "paper", qty: 4 }, { type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "infantry_chestplate", name: "Infantry %material% Jacket", category: "armor", group: "Infantry", socketGroup: gem, ingredients: [{ type: "paper", qty: 4 }, { type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "infantry_leggings", name: "Infantry %material% Leggings", category: "armor", group: "Infantry", socketGroup: gem, ingredients: [{ type: "paper", qty: 4 }, { type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "infantry_boots", name: "Infantry %material% Boots", category: "armor", group: "Infantry", socketGroup: gem, ingredients: [{ type: "paper", qty: 4 }, { type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "mage_helmet", name: "Mage %material% Hood", category: "armor", group: "Mage", socketGroup: "mage_armor_runes", ingredients: [{ type: "enchanted_dust", qty: 4 }, { type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "mage_chestplate", name: "Mage %material% Robes", category: "armor", group: "Mage", socketGroup: "mage_armor_runes", ingredients: [{ type: "enchanted_dust", qty: 4 }, { type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "mage_leggings", name: "Mage %material% Leggings", category: "armor", group: "Mage", socketGroup: "mage_armor_runes", ingredients: [{ type: "enchanted_dust", qty: 4 }, { type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
  { id: "mage_boots", name: "Mage %material% Boots", category: "armor", group: "Mage", socketGroup: "mage_armor_runes", ingredients: [{ type: "enchanted_dust", qty: 4 }, { type: "metal", qty: 4 }, { type: "feather", qty: 4 }] },
];
