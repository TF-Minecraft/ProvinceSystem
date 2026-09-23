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

// ---------- Elements ----------

export type MagicElement = {
  id: string;
  name: string;
  colour: string;
  guiSlot: number;
  /** Does a scenery shrine of this element actually charge an artifact: */
  sceneryCharge: boolean;
  /** How many spell runes exist for it. */
  runes: number;
  /** Shrine block families a player would build. */
  scenery: string;
  note?: string;
};

export const magicElements: MagicElement[] = [
  {
    id: "cerrith",
    name: "Cerrith",
    colour: "#466629",
    guiSlot: 28,
    sceneryCharge: true,
    runes: 8,
    scenery:
      "Grass, moss, podzol and rooted dirt; water; ferns and moss carpet; azalea, leaves and saplings; flowers, spore blossom, pink petals, cave vines, wildflowers, leaf litter; crops, sugar cane, pumpkin, melon; berry bushes; mossy cobblestone and mossy stone bricks. A single firefly bush is worth weight 6.0: by far the most efficient block.",
    note: "Healing and support. The most complete element in the game.",
  },
  {
    id: "oseni",
    name: "Oseni",
    colour: "#e29a00",
    guiSlot: 32,
    sceneryCharge: true,
    runes: 4,
    scenery:
      "Lava; magma, netherrack, basalt, smooth basalt, blackstone, campfire, furnace, blast furnace, smoker; copper and coal blocks and ores; orange/red terracotta (plain and glazed), nether bricks, red nether bricks.",
    note: "Fire and damage.",
  },
  {
    id: "seithr",
    name: "Seithr",
    colour: "#15E5FF",
    guiSlot: 30,
    sceneryCharge: true,
    runes: 8,
    scenery:
      "Lava (shared with Oseni); all ice types, snow, snow blocks, powder snow; calcite, quartz block/pillar/smooth quartz, white concrete, white wool.",
    note: "Ice and control.",
  },
  {
    id: "mitlan",
    name: "Mitlan",
    colour: "#5555ff",
    guiSlot: 34,
    sceneryCharge: true,
    runes: 0,
    scenery:
      "Water and bubble columns; kelp, seagrass, the prismarine family, sea lanterns, conduits; mud, muddy mangrove roots, packed mud, clay, wet sponge; all fifteen dead coral blocks, corals and fans.",
    note: "Water. Shrines charge, but there is nothing to cast with it.",
  },
  {
    id: "bloodmagic",
    name: "Bloodmagic",
    colour: "#aa0000",
    guiSlot: 42,
    sceneryCharge: true,
    runes: 0,
    scenery:
      "Redstone block, ore, deepslate ore and wire; nether brick family, crimson stem/hyphae, crimson nylium, netherrack; weeping vines, crimson fungus, crimson roots; nether wart and wart block; red wool, red concrete, red candle, campfire.",
    note: "No runes, but the only working sacrifice rite is Bloodmagic's.",
  },
  {
    id: "spirit",
    name: "Spirit",
    colour: "#e8d5a3",
    guiSlot: 20,
    sceneryCharge: false,
    runes: 0,
    scenery:
      "Soul lantern, soul torch, soul wall torch, soul campfire; soul sand and soul soil; cherry leaves/log/wood/stripped log/sapling, pink petals; sea lantern, all three froglights, quartz pillar.",
  },
  {
    id: "arcanum",
    name: "Arcanum",
    colour: "#aa00aa",
    guiSlot: 22,
    sceneryCharge: false,
    runes: 0,
    scenery:
      "Bookshelf, chiseled bookshelf, lectern, enchanting table; amethyst block, budding amethyst, all bud sizes, amethyst cluster; ender chest, end rod, lodestone, crying obsidian, respawn anchor, brewing stand.",
    note: "The only element with a listed resonance decay of -0.035 per hour.",
  },
  {
    id: "illusion",
    name: "Illusion",
    colour: "#e070b0",
    guiSlot: 24,
    sceneryCharge: false,
    runes: 0,
    scenery:
      "Glass, glass panes, tinted glass, white and black stained glass and panes; chorus plant and flower, purpur block and pillar; white, light blue, magenta, pink, purple and cyan glazed terracotta; glow lichen.",
  },
  {
    id: "necromancy",
    name: "Necromancy",
    colour: "#00aaaa",
    guiSlot: 38,
    sceneryCharge: false,
    runes: 0,
    scenery:
      "Soul sand and soul soil; bone block, skeleton and wither skeleton skulls, wither rose; sculk, catalyst, sensor, shrieker, calibrated sensor; cobweb, deepslate tiles, tile slabs and bricks.",
  },
  {
    id: "shadowmancy",
    name: "Shadowmancy",
    colour: "#555555",
    guiSlot: 40,
    sceneryCharge: false,
    runes: 0,
    scenery:
      "Blackstone family, obsidian, crying obsidian; dark oak and mangrove logs/wood/leaves/planks/roots; sculk vein, tinted glass, black candle and candle cake, black wool and concrete; nether wart block, warped wart block, warped nylium.",
  },
];

// ---------- Spell runes ----------

export type SpellRune = {
  element: "Cerrith" | "Oseni" | "Seithr";
  name: string;
  itemId: string;
  socket: "Minor Rune" | "Lesser Rune" | "Greater Rune" | "Ascendant Rune";
  cooldown: string;
  mana: string;
  effect: string;
};

export const spellRunes: SpellRune[] = [
  { element: "Cerrith", name: "Healing Orb", itemId: "RUNE_OF_HEALING_ORB", socket: "Minor Rune", cooldown: "10.0 s", mana: "4.0", effect: "Heals 4.0" },
  { element: "Cerrith", name: "Shielding Orb", itemId: "RUNE_OF_SHIELDING_ORB", socket: "Minor Rune", cooldown: "10.0 s", mana: "4.0", effect: "Shield power 4.0 for 10.0 s" },
  { element: "Cerrith", name: "Hand Cure", itemId: "RUNE_OF_HAND_CURE", socket: "Lesser Rune", cooldown: "15.0 s", mana: "6.0", effect: "Heals 6.0" },
  { element: "Cerrith", name: "Blessing of Swiftness", itemId: "RUNE_OF_BLESSING_OF_SWIFTNESS", socket: "Lesser Rune", cooldown: "15.0 s", mana: "6.0", effect: "Lasts 10.0 s" },
  { element: "Cerrith", name: "Cerrith Glyph", itemId: "RUNE_OF_CERRITH_GLYPH", socket: "Greater Rune", cooldown: "20.0 s", mana: "8.0", effect: "Lasts 8.0 s, shield 10.0 s" },
  { element: "Cerrith", name: "Restoration", itemId: "RUNE_OF_RESTORATION", socket: "Greater Rune", cooldown: "20.0 s", mana: "8.0", effect: "No values in the item definition" },
  { element: "Cerrith", name: "Blessing of Healing", itemId: "RUNE_OF_BLESSING_OF_HEALING", socket: "Ascendant Rune", cooldown: "20.0 s", mana: "10.0", effect: "Heals 10.0" },
  { element: "Cerrith", name: "Mana Transfer", itemId: "RUNE_OF_MANA_TRANSFER", socket: "Ascendant Rune", cooldown: "1.0 s", mana: "4.0", effect: "Toggle-type skill; the 1 s cooldown is deliberate" },
  { element: "Oseni", name: "Fire Shard", itemId: "RUNE_OF_FIRE_SHARD", socket: "Minor Rune", cooldown: "10.0 s", mana: "4.0", effect: "Damage 4.0" },
  { element: "Oseni", name: "Fire Breath", itemId: "RUNE_OF_FIRE_BREATH", socket: "Lesser Rune", cooldown: "15.0 s", mana: "4.0", effect: "Burn damage 3.0 over 2.0 s" },
  { element: "Oseni", name: "Oseni Glyph", itemId: "RUNE_OF_OSENI_GLYPH", socket: "Greater Rune", cooldown: "20.0 s", mana: "8.0", effect: "Lasts 8.0 s, damage 8.0" },
  { element: "Oseni", name: "Fire Rain", itemId: "RUNE_OF_FIRE_RAIN", socket: "Ascendant Rune", cooldown: "20.0 s", mana: "10.0", effect: "Damage 10.0" },
  { element: "Seithr", name: "Silencing Shard", itemId: "RUNE_OF_SILENCING_SHARD", socket: "Minor Rune", cooldown: "10.0 s", mana: "4.0", effect: "Lasts 4.0 s" },
  { element: "Seithr", name: "Ice Shard", itemId: "RUNE_OF_ICE_SHARD", socket: "Minor Rune", cooldown: "10.0 s", mana: "4.0", effect: "Lasts 4.0 s" },
  { element: "Seithr", name: "Ice Shield", itemId: "RUNE_OF_ICE_SHIELD", socket: "Lesser Rune", cooldown: "15.0 s", mana: "6.0", effect: "Shield for 10.0 s" },
  { element: "Seithr", name: "Ice Wave", itemId: "RUNE_OF_ICE_WAVE", socket: "Lesser Rune", cooldown: "15.0 s", mana: "6.0", effect: "Lasts 10.0 s" },
  { element: "Seithr", name: "Seithr Glyph", itemId: "RUNE_OF_SEITHR_GLYPH", socket: "Greater Rune", cooldown: "20.0 s", mana: "8.0", effect: "Lasts 8.0 s, freezes for 4.0 s" },
  { element: "Seithr", name: "Cold Embrace", itemId: "RUNE_OF_COLD_EMBRACE", socket: "Greater Rune", cooldown: "20.0 s", mana: "8.0", effect: "Lasts 8.0 s" },
  { element: "Seithr", name: "Frostveil", itemId: "RUNE_OF_FROSTVEIL", socket: "Ascendant Rune", cooldown: "20.0 s", mana: "10.0", effect: "Lasts 10.0 s" },
  { element: "Seithr", name: "Frozen Tomb", itemId: "RUNE_OF_FROZEN_TOMB", socket: "Ascendant Rune", cooldown: "20.0 s", mana: "10.0", effect: "Lasts 4.0 s, damage 10.0" },
];

// ---------- Weapon parts ----------

export type WeaponPart = {
  slot: "Core" | "Handle" | "Tome" | "Tome x3";
  name: string;
  cost: string;
  socket: string;
};

export const weaponParts: WeaponPart[] = [
  { slot: "Core", name: "Iron Magical Core", cost: "4x Iron Ingot + 4x Enchanted Dust", socket: "None" },
  { slot: "Core", name: "Steel Magical Core", cost: "4x Steel Ingot + 4x Enchanted Dust", socket: "None" },
  { slot: "Core", name: "Abyssalite Magical Core", cost: "4x Abyssalite Ingot + 4x Enchanted Dust", socket: "None" },
  { slot: "Core", name: "Mythril Magical Core", cost: "4x Mythril Ingot + 4x Enchanted Dust", socket: "None" },
  { slot: "Handle", name: "Oak Magical Handle", cost: "2x Stick + 2x Enchanted Dust", socket: "1x Minor Rune" },
  { slot: "Handle", name: "Basic Magical Handle", cost: "2x Stick + 4x Enchanted Dust", socket: "1x Lesser Rune" },
  { slot: "Handle", name: "Petty Magical Handle", cost: "2x Stick + 6x Enchanted Dust", socket: "1x Greater Rune" },
  { slot: "Handle", name: "Heavy Magical Handle", cost: "2x Stick + 8x Enchanted Dust", socket: "1x Ascendant Rune" },
  { slot: "Tome", name: "Simple Tome", cost: "2x Book", socket: "None: a mundane book with no effect" },
  { slot: "Tome", name: "Simple Magical Tome", cost: "2x Book + 2x Enchanted Dust", socket: "1x Minor Rune" },
  { slot: "Tome", name: "Basic Magical Tome", cost: "2x Book + 4x Enchanted Dust", socket: "1x Lesser Rune" },
  { slot: "Tome", name: "Petty Magical Tome", cost: "2x Book + 6x Enchanted Dust", socket: "1x Greater Rune" },
  { slot: "Tome", name: "Heavy Magical Tome", cost: "2x Book + 8x Enchanted Dust", socket: "1x Ascendant Rune" },
  { slot: "Tome x3", name: "Same five tome tiers", cost: "Identical costs", socket: "Identical sockets" },
];

// ---------- Enchanted Charges + the orb minigame ----------

export type ChargeTier = {
  tier: number;
  roman: string;
  itemId: string;
  auraCap: number;
  orbsLive: number;
  goodChance: string;
  speed: string;
  window: string;
  hitsNeeded: number;
};

export const chargeTiers: ChargeTier[] = [
  { tier: 1, roman: "I", itemId: "ENCHANTED_CHARGE_1", auraCap: 40, orbsLive: 4, goodChance: "75%", speed: "0.8x", window: "220 ticks (11.0 s)", hitsNeeded: 4 },
  { tier: 2, roman: "II", itemId: "ENCHANTED_CHARGE_2", auraCap: 75, orbsLive: 5, goodChance: "65%", speed: "1.0x", window: "200 ticks (10.0 s)", hitsNeeded: 5 },
  { tier: 3, roman: "III", itemId: "ENCHANTED_CHARGE_3", auraCap: 110, orbsLive: 6, goodChance: "55%", speed: "1.15x", window: "180 ticks (9.0 s)", hitsNeeded: 6 },
  { tier: 4, roman: "IV", itemId: "ENCHANTED_CHARGE_4", auraCap: 150, orbsLive: 8, goodChance: "45%", speed: "1.3x", window: "160 ticks (8.0 s)", hitsNeeded: 8 },
];

// ---------- Artifacts ----------

export type ArtifactRarity = {
  rarity: string;
  weight: number;
  chance: string;
  elements: string;
  primaryCap: string;
  adjectiveChance: string;
};

export const artifactRarities: ArtifactRarity[] = [
  { rarity: "Common", weight: 65, chance: "65%", elements: "1", primaryCap: "0-25 aura", adjectiveChance: "100%" },
  { rarity: "Uncommon", weight: 20, chance: "20%", elements: "1-2", primaryCap: "26-45 aura", adjectiveChance: "100%" },
  { rarity: "Rare", weight: 10, chance: "10%", elements: "1-2", primaryCap: "46-65 aura", adjectiveChance: "50%" },
  { rarity: "Epic", weight: 4, chance: "4%", elements: "1-3", primaryCap: "66-90 aura", adjectiveChance: "25%" },
  { rarity: "Legendary", weight: 1, chance: "1%", elements: "1-4", primaryCap: "91-150 aura", adjectiveChance: "15%" },
];

export type ArtifactElementWeight = {
  element: string;
  weight: number;
  primaryCaps: string;
  secondaryCaps: string;
};

export const artifactElementWeights: ArtifactElementWeight[] = [
  { element: "Cerrith", weight: 22, primaryCaps: "0-25 / 26-45 / 46-65 / 66-90 / 91-150", secondaryCaps: "0-18 / 18-32 / 32-48 / 48-70 / 70-110" },
  { element: "Seithr", weight: 18, primaryCaps: "0-25 / 26-45 / 46-65 / 66-90 / 91-150", secondaryCaps: "0-18 / 18-32 / 32-48 / 48-70 / 70-110" },
  { element: "Oseni", weight: 18, primaryCaps: "0-25 / 26-45 / 46-65 / 66-90 / 91-150", secondaryCaps: "0-18 / 18-32 / 32-48 / 48-70 / 70-110" },
  { element: "Mitlan", weight: 14, primaryCaps: "0-25 / 26-45 / 46-65 / 66-90 / 91-150", secondaryCaps: "0-18 / 18-32 / 32-48 / 48-70 / 70-110" },
  { element: "Bloodmagic", weight: 8, primaryCaps: "4-12 / 12-22 / 22-36 / 36-55 / 55-80", secondaryCaps: "2-6 / 5-10 / 8-14 / 12-20 / 16-28" },
  { element: "Necromancy", weight: 6, primaryCaps: "3-10 / 10-18 / 18-30 / 30-48 / 48-70", secondaryCaps: "2-5 / 4-8 / 6-12 / 10-16 / 12-22" },
  { element: "Spirit", weight: 5, primaryCaps: "2-6 / 6-12 / 12-22 / 22-36 / 36-55", secondaryCaps: "1-3 / 2-4 / 3-5 / 4-6 / 5-8" },
  { element: "Shadowmancy", weight: 4, primaryCaps: "2-7 / 7-14 / 14-24 / 24-40 / 40-60", secondaryCaps: "1-3 / 2-5 / 3-6 / 4-7 / 5-10" },
  { element: "Illusion", weight: 4, primaryCaps: "2-7 / 7-14 / 14-24 / 24-40 / 40-60", secondaryCaps: "1-3 / 2-5 / 3-6 / 4-7 / 5-10" },
  { element: "Arcanum", weight: 1, primaryCaps: "1-2 / 2-4 / 4-8 / 8-14 / 14-24", secondaryCaps: "1-1 / 1-2 / 1-2 / 1-3 / 1-3" },
];

// ---------- Equilibrium bands ----------

export type EquilibriumBand = {
  mode: "Surge (Corruption)" | "Flow (Tranquility)";
  at: string;
  mana: string;
  damage: string;
  cooldown: string;
};

export const equilibriumBands: EquilibriumBand[] = [
  { mode: "Surge (Corruption)", at: "0", mana: "0", damage: "0", cooldown: "0" },
  { mode: "Surge (Corruption)", at: "15", mana: "-5%", damage: "+10%", cooldown: "-10%" },
  { mode: "Surge (Corruption)", at: "60", mana: "-10%", damage: "+15%", cooldown: "-15%" },
  { mode: "Surge (Corruption)", at: "100", mana: "-5%", damage: "+10%", cooldown: "-10%" },
  { mode: "Flow (Tranquility)", at: "0", mana: "0", damage: "0", cooldown: "0" },
  { mode: "Flow (Tranquility)", at: "100", mana: "-20%", damage: "+25%", cooldown: "-5%" },
];

// ---------- Sacrifice rite ----------

export type SacrificeTier = {
  tier: string;
  fraction: string;
  aura: string;
  injury: string;
  lore: string;
};

export const sacrificeTiers: SacrificeTier[] = [
  { tier: "Nothing", fraction: "below 0.20", aura: "N/A", injury: "N/A", lore: "N/A" },
  { tier: "Wound", fraction: "0.20 – 0.40", aura: "20% of the artifact's cap", injury: "A healable injury", lore: '"Filled with the pain of {character}"' },
  { tier: "Maim", fraction: "0.40 – 1.0", aura: "55% of cap", injury: "Permanent injury", lore: '"Filled with the screams of {character}"' },
  { tier: "Death", fraction: "Full bar", aura: "100% of cap", injury: "PERMADEATH", lore: '"Filled with the soul of {character}"' },
];

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
        'Permission magic.use, default true: every player already has it. Needs an active RP character, otherwise: "You need an active character to view resonance."',
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
    blurb:
      "Mage weapon parts, spell runes and shrines; attunement is blocked by missing charge sources.",
    draft: true,
  },
  recipes: magicRecipes,
  commands: magicCommands,
};

export const shrineFamilies = {
  "columns": [
    "Element",
    "Families (max_count, weight)",
    "Block highlights"
  ],
  "rows": [
    [
      "cerrith",
      "floor(12,1.0), water(4,1.2), grass(10,1.0), grove(10,1.0), flowers(8,0.9), crops(8,0.9), bushes(6,1.0), moss(8,0.8), firefly(1, weight 6.0)",
      "Grass/moss/podzol/rooted dirt; water; short & tall grass, ferns, moss carpet; azalea + leaves/saplings tag; small & tall flowers, spore blossom, pink petals, cave vines, wildflowers, leaf litter; crops tag + sugar cane/pumpkin/melon; sweet berry bush/bush/dead bush; mossy cobblestone & stone bricks. A single FIREFLY_BUSH carries weight 6.0: by far the most efficient cerrith block."
    ],
    [
      "oseni",
      "lava(6,1.4), hearth(10,1.1), metal(8,0.9), kiln(10,0.8)",
      "Lava; magma block, netherrack, basalt, smooth basalt, blackstone, campfire, furnace, blast furnace, smoker; copper block, raw copper block, cut copper, coal block/ore/deepslate coal ore; orange & red terracotta (plain and glazed), plain terracotta, nether bricks, red nether bricks."
    ],
    [
      "seithr",
      "lava(6,1.2), ice(14,1.2), pale(10,0.9)",
      "Lava (shared with oseni); the ice block tag + snow, snow block, powder snow; calcite, quartz block/pillar/smooth quartz, white concrete, white wool."
    ],
    [
      "mitlan",
      "water(8,1.3), sea(12,1.0), silt(10,0.9), dead_reef(10,1.1)",
      "Water/bubble column; kelp, seagrass, prismarine family, sea lantern, conduit; mud, muddy mangrove roots, packed mud, clay, wet sponge; all fifteen dead coral blocks/corals/fans."
    ],
    [
      "arcanum (inert)",
      "study(16,1.1), amethyst(10,1.0), ley(6,1.2)",
      "Bookshelf, chiseled bookshelf, lectern, enchanting table; amethyst block, budding amethyst, all bud sizes, cluster; ender chest, end rod, lodestone, crying obsidian, respawn anchor, brewing stand."
    ],
    [
      "spirit (inert)",
      "soul_light(8,1.2), soul_ground(6,0.6), cherry(12,0.9), pale_light(8,1.0)",
      "Soul lantern/torch/wall torch/campfire; soul sand & soil; cherry leaves/log/wood/stripped log/sapling, pink petals; sea lantern, all three froglights, quartz pillar."
    ],
    [
      "illusion (inert)",
      "glass(16,1.0), chorus(10,1.1), glaze(12,0.9), lichen(8,0.7)",
      "Glass, glass pane, tinted glass, white & black stained glass + pane; chorus plant/flower, purpur block/pillar; white, light blue, magenta, pink, purple, cyan glazed terracotta; glow lichen."
    ],
    [
      "necromancy (inert)",
      "grave(10,1.1), marrow(8,1.2), sculk(8,0.7), web(8,0.8)",
      "Soul sand & soil; bone block, skeleton & wither skeleton skull, wither rose; sculk, catalyst, sensor, shrieker, calibrated sensor; cobweb, deepslate tiles/tile slab/bricks."
    ],
    [
      "shadowmancy (inert)",
      "heavy(12,1.1), dusk_wood(12,0.9), veil(8,0.6), wart(8,0.8)",
      "Blackstone family, obsidian, crying obsidian; dark oak + mangrove logs/wood/leaves/planks/roots; sculk vein, tinted glass, black candle & candle cake, black wool & concrete; nether wart block, warped wart block, warped nylium."
    ],
    [
      "bloodmagic",
      "redstone(4,0.5), nether(max-count typo,1.0), nether_decor(max-count typo,1.0), wart(8,1.0), crimson(12,1.1), cloth(8,0.7)",
      "Redstone block/ore/deepslate ore/wire; nether brick family + crimson stem/hyphae, crimson nylium, netherrack; weeping vines, crimson fungus, crimson roots; nether wart & wart block; red wool, red concrete, red candle, campfire."
    ]
  ]
};
