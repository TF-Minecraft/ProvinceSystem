import type { WikiCommandSet, WikiSection } from "./types";
// Source: https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/docs/wiki-research/a2-gems-dowsing-archaeo.md, section 1.
export const gemRarities = {
  "columns": [
    "Rarity",
    "Display",
    "Weight",
    "Broadcast"
  ],
  "rows": [
    [
      "common",
      "Common",
      "65",
      "no"
    ],
    [
      "rare",
      "Rare",
      "25",
      "no"
    ],
    [
      "epic",
      "Epic",
      "7",
      "no"
    ],
    [
      "legendary",
      "Legendary",
      "3",
      "yes, server-wide"
    ]
  ]
};
export const basicGems = {
  "columns": [
    "Gem",
    "MMOItems id",
    "Stat",
    "common",
    "rare",
    "epic",
    "legendary"
  ],
  "rows": [
    [
      "Agate",
      "gemstones.agate",
      "max_health",
      "0.20\u20130.30",
      "0.30\u20130.40",
      "0.40\u20130.50",
      "0.50\u20130.60"
    ],
    [
      "Jasper",
      "gemstones.jasper",
      "armor",
      "0.05\u20130.10",
      "0.10\u20130.15",
      "0.15\u20130.20",
      "0.20\u20130.25"
    ],
    [
      "Onyx",
      "gemstones.onyx",
      "physical_damage_reduction",
      "1.00\u20131.20",
      "1.30\u20131.50",
      "1.60\u20131.80",
      "1.90\u20132.00"
    ],
    [
      "Tourmaline",
      "gemstones.tourmaline",
      "projectile_damage_reduction",
      "1.00\u20131.20",
      "1.30\u20131.50",
      "1.60\u20131.80",
      "1.90\u20132.00"
    ],
    [
      "Pearl",
      "gemstones.pearl",
      "magic_damage_reduction",
      "1.00\u20131.20",
      "1.30\u20131.50",
      "1.60\u20131.80",
      "1.90\u20132.00"
    ],
    [
      "Coral",
      "gemstones.coral",
      "physical_damage",
      "2.00\u20132.20",
      "2.30\u20132.50",
      "2.60\u20132.80",
      "2.90\u20133.00"
    ],
    [
      "Chrysoprase",
      "gemstones.chrysoprase",
      "projectile_damage",
      "2.00\u20132.20",
      "2.30\u20132.50",
      "2.60\u20132.80",
      "2.90\u20133.00"
    ],
    [
      "Larimar",
      "gemstones.larimar",
      "magic_damage",
      "2.00\u20132.20",
      "2.30\u20132.50",
      "2.60\u20132.80",
      "2.90\u20133.00"
    ],
    [
      "Rhodonite",
      "gemstones.rhodonite",
      "spell_vampirism",
      "2.00\u20132.20",
      "2.30\u20132.50",
      "2.60\u20132.80",
      "2.90\u20133.00"
    ],
    [
      "Vesuvianite",
      "gemstones.vesuvianite",
      "lifesteal",
      "2.00\u20132.20",
      "2.30\u20132.50",
      "2.60\u20132.80",
      "2.90\u20133.00"
    ]
  ]
};
export const polishedGems = {
  "columns": [
    "Gem",
    "MMOItems id",
    "Stat",
    "common",
    "rare",
    "epic",
    "legendary"
  ],
  "rows": [
    [
      "Turquoise",
      "gemstones.turquoise",
      "max_health",
      "0.60\u20130.70",
      "0.70\u20130.80",
      "0.80\u20130.90",
      "0.90\u20131.00"
    ],
    [
      "Peridot",
      "gemstones.peridot",
      "armor",
      "0.25\u20130.30",
      "0.30\u20130.35",
      "0.35\u20130.40",
      "0.40\u20130.45"
    ],
    [
      "Malachite",
      "gemstones.malachite",
      "physical_damage_reduction",
      "2.00\u20132.20",
      "2.30\u20132.50",
      "2.60\u20132.80",
      "2.90\u20133.00"
    ],
    [
      "Zircon",
      "gemstones.zircon",
      "projectile_damage_reduction",
      "2.00\u20132.20",
      "2.30\u20132.50",
      "2.60\u20132.80",
      "2.90\u20133.00"
    ],
    [
      "Apatite",
      "gemstones.apatite",
      "magic_damage_reduction",
      "2.00\u20132.20",
      "2.30\u20132.50",
      "2.60\u20132.80",
      "2.90\u20133.00"
    ],
    [
      "Carnelian",
      "gemstones.carnelian",
      "physical_damage",
      "3.00\u20133.20",
      "3.30\u20133.50",
      "3.60\u20133.80",
      "3.90\u20134.00"
    ],
    [
      "Labradorite",
      "gemstones.labradorite",
      "projectile_damage",
      "3.00\u20133.20",
      "3.30\u20133.50",
      "3.60\u20133.80",
      "3.90\u20134.00"
    ],
    [
      "Sardonyx",
      "gemstones.sardonyx",
      "magic_damage",
      "3.00\u20133.20",
      "3.30\u20133.50",
      "3.60\u20133.80",
      "3.90\u20134.00"
    ],
    [
      "Variscite",
      "gemstones.variscite",
      "spell_vampirism",
      "3.00\u20133.20",
      "3.30\u20133.50",
      "3.60\u20133.80",
      "3.90\u20134.00"
    ],
    [
      "Wulfenite",
      "gemstones.wulfenite",
      "lifesteal",
      "3.00\u20133.20",
      "3.30\u20133.50",
      "3.60\u20133.80",
      "3.90\u20134.00"
    ]
  ]
};
export const radiantGems = {
  "columns": [
    "Gem",
    "MMOItems id",
    "Stat",
    "common",
    "rare",
    "epic",
    "legendary"
  ],
  "rows": [
    [
      "Aquamarine",
      "gemstones.aquamarine",
      "max_health",
      "1.00\u20131.10",
      "1.10\u20131.20",
      "1.20\u20131.30",
      "1.40\u20131.50"
    ],
    [
      "Garnet",
      "gemstones.garnet",
      "armor",
      "0.45\u20130.50",
      "0.50\u20130.55",
      "0.55\u20130.60",
      "0.60\u20130.65"
    ],
    [
      "Opal",
      "gemstones.opal",
      "physical_damage_reduction",
      "3.00\u20133.20",
      "3.30\u20133.50",
      "3.60\u20133.80",
      "3.90\u20134.00"
    ],
    [
      "Tanzanite",
      "gemstones.tanzanite",
      "projectile_damage_reduction",
      "3.00\u20133.20",
      "3.30\u20133.50",
      "3.60\u20133.80",
      "3.90\u20134.00"
    ],
    [
      "Moonstone",
      "gemstones.moonstone",
      "magic_damage_reduction",
      "3.00\u20133.20",
      "3.30\u20133.50",
      "3.60\u20133.80",
      "3.90\u20134.00"
    ],
    [
      "Sunstone",
      "gemstones.sunstone",
      "physical_damage",
      "4.00\u20134.20",
      "4.30\u20134.50",
      "4.60\u20134.80",
      "4.90\u20135.00"
    ],
    [
      "Spinel",
      "gemstones.spinel",
      "projectile_damage",
      "4.00\u20134.20",
      "4.30\u20134.50",
      "4.60\u20134.80",
      "4.90\u20135.00"
    ],
    [
      "Alexandrite",
      "gemstones.alexandrite",
      "magic_damage",
      "4.00\u20134.20",
      "4.30\u20134.50",
      "4.60\u20134.80",
      "4.90\u20135.00"
    ],
    [
      "Direstone (key firestone)",
      "gemstones.firestone",
      "spell_vampirism",
      "4.00\u20134.20",
      "4.30\u20134.50",
      "4.60\u20134.80",
      "4.90\u20135.00"
    ],
    [
      "Cloudstone",
      "gemstones.cloudstone",
      "lifesteal",
      "4.00\u20134.20",
      "4.30\u20134.50",
      "4.60\u20134.80",
      "4.90\u20135.00"
    ]
  ]
};
export const mythicalGems = {
  "columns": [
    "Gem",
    "MMOItems id",
    "Stat",
    "common",
    "rare",
    "epic",
    "legendary"
  ],
  "rows": [
    [
      "Ruby",
      "gemstones.ruby",
      "max_health",
      "1.50\u20131.60",
      "1.60\u20131.70",
      "1.70\u20131.80",
      "1.80\u20132.00"
    ],
    [
      "Sapphire",
      "gemstones.sapphire",
      "armor",
      "0.65\u20130.70",
      "0.70\u20130.75",
      "0.75\u20130.80",
      "0.80\u20131.00"
    ],
    [
      "Topaz",
      "gemstones.topaz",
      "physical_damage_reduction",
      "4.00\u20134.20",
      "4.30\u20134.50",
      "4.60\u20134.80",
      "4.90\u20135.00"
    ],
    [
      "Citrine",
      "gemstones.citrine",
      "projectile_damage_reduction",
      "4.00\u20134.20",
      "4.30\u20134.50",
      "4.60\u20134.80",
      "4.90\u20135.00"
    ],
    [
      "Morganite",
      "gemstones.morganite",
      "magic_damage_reduction",
      "4.00\u20134.20",
      "4.30\u20134.50",
      "4.60\u20134.80",
      "4.90\u20135.00"
    ],
    [
      "Crystallite",
      "gemstones.crystallite",
      "physical_damage",
      "5.00\u20135.20",
      "5.30\u20135.50",
      "5.60\u20135.80",
      "5.90\u20136.00"
    ],
    [
      "Tiger's Eye",
      "gemstones.tigers_eye",
      "projectile_damage",
      "5.00\u20135.20",
      "5.30\u20135.50",
      "5.60\u20135.80",
      "5.90\u20136.00"
    ],
    [
      "Serpent's Eye",
      "gemstones.serpents_eye",
      "magic_damage",
      "5.00\u20135.20",
      "5.30\u20135.50",
      "5.60\u20135.80",
      "5.90\u20136.00"
    ],
    [
      "Musgravite",
      "gemstones.musgravite",
      "spell_vampirism",
      "5.00\u20135.20",
      "5.30\u20135.50",
      "5.60\u20135.80",
      "5.90\u20136.00"
    ],
    [
      "Taaffeite",
      "gemstones.taaffeite",
      "lifesteal",
      "5.00\u20135.20",
      "5.30\u20135.50",
      "5.60\u20135.80",
      "5.90\u20136.00"
    ]
  ]
};
export const goldMaterials = {
  "columns": [
    "Material",
    "Display",
    "Item path",
    "Hits it adds per unit"
  ],
  "rows": [
    [
      "rough_gold",
      "Rough Gold",
      "m.materials.rough_gold",
      "Hit \u00d72, Small Hit \u00d71"
    ],
    [
      "moldable_gold",
      "Moldable Gold",
      "m.materials.moldable_gold",
      "Hit \u00d73, Small Hit \u00d72, Tinker \u00d71"
    ],
    [
      "shiny_gold",
      "Shiny Gold",
      "m.materials.shiny_gold",
      "Hit \u00d71, Small Hit \u00d73, Tinker \u00d72"
    ]
  ]
};
export const goldTools = {
  "columns": [
    "Tool",
    "MMOItems path",
    "Produces"
  ],
  "rows": [
    [
      "Goldsmith Hammer",
      "tools.goldsmith_hammer",
      "Hit"
    ],
    [
      "Small Goldsmith Hammer",
      "tools.small_goldsmith_hammer",
      "Small Hit"
    ],
    [
      "Goldsmith Tinker Tool",
      "tools.goldsmith_tinker_tool",
      "Tinker"
    ],
    [
      "Goldsmith Branding Tool",
      "m.tools.goldsmith_branding_tool",
      "status / finish / cancel"
    ]
  ]
};
export const jewelleryProjects = {
  "columns": [
    "Project id",
    "Display",
    "Output item",
    "Tier field",
    "Gem",
    "Recipe"
  ],
  "rows": [
    [
      "gold_ring",
      "Golden Ring",
      "m.ring.fine_ring",
      "minor",
      "1",
      "Rough \u00d74"
    ],
    [
      "jeweled_gold_ring",
      "Jeweled Ring",
      "m.ring.fine_jeweled_ring",
      "lesser",
      "1",
      "Rough \u00d73, Moldable \u00d73"
    ],
    [
      "purple_ring",
      "Purple Ring",
      "m.ring.fine_purple_ring",
      "major",
      "1",
      "Rough \u00d72, Moldable \u00d74, Shiny \u00d72"
    ],
    [
      "red_ring",
      "Red Ring",
      "m.ring.fine_red_ring",
      "greater",
      "1",
      "Moldable \u00d74, Shiny \u00d76"
    ],
    [
      "green_ring",
      "Green Ring",
      "m.ring.fine_green_ring",
      "greater",
      "1",
      "Moldable \u00d74, Shiny \u00d76"
    ],
    [
      "red_necklace",
      "Red Necklace",
      "m.amulet.fine_red_amulet",
      "minor",
      "1",
      "Rough \u00d74"
    ],
    [
      "purple_necklace",
      "Purple Necklace",
      "m.amulet.fine_purple_amulet",
      "lesser",
      "1",
      "Rough \u00d73, Moldable \u00d73"
    ],
    [
      "dark_necklace",
      "Green Necklace",
      "m.amulet.fine_dark_amulet",
      "major",
      "1",
      "Rough \u00d72, Moldable \u00d74, Shiny \u00d72"
    ],
    [
      "pendant",
      "Pendant",
      "m.amulet.fine_pendant_amulet",
      "greater",
      "1",
      "Moldable \u00d74, Shiny \u00d76"
    ],
    [
      "green_medal",
      "Green Medal",
      "m.artifact.good_green_medal",
      "minor",
      "1",
      "Rough \u00d74"
    ],
    [
      "blue_medal",
      "Blue Medal",
      "m.artifact.good_medal",
      "minor",
      "1",
      "Rough \u00d74"
    ],
    [
      "mirror",
      "Mirror",
      "m.artifact.good_mirror",
      "lesser",
      "1",
      "Rough \u00d73, Moldable \u00d73"
    ],
    [
      "chalice",
      "Chalice",
      "m.artifact.good_chalice",
      "major",
      "1",
      "Rough \u00d72, Moldable \u00d74, Shiny \u00d72"
    ],
    [
      "bracelet",
      "Gold Bracelet",
      "m.artifact.good_bracelet",
      "greater",
      "1",
      "Moldable \u00d74, Shiny \u00d76"
    ]
  ]
};
export const goldHits = {
  "columns": [
    "Project",
    "Hits",
    "Small Hits",
    "Tinkers"
  ],
  "rows": [
    [
      "Rough \u00d74 (gold_ring, red_necklace, green_medal, blue_medal)",
      "8",
      "4",
      "0"
    ],
    [
      "Rough \u00d73 + Moldable \u00d73 (jeweled_gold_ring, purple_necklace, mirror)",
      "15",
      "9",
      "3"
    ],
    [
      "Rough \u00d72 + Moldable \u00d74 + Shiny \u00d72 (purple_ring, dark_necklace, chalice)",
      "18",
      "16",
      "8"
    ],
    [
      "Moldable \u00d74 + Shiny \u00d76 (red_ring, green_ring, pendant, bracelet)",
      "18",
      "26",
      "16"
    ]
  ]
};
export const gemInfusionTables = [{ title: "Rarity odds", ...gemRarities },{ title: "Basic Gemstones", ...basicGems },{ title: "Polished Gemstones", ...polishedGems },{ title: "Radiant Gemstones", ...radiantGems },{ title: "Mythical Gemstones", ...mythicalGems },{ title: "Gold materials", ...goldMaterials },{ title: "Goldsmithing tools", ...goldTools },{ title: "All 14 jewellery projects", ...jewelleryProjects },{ title: "Material hit totals", ...goldHits }];
export const gemInfusionCommands: WikiCommandSet = {system: "GemInfusion", href: "/wiki/gem-infusion", commands: [], excludedStaffCommands: ["/geminfusion reload", "/geminfusion select <projectId>"]};
export const gemInfusionSection: WikiSection = {nav: {href: "/wiki/gem-infusion", label: "Gem Infusion", category: "magic", blurb: "Infuse 40 gemstones and craft 14 jewellery designs with goldsmithing tools."}, commands: gemInfusionCommands};

