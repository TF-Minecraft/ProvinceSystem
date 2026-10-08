import type { WikiCommandSet, WikiSection } from "./types";

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
export const researchCommands: WikiCommandSet = { system: "Research", href: "/wiki/research", commands: [], excludedStaffCommands: ["/research reload"] };
export const researchSection: WikiSection = { nav: { href: "/wiki/research", label: "Research", category: "magic", blurb: "Deduce hidden aspects at a lectern; paper recipes and project requirements." }, commands: researchCommands };
