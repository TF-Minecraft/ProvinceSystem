import { V } from "./helpers";
import { stationRecipe } from "./station-recipes";
import type { Recipe, Slot, WikiCommandSet, WikiSection } from "./types";
// Recipe source: live MMOItems crafting-station config. Player-flow source:
// the user-supplied Archaeo gameplay guide (September 2026).

const item = (name: string, texture: string, qty = 1): Slot => ({ name, qty, texture: V(texture) });

/** Crafted at a vanilla Crafting Table, not at a station: it has no server-config counterpart. */
export const archeologyTableRecipe: Recipe = { key:"archeology-table", title:"Archeology Table", station:"Crafting Table", ingredients:[item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png"),item("Bone","bone.png"),item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png")], output:{name:"Archeology Table",qty:1,sourceId:"itemsadder:archeology_station",model:{url:"/wiki/models/archeology-station.json",texture:"/wiki/textures/stations/archeology-station.png"}}};

/**
 * The table plus the twelve workshop recipes.
 *
 * The workshop recipes used to be hand-written here under the wiki's own names
 * (Field Compass, Soil Probe, Camp Kit, Field Pencil). They now come from the
 * server's `archeology-station.yml` (see `data/generated/stationRecipes.ts`),
 * which is authoritative; only the table above is still hand-written, and only
 * it is registered by this section. The rest are registered by `stationsSection`.
 */
export const archaeologyRecipes: Recipe[] = [
  archeologyTableRecipe,
  ...[
    "archaeo-tracker",
    "archaeo-prospect",
    "archaeo-establish",
    "archaeo-pencil",
    "field-brush",
    "archeology-knife",
    "archeology-spoon",
    "archeology-handpick",
    "archeology-trowel",
    "archeology-pick",
    "archeology-shovel",
    "archeology-cabinet",
  ].map((key) => stationRecipe(`gen-archeology-station-${key}`)),
];
export const digProfiles = {
  "columns": [
    "Profile",
    "Items (MMOItems id \u2192 vanilla base \u2192 display name)",
    "Ready lift",
    "Late lift",
    "Shape",
    "Workday cost"
  ],
  "rows": [
    [
      "hand",
      "AIR (empty hand)",
      "1",
      "1",
      "down",
      "1"
    ],
    [
      "light",
      "HAND_PICK \u2192 Wooden Pickaxe \u2192 Hand Pick (<#c2b280>); POINTING_TROWEL \u2192 Wooden Shovel \u2192 Pointing Trowel",
      "1",
      "2",
      "down",
      "1"
    ],
    [
      "heavy",
      "MATTOCK \u2192 Stone Pickaxe \u2192 Mattock (<#8b6914>); GRAFTING_SPADE \u2192 Stone Shovel \u2192 Grafting Spade",
      "2",
      "4",
      "around (3x3x2, face-connected)",
      "1"
    ],
    [
      "super-heavy",
      "BREAKER_PICK \u2192 Iron Pickaxe \u2192 Breaker Pick (<#7f7d80>); SPOIL_SHOVEL \u2192 Iron Shovel \u2192 Spoil Shovel",
      "4",
      "8",
      "random (same 3x3x2, extras picked at random among faces)",
      "1"
    ]
  ]
};
export const labTools = {
  "columns": [
    "Tool",
    "Item",
    "Display",
    "Description",
    "Sound"
  ],
  "rows": [
    [
      "water",
      "WATER_BUCKET",
      "Water",
      "\"Washes mineral crust from ceramic and stone. Do not soak metal.\"",
      "ITEM_BUCKET_EMPTY"
    ],
    [
      "brush",
      "BRUSH",
      "Brush",
      "\"Dry-cleans rust and soil. Safe on metal and bone.\"",
      "ITEM_BRUSH_BRUSHING_GENERIC"
    ],
    [
      "air",
      "FEATHER",
      "Air",
      "\"Dries mud on organic finds. Do not wet these pieces.\"",
      "ITEM_BRUSH_BRUSHING_SAND"
    ]
  ]
};
export const labStains = {
  "columns": [
    "Stain",
    "Display",
    "Pane",
    "Correct tool"
  ],
  "rows": [
    [
      "limescale",
      "Limescale",
      "ORANGE_STAINED_GLASS_PANE",
      "water"
    ],
    [
      "soil",
      "Soil",
      "BROWN_STAINED_GLASS_PANE",
      "brush"
    ],
    [
      "rust",
      "Rust",
      "RED_STAINED_GLASS_PANE",
      "brush"
    ],
    [
      "mud",
      "Mud",
      "BROWN_STAINED_GLASS_PANE",
      "air"
    ]
  ]
};
export const interestLevels = {
  "columns": [
    "Level",
    "Base wealth",
    "Variation",
    "Detection radius",
    "Finds",
    "Hints",
    "Stratum IV chance",
    "Disturbed chance"
  ],
  "rows": [
    [
      "low",
      "1",
      "0",
      "64",
      "3-5",
      "2",
      "0 %",
      "15 %"
    ],
    [
      "medium",
      "3",
      "1",
      "128",
      "5-8",
      "3",
      "25 %",
      "20 %"
    ],
    [
      "high",
      "6",
      "1",
      "256",
      "8-12",
      "3",
      "60 %",
      "25 %"
    ],
    [
      "exceptional",
      "10",
      "2",
      "512",
      "12-18",
      "4",
      "100 %",
      "30 %"
    ]
  ]
};
export const strata = {
  "columns": [
    "Id",
    "Order",
    "Display name",
    "Depth below datum",
    "Always present"
  ],
  "rows": [
    [
      "I",
      "1",
      "Recent layer",
      "0-4",
      "yes"
    ],
    [
      "II",
      "2",
      "Layer II",
      "5-9",
      "yes"
    ],
    [
      "III",
      "3",
      "Layer III",
      "10-14",
      "yes"
    ],
    [
      "IV",
      "4",
      "Deep layer",
      "15-19",
      "No; depends on the site interest chance"
    ]
  ]
};
export const findMaterials = {
  "columns": [
    "Material",
    "Display",
    "Survival",
    "Clean pane",
    "Possible stains"
  ],
  "rows": [
    [
      "ceramic",
      "Ceramic",
      "0.95",
      "WHITE_STAINED_GLASS_PANE",
      "limescale, soil"
    ],
    [
      "metal",
      "Metal",
      "0.85",
      "GRAY_STAINED_GLASS_PANE",
      "rust"
    ],
    [
      "bone",
      "Bone",
      "0.80",
      "WHITE_STAINED_GLASS_PANE",
      "soil"
    ],
    [
      "organic",
      "Organic",
      "0.70",
      "LIME_STAINED_GLASS_PANE",
      "mud"
    ],
    [
      "stone",
      "Stone",
      "1.00",
      "LIGHT_GRAY_STAINED_GLASS_PANE",
      "limescale"
    ]
  ]
};
export const buriedArtifacts = {
  "columns": [
    "Id",
    "Display",
    "Size (cells)",
    "Material",
    "Rarity",
    "Weight",
    "Strata",
    "Tags",
    "Drops as",
    "Profile"
  ],
  "rows": [
    [
      "pottery_sherd",
      "Pottery sherd",
      "1",
      "ceramic",
      "common",
      "24",
      "I, II, III, IV",
      "ceramic, settlement",
      "BRICK",
      "object"
    ],
    [
      "coin",
      "Coin",
      "1",
      "metal",
      "common",
      "22",
      "I, II, III",
      "trade, metal",
      "GOLD_NUGGET",
      "object"
    ],
    [
      "charcoal",
      "Fire remains",
      "1-2",
      "organic",
      "common",
      "16",
      "I, II, III",
      "fire, domestic",
      "CHARCOAL",
      "object"
    ],
    [
      "tool",
      "Tool",
      "2-3",
      "metal",
      "uncommon",
      "14",
      "II, III",
      "settlement, metal",
      "IRON_HOE",
      "object"
    ],
    [
      "vessel",
      "Vessel",
      "3-6",
      "ceramic",
      "uncommon",
      "10",
      "I, II, III",
      "ceramic, ceremonial, deposit",
      "DECORATED_POT",
      "object"
    ],
    [
      "faunal_dump",
      "Animal remains",
      "3-8",
      "bone",
      "uncommon",
      "10",
      "I, II, III",
      "bone, food, animal",
      "BONE",
      "animal"
    ],
    [
      "ornament",
      "Ornament",
      "1-2",
      "metal",
      "uncommon",
      "8",
      "II, III",
      "ceremonial, trade, ornament",
      "GOLD_INGOT",
      "object"
    ],
    [
      "sword",
      "Ancient sword",
      "3-5",
      "metal",
      "rare",
      "6",
      "II, III, IV",
      "conflict, metal, blade",
      "IRON_SWORD",
      "object"
    ],
    [
      "burial",
      "Burial",
      "8-15",
      "bone",
      "rare",
      "4",
      "III, IV",
      "burial, bone",
      "BONE",
      "individual"
    ]
  ]
};
export const studyNotes = {
  "columns": [
    "Artifact",
    "Study note"
  ],
  "rows": [
    [
      "Coin",
      "\"A small struck disc. The face is worn; a mint or a portrait may still be read.\""
    ],
    [
      "Pottery sherd",
      "\"A body sherd. The fabric and any surviving slip say more than the shape.\""
    ],
    [
      "Tool",
      "\"A working edge, not an ornament. Wear on the bit points to repeated use.\""
    ],
    [
      "Ancient sword",
      "\"A blade with little domestic assemblage around it. The fuller and tang still read as a weapon.\""
    ],
    [
      "Vessel",
      "\"A closed form. Surviving rim and decoration suggest it was set down, not discarded in pieces.\""
    ],
    [
      "Burial",
      "\"Articulated bone, not kitchen scatter. The layout still argues for a grave.\""
    ],
    [
      "Animal remains",
      "\"Disarticulated bone with kitchen scatter. This looks like refuse, not a grave.\""
    ],
    [
      "Fire remains",
      "\"Charred wood and ash. Repeated burning at this depth looks domestic, not a single pyre.\""
    ],
    [
      "Ornament",
      "\"A small decorative piece. The metal does not match the cheapest local work.\""
    ]
  ]
};
export const siteHints = {
  "columns": [
    "Id",
    "Text shown to the player",
    "Weight",
    "Requires"
  ],
  "rows": [
    [
      "empty_iv",
      "\"The deepest level is not preserved.\"",
      "12",
      "Stratum IV missing"
    ],
    [
      "fire_multi",
      "\"Traces of fire or charcoal at more than one depth.\"",
      "10",
      "a fire tag; at least 2 strata"
    ],
    [
      "pots_metal",
      "\"Vessel fragments found together with metal.\"",
      "10",
      "both ceramic and metal tags"
    ],
    [
      "clustered",
      "\"The remains appear clustered, not scattered.\"",
      "8",
      "wealth 3 or more"
    ],
    [
      "scattered",
      "\"The remains are widely scattered across the layer.\"",
      "8",
      "wealth 3 or less"
    ],
    [
      "bone",
      "\"There is more bone than tool.\"",
      "8",
      "a bone or burial tag"
    ],
    [
      "blade",
      "\"A blade or weapon, little domestic assemblage.\"",
      "8",
      "a blade or conflict tag"
    ],
    [
      "ornament",
      "\"Small ornamental pieces.\"",
      "7",
      "an ornament or ceremonial tag"
    ],
    [
      "mixed_layer",
      "\"One depth is mixed compared with the others.\"",
      "6",
      "a disturbed band"
    ],
    [
      "recent_interrupt",
      "\"The upper layer cuts into those below.\"",
      "6",
      "strata I and III both present"
    ],
    [
      "trade",
      "\"Materials that do not quite fit this setting.\"",
      "6",
      "a trade tag"
    ],
    [
      "seed_grain",
      "\"Seeds or grain in the soil.\"",
      "5",
      "a food tag"
    ],
    [
      "unknown",
      "\"The assemblage does not suggest a clear use.\"",
      "4",
      "wealth 3 or less"
    ]
  ]
};
export const hintReadings = {
  "columns": [
    "Hint",
    "What it tells you"
  ],
  "rows": [
    [
      "\"The deepest level is not preserved.\"",
      "No Stratum IV: do not dig past ~14 blocks below datum"
    ],
    [
      "\"A blade or weapon...\"",
      "There is a sword (3-5 cells, can reach IV)"
    ],
    [
      "\"There is more bone than tool.\"",
      "There is a burial (8-15 cells) or faunal_dump"
    ],
    [
      "\"Small ornamental pieces.\"",
      "ornament or vessel: small, easy to punch through"
    ],
    [
      "\"Materials that do not quite fit this setting.\"",
      "coin or ornament"
    ],
    [
      "\"Seeds or grain in the soil.\"",
      "faunal_dump (the only food-tagged artifact)"
    ],
    [
      "\"One depth is mixed compared with the others.\"",
      "A disturbed band: -10 conservation on anything in it"
    ],
    [
      "\"The remains appear clustered / scattered\"",
      "wealth above / below 3, i.e. roughly interest level"
    ]
  ]
};
export const conservationGrades = {
  "columns": [
    "Grade id",
    "Label",
    "Minimum %"
  ],
  "rows": [
    [
      "intact",
      "Intact",
      "92"
    ],
    [
      "sound",
      "Sound",
      "72"
    ],
    [
      "worn",
      "Worn",
      "48"
    ],
    [
      "fragmentary",
      "Fragmentary",
      "24"
    ],
    [
      "crumbling",
      "Crumbling",
      "1"
    ]
  ]
};
export const interpretationProfiles = {
  "columns": [
    "Profile",
    "Question order"
  ],
  "rows": [
    [
      "object (7 of 9 artifacts)",
      "Function \u2192 Formation \u2192 Epoch"
    ],
    [
      "individual (burial)",
      "Species \u2192 Deposit \u2192 Epoch"
    ],
    [
      "animal (faunal_dump)",
      "Species \u2192 Deposit \u2192 Epoch"
    ]
  ]
};
export const functionReadings = {
  "columns": [
    "Option",
    "Phrase shown",
    "Suggested by tags",
    "Guaranteed for"
  ],
  "rows": [
    [
      "combat_edge",
      "\"combat edge\"",
      "blade, conflict",
      "sword"
    ],
    [
      "working_tool",
      "\"working tool\"",
      "settlement, domestic",
      "tool"
    ],
    [
      "vessel",
      "\"vessel or container\"",
      "ceramic, deposit",
      "vessel, pottery_sherd"
    ],
    [
      "ornament",
      "\"ornament\"",
      "ceremonial, ornament, trade",
      "ornament, coin"
    ],
    [
      "grave_good",
      "\"object made to accompany a body\"",
      "burial, bone",
      "ornament, vessel"
    ],
    [
      "unknown_function",
      "\"function unknown\"",
      "unknown",
      "charcoal"
    ]
  ]
};
export const formationReadings = {
  "columns": [
    "Option",
    "Phrase shown",
    "Suggested by tags",
    "Guaranteed for"
  ],
  "rows": [
    [
      "discarded",
      "\"thrown away\"",
      "abandonment, scattered, domestic",
      "pottery_sherd, tool, charcoal"
    ],
    [
      "cached",
      "\"hidden or cached\"",
      "deposit, clustered",
      "coin, ornament, vessel, sword"
    ],
    [
      "with_a_body",
      "\"laid with a body\"",
      "burial, bone",
      "ornament"
    ],
    [
      "trade_in",
      "\"brought in by trade\"",
      "trade",
      "coin"
    ],
    [
      "washed_in",
      "\"washed or slumped in\"",
      "unknown",
      "pottery_sherd, charcoal"
    ],
    [
      "unknown_path",
      "\"how it arrived is unknown\"",
      "unknown",
      ":"
    ]
  ]
};
export const epochReadings = {
  "columns": [
    "Option",
    "Phrase shown",
    "Suggested by tags",
    "Guaranteed for"
  ],
  "rows": [
    [
      "recent_occupation",
      "\"recent occupation\"",
      ":",
      ":"
    ],
    [
      "era_of_ash",
      "\"Era of Ash\"",
      ":",
      ":"
    ],
    [
      "third_exodus",
      "\"Third Exodus\"",
      ":",
      ":"
    ],
    [
      "older_heirloom",
      "\"older than this burial; left later\"",
      "burial, deposit",
      "burial"
    ],
    [
      "deep_time",
      "\"a much older time\"",
      ":",
      ":"
    ],
    [
      "unknown_epoch",
      "\"epoch unknown\"",
      "unknown",
      ":"
    ]
  ]
};
export const speciesReadings = {
  "columns": [
    "Option",
    "Phrase",
    "Profile",
    "Suggested by",
    "Guaranteed for"
  ],
  "rows": [
    [
      "homo_sapiens",
      "\"Homo sapiens\"",
      "individual",
      "burial, bone",
      "burial"
    ],
    [
      "neanderthal",
      "\"Neanderthal\"",
      "individual",
      "burial, bone",
      ":"
    ],
    [
      "denisovan",
      "\"Denisovan\"",
      "individual",
      "burial",
      ":"
    ],
    [
      "archaic_human",
      "\"archaic human\"",
      "individual",
      "burial, bone",
      ":"
    ],
    [
      "unidentified_individual",
      "\"unidentified individual\"",
      "individual",
      "unknown, bone",
      ":"
    ],
    [
      "dog",
      "\"dog\"",
      "animal",
      "animal, bone",
      ":"
    ],
    [
      "cattle",
      "\"cattle\"",
      "animal",
      "food, animal",
      "faunal_dump"
    ],
    [
      "sheep_or_goat",
      "\"sheep or goat\"",
      "animal",
      "food, animal",
      ":"
    ],
    [
      "deer",
      "\"deer\"",
      "animal",
      "food, bone",
      ":"
    ],
    [
      "horse",
      "\"horse\"",
      "animal",
      "animal",
      ":"
    ],
    [
      "pig",
      "\"pig\"",
      "animal",
      "food, animal",
      ":"
    ],
    [
      "unknown_species",
      "\"species unknown\"",
      "both",
      "unknown",
      ":"
    ]
  ]
};
export const depositReadings = {
  "columns": [
    "Option",
    "Phrase",
    "Profile",
    "Suggested by",
    "Guaranteed for"
  ],
  "rows": [
    [
      "formal_inhumation",
      "\"formal inhumation\"",
      "individual",
      "burial, clustered, ceremonial",
      "burial"
    ],
    [
      "cremation",
      "\"cremation\"",
      "individual",
      "burial, fire",
      ":"
    ],
    [
      "secondary_deposit",
      "\"secondary deposit\"",
      "individual",
      "burial, bone",
      ":"
    ],
    [
      "body_dump",
      "\"body dump\"",
      "individual",
      "burial, scattered",
      ":"
    ],
    [
      "hasty_burial",
      "\"hasty burial\"",
      "individual",
      "burial",
      ":"
    ],
    [
      "foundation_deposit",
      "\"foundation deposit\"",
      "individual",
      "deposit, ceremonial",
      ":"
    ],
    [
      "food_refuse",
      "\"food refuse\"",
      "animal",
      "food, domestic",
      "faunal_dump"
    ],
    [
      "with_an_individual",
      "\"laid with an individual\"",
      "animal",
      "burial, ceremonial",
      ":"
    ],
    [
      "ritual_sacrifice",
      "\"ritual deposit or sacrifice\"",
      "animal",
      "ceremonial",
      ":"
    ],
    [
      "companion_burial",
      "\"companion burial\"",
      "animal",
      "burial, animal",
      ":"
    ],
    [
      "kill_site",
      "\"kill-site discard\"",
      "animal",
      "scattered, bone",
      ":"
    ],
    [
      "natural_death",
      "\"natural death in place\"",
      "animal",
      "unknown",
      ":"
    ],
    [
      "unknown_deposit",
      "\"how it was left is unknown\"",
      "both",
      "unknown",
      ":"
    ]
  ]
};
export const archaeologyTools = {
  "columns": [
    "Recipe",
    "Output",
    "Crafting time",
    "Ingredients"
  ],
  "rows": [
    [
      "archaeo-tracker",
      "TOOLS:ARCHAEO_TRACKER (Field Compass)",
      "5",
      "Redstone Torch x1"
    ],
    [
      "archaeo-prospect",
      "TOOLS:ARCHAEO_PROSPECT (Soil Probe)",
      "5",
      "Cobblestone x2, Stick x2"
    ],
    [
      "archaeo-establish",
      "TOOLS:ARCHAEO_ESTABLISH (Camp Kit)",
      "5",
      "Leather x2, Stick x4, White Wool x2"
    ],
    [
      "archaeo-pencil",
      "TOOLS:ARCHAEO_PENCIL (Field Pencil)",
      "5",
      "Feather x1, Coal x1"
    ],
    [
      "field-brush",
      "vanilla BRUSH x1",
      "5",
      "Feather x1, Copper Ingot x1, Stick x1"
    ],
    [
      "hand-pick",
      "TOOLS:HAND_PICK",
      "5",
      "Stick x4"
    ],
    [
      "pointing-trowel",
      "TOOLS:POINTING_TROWEL",
      "5",
      "Stick x4"
    ],
    [
      "mattock",
      "TOOLS:MATTOCK",
      "5",
      "Cobblestone x3, Stick x2"
    ],
    [
      "grafting-spade",
      "TOOLS:GRAFTING_SPADE",
      "5",
      "Cobblestone x2, Stick x2"
    ],
    [
      "breaker-pick",
      "TOOLS:BREAKER_PICK",
      "5",
      "Iron Ingot x3, Stick x2"
    ],
    [
      "spoil-shovel",
      "TOOLS:SPOIL_SHOVEL",
      "5",
      "Iron Ingot x2, Stick x2"
    ],
    [
      "archeology-cabinet",
      "ItemsAdder archeology_cabinet",
      "2",
      "Iron Ingot x1"
    ]
  ]
};
export const archaeologyTables = [{ title: "Excavation tools", ...digProfiles },{ title: "Lab tools", ...labTools },{ title: "Stains and the correct tool", ...labStains },{ title: "Site interest levels", ...interestLevels },{ title: "Depth bands", ...strata },{ title: "Find materials", ...findMaterials },{ title: "All nine buried finds", ...buriedArtifacts },{ title: "Study notes after registration", ...studyNotes },{ title: "Site hints", ...siteHints },{ title: "What the hints tell you", ...hintReadings },{ title: "Conservation grades", ...conservationGrades },{ title: "Classification paths", ...interpretationProfiles },{ title: "Function: what was it for?", ...functionReadings },{ title: "Formation: how did it reach this layer?", ...formationReadings },{ title: "Epoch: which time?", ...epochReadings },{ title: "Species: individual and animal finds", ...speciesReadings },{ title: "Deposit: how was it left?", ...depositReadings },{ title: "Workshop recipes", ...archaeologyTools }];
export const archaeologyCommands: WikiCommandSet = {system: "Archaeo", href: "/wiki/archaeology", commands: [], excludedStaffCommands: ["/archaeo give ...", "/archaeo ruin ...", "/archaeo workday ...", "/archaeo find ...", "/archaeo sketch ...", "/archaeo reload"]};
export const archaeologySection: WikiSection = {nav: {href: "/wiki/archaeology", label: "Archaeology", category: "magic", blurb: "Find a ruin, establish a field camp, excavate by sound, then clean, register, and display recovered finds."}, recipes: [archeologyTableRecipe], commands: archaeologyCommands};
