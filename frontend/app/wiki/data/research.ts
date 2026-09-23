import type { WikiCommandSet, WikiSection } from "./types";

// Source: https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/docs/wiki-research/a-magic-knowledge.md, section 2.
export const paperRecipes = {
  "columns": [
    "Recipe id",
    "Produces",
    "Second ingredient"
  ],
  "rows": [
    [
      "r-ignitium",
      "R_IGNITIUM",
      "Ignitium"
    ],
    [
      "r-bronze",
      "R_BRONZE",
      "Bronze Ingot"
    ],
    [
      "r-abyssalite-fragment / r-abyssalite-ingot",
      "R_ABYSSALITE",
      "Abyssalite Fragment or Abyssalite Ingot"
    ],
    [
      "r-mythril / r-mythrilite / r-mythril-ingot",
      "R_MYTHRIL",
      "Mythril Fragment or Mythrilite or Mythril Ingot"
    ],
    [
      "r-elderwood / r-refined-elderwood",
      "R_ELDERWOOD",
      "Elderwood or Refined Elderwood"
    ],
    [
      "r-demonwood / r-refined-demonwood",
      "R_DEMONWOOD",
      "Demonwood or Refined Demonwood"
    ],
    [
      "r-enchanted-dust",
      "R_ENCHANTED_DUST",
      "Enchanted Dust"
    ],
    [
      "r-arcane-crystal",
      "R_ARCANE_CRYSTAL",
      "Arcane Crystal"
    ],
    [
      "r-gunpowder",
      "R_GUNPOWDER",
      "vanilla Gunpowder"
    ],
    [
      "r-silver-denar-1/5/10, r-gold-denar-1/5/10/100",
      "R_DENAR",
      "Silver Denar, Handful/Stack of Silver Denars, Gold Denar, Handful/Stack/Pouch of Gold Denars"
    ],
    [
      "r-runestone1/2/3/4",
      "R_RUNESTONE",
      "Sword Runestone or Wand Runestone or Staff Runestone or Armor Runestone"
    ],
    [
      "r-infusion",
      "R_INFUSION",
      "Infusion Ticket (LOOT:INFUSION_TOKEN)"
    ],
    [
      "r-rare-research-paper",
      "RARE_RESEARCH_PAPER",
      "Lost Knowledge Fragment: 15 s craft"
    ]
  ]
};

export const aspects = {
  "columns": [
    "Aspect id",
    "Display name",
    "Hex",
    "Lore hint",
    "Primary items",
    "Secondary items"
  ],
  "rows": [
    [
      "air",
      "Air",
      "#FCE65C",
      "Wind, Sky, Varden",
      "3",
      "26"
    ],
    [
      "arcane",
      "Arcane",
      "#7702E0",
      "Reality, The Cosmos, Arcanum",
      "4",
      "10"
    ],
    [
      "beast",
      "Beast",
      "#6E4C2A",
      "Animal, Humanoid, Monster",
      "54",
      "73"
    ],
    [
      "blood",
      "Blood",
      "#691515",
      "Flesh, Vampirism, Blood Magic",
      "10",
      "15"
    ],
    [
      "conflict",
      "Conflict",
      "#871616",
      "Weapon, Offense, War",
      "99",
      "27"
    ],
    [
      "creation",
      "Creation",
      "#FCA239",
      "Construction, Repair, Tool",
      "317",
      "150"
    ],
    [
      "darkness",
      "Darkness",
      "#171717",
      "No Light, Black, Night",
      "14",
      "22"
    ],
    [
      "death",
      "Death",
      "#292929",
      "Remains, Decay, Disease",
      "91",
      "18"
    ],
    [
      "earth",
      "Earth",
      "#4D3828",
      "Rock, Crystal, Metora",
      "337",
      "28"
    ],
    [
      "energy",
      "Energy",
      "#87CDFC",
      "Power, Strength, Potential",
      "12",
      "41"
    ],
    [
      "entropy",
      "Entropy",
      "#2B2D2F",
      "Chaos, Destruction, Damage",
      "22",
      "53"
    ],
    [
      "exchange",
      "Exchange",
      "#EFF0E2",
      "Conversion, Mutation, Alchemy",
      "16",
      "46"
    ],
    [
      "fire",
      "Fire",
      "#F76F2D",
      "Heat, Burning, Osenis",
      "12",
      "62"
    ],
    [
      "ice",
      "Ice",
      "#73E4FC",
      "Cold, Frost, Seithrin",
      "8",
      "5"
    ],
    [
      "knowledge",
      "Knowledge",
      "#2758C4",
      "Wisdom, Information, Learning",
      "26",
      "54"
    ],
    [
      "life",
      "Life",
      "#C03131",
      "Health, Vitality, Healing",
      "23",
      "68"
    ],
    [
      "light",
      "Light",
      "#FCEDC0",
      "Luminosity, White, Day",
      "52",
      "20"
    ],
    [
      "machine",
      "Machine",
      "#BF5935",
      "Technology, Device, Mechanism",
      "24",
      "40"
    ],
    [
      "magic",
      "Magic",
      "#42114E",
      "Mana, Spellcraft, Sorcery",
      "22",
      "99"
    ],
    [
      "metal",
      "Metal",
      "#99A2B7",
      "Alloy, Ingot, Ore",
      "120",
      "242"
    ],
    [
      "nature",
      "Nature",
      "#2D9E37",
      "Plant, Greenery, Cerrith",
      "350",
      "147"
    ],
    [
      "necromancy",
      "Necromancy",
      "#052830",
      "Undeath, Corruption, Necromantic Magic",
      "13",
      "21"
    ],
    [
      "order",
      "Order",
      "#DAD4CC",
      "Balance, Control, Organization",
      "125",
      "119"
    ],
    [
      "protection",
      "Protection",
      "#62656D",
      "Armour, Defense, Safety",
      "137",
      "81"
    ],
    [
      "sensation",
      "Sensation",
      "#C561B7",
      "Perception, Emotion, Illusion Magic",
      "81",
      "168"
    ],
    [
      "spirit",
      "Spirit",
      "#6BFC00",
      "Soul, Essence, Spiritual Magic",
      "4",
      "48"
    ],
    [
      "sustenance",
      "Sustenance",
      "#76B437",
      "Food, Drink, Hunger",
      "131",
      "124"
    ],
    [
      "time",
      "Time",
      "#3204EE",
      "Moment, Season, Era",
      "3",
      "17"
    ],
    [
      "void",
      "Void",
      "#000000",
      "Vacuum, Nonexistence, Shadow Magic",
      "4",
      "11"
    ],
    [
      "water",
      "Water",
      "#23B78C",
      "Ocean, Fluid, Mitlan",
      "20",
      "75"
    ],
    [
      "wealth",
      "Wealth",
      "#FCC25F",
      "Value, Rarity, Treasure",
      "43",
      "44"
    ]
  ]
};

export const ordinaryProjects = {
  "columns": [
    "Paper you craft",
    "Project",
    "Aspects and required points",
    "Total pts",
    "Product revealed after N confirmed",
    "Reward item"
  ],
  "rows": [
    [
      "R_ABYSSALITE",
      "Abyssalite",
      "necromancy 2, metal 3, wealth 3, creation 2",
      "10",
      "7",
      "c_abyssalite (Completed Thesis)"
    ],
    [
      "R_ALCHEMY",
      "Alchemy",
      "knowledge 2, order 2, exchange 4, creation 2",
      "10",
      "7",
      "c_alchemy"
    ],
    [
      "R_ARCANE_CRYSTAL",
      "Arcane Crystal",
      "arcane 3, earth 3, energy 2, machine 2",
      "10",
      "7",
      "c_arcane_crystal"
    ],
    [
      "R_BRONZE",
      "Bronze",
      "machine 2, metal 4, creation 4",
      "10",
      "6",
      "c_bronze"
    ],
    [
      "R_DEMONWOOD",
      "Demonwood",
      "blood 2, nature 4, fire 2",
      "8",
      "6",
      "r_demonwood (starting paper, not a thesis; broken reward)"
    ],
    [
      "R_DENAR",
      "Denar",
      "wealth 5, metal 3, order 2",
      "10",
      "6",
      "c_denar"
    ],
    [
      "R_ELDERWOOD",
      "Elderwood",
      "nature 4, time 2, arcane 2, knowledge 2",
      "10",
      "7",
      "c_elderwood"
    ],
    [
      "R_ENCHANTED_DUST",
      "Enchanted Dust",
      "time 2, magic 4, entropy 2, creation 2",
      "10",
      "7",
      "c_enchanted_dust"
    ],
    [
      "R_GUNPOWDER",
      "Gunpowder",
      "entropy 3, energy 3, exchange 2, conflict 2",
      "10",
      "7",
      "c_gunpowder"
    ],
    [
      "R_IGNITIUM",
      "Ignitium",
      "exchange 2, fire 4, earth 4",
      "10",
      "6",
      "c_ignitium"
    ],
    [
      "R_INFUSION",
      "Infusion",
      "spirit 2, magic 3, earth 2, nature 3",
      "10",
      "7",
      "c_infusion"
    ],
    [
      "R_MYTHRIL",
      "Mythril",
      "magic 2, metal 3, wealth 3, time 2",
      "10",
      "7",
      "c_mythril"
    ],
    [
      "R_RUNESTONE",
      "Runestone",
      "exchange 3, magic 4, wealth 3",
      "10",
      "3",
      "c_runestone"
    ],
    [
      "R_TRACE_DETECTION",
      "Trace Detection",
      "arcane 3, knowledge 2, wealth 3, machine 2",
      "10",
      "7",
      "c_trace_detection"
    ]
  ]
};

export const staffProject = {
  "columns": [
    "Input item",
    "Project",
    "Aspects",
    "Total",
    "Reveal after",
    "Reward"
  ],
  "rows": [
    [
      "m.loot.staff_runestone (Staff Runestone, the raw loot item, not a paper)",
      "staff_runestone",
      "entropy 4, fire 3, arcane 2",
      "9",
      "2",
      "template t.runestones"
    ]
  ]
};

export const runeResults = {
  "columns": [
    "Result",
    "Weight",
    "Chance"
  ],
  "rows": [
    [
      "m.seithr_runes.rune_of_ice_shard: Ice Shard (Seithr, Minor Rune)",
      "1.0",
      "50%"
    ],
    [
      "m.oseni_runes.rune_of_fire_breath: Fire Breath (Oseni, Lesser Rune)",
      "1.0",
      "50%"
    ]
  ]
};

export const rareProjects = {
  "columns": [
    "Project",
    "Weight",
    "Chance",
    "Aspects and required points",
    "Total pts",
    "Reveal after",
    "Reward"
  ],
  "rows": [
    [
      "The Cervalic Order",
      "1.1",
      "8.2%",
      "order 4, knowledge 6, arcane 5, conflict 3",
      "18",
      "3",
      "cr_the_cervalic_order"
    ],
    [
      "Mitlan, the Water Plane",
      "1.1",
      "8.2%",
      "water 7, entropy 5, conflict 5, time 3",
      "20",
      "3",
      "cr_mitlan_the_water_plane"
    ],
    [
      "The Reclamation",
      "1.1",
      "8.2%",
      "protection 4, nature 4, order 4, time 4",
      "16",
      "3",
      "cr_the_reclamation"
    ],
    [
      "Vestanger",
      "1.1",
      "8.2%",
      "creation 5, wealth 7, sustenance 3, earth 3",
      "18",
      "3",
      "cr_vestanger"
    ],
    [
      "The Petty Mage Guild",
      "1.0",
      "7.5%",
      "sensation 2, knowledge 4, magic 4, entropy 3",
      "13",
      "3",
      "cr_the_petty_mage_guild"
    ],
    [
      "The Imperial Arcane Academy",
      "1.0",
      "7.5%",
      "arcane 4, knowledge 4, magic 4",
      "12",
      "2",
      "cr_the_imperial_arcane_academy"
    ],
    [
      "The Oseni Loyalists",
      "1.0",
      "7.5%",
      "conflict 4, fire 4, entropy 4",
      "12",
      "2",
      "cr_the_oseni_loyalists"
    ],
    [
      "Seithr Essence",
      "1.0",
      "7.5%",
      "exchange 3, water 3, sustenance 3, ice 3",
      "12",
      "3",
      "cr_seithr_essence"
    ],
    [
      "Malice Crawlers",
      "1.0",
      "7.5%",
      "beast 3, necromancy 5, conflict 3",
      "11",
      "2",
      "cr_malice_crawlers"
    ],
    [
      "The Crown of Servitude",
      "1.0",
      "7.5%",
      "spirit 3, wealth 3, necromancy 3, order 3",
      "12",
      "3",
      "cr_the_crown_of_servitude"
    ],
    [
      "Arcane Instability",
      "1.0",
      "7.5%",
      "arcane 5, entropy 4, exchange 4",
      "13",
      "2",
      "cr_arcane_instability"
    ],
    [
      "Arcanum Fever",
      "1.0",
      "7.5%",
      "arcane 5, death 5, exchange 3",
      "13",
      "2",
      "cr_arcanum_fever"
    ],
    [
      "The Decarian Wasteland",
      "1.0",
      "7.5%",
      "void 2, arcane 4, entropy 4, earth 2",
      "12",
      "3",
      "cr_the_decarian_wasteland"
    ]
  ]
};

export const decarianProject = {
  "columns": [
    "Declared input",
    "Project",
    "Aspects",
    "Total",
    "Reveal after",
    "Reward"
  ],
  "rows": [
    [
      "m.research.r_ (the generic Research Paper template)",
      "decarian_codex",
      "destruction 6, fire 3, arcanum 4",
      "13",
      "2",
      "c_arcane_crystal"
    ]
  ]
};

export const researchTables = [{ title: "Paper recipes", ...paperRecipes },{ title: "All 31 aspects", ...aspects },{ title: "Ordinary projects", ...ordinaryProjects },{ title: "Raw Staff Runestone project", ...staffProject },{ title: "Staff Runestone rewards", ...runeResults },{ title: "Unknown Research Paper projects", ...rareProjects },{ title: "Broken Decarian Codex project", ...decarianProject }];
export const researchCommands: WikiCommandSet = { system: "Research", href: "/wiki/research", commands: [], excludedStaffCommands: ["/research reload"] };
export const researchSection: WikiSection = { nav: { href: "/wiki/research", label: "Research", category: "magic", blurb: "Deduce hidden aspects at a lectern; paper recipes, project requirements and known reward blockers.", draft: true }, commands: researchCommands };
