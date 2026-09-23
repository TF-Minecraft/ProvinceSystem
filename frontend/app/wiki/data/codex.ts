import type { WikiCommandSet, WikiSection } from "./types";
// Source: https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/docs/wiki-research/a-magic-knowledge.md, section 3.
export const codexStudies = {
  "columns": [
    "Codex id",
    "Display name",
    "Opens"
  ],
  "rows": [
    [
      "ignitium",
      "Ignitium",
      "research_ignitium"
    ],
    [
      "bronze",
      "Bronze",
      "research_bronze"
    ],
    [
      "abyssalite",
      "Abyssalite",
      "research_abyssalite"
    ],
    [
      "mythril",
      "Mythril",
      "research_mythril"
    ],
    [
      "elderwood",
      "Elderwood",
      "research_elderwood"
    ],
    [
      "demonwood",
      "Demonwood",
      "research_demonwood"
    ],
    [
      "enchanted_dust",
      "Enchanted Dust",
      "research_enchanted_dust"
    ],
    [
      "arcane_crystal",
      "Arcane Crystals",
      "research_arcane_crystal"
    ],
    [
      "alchemy",
      "Alchemy",
      "research_alchemy"
    ],
    [
      "gunpowder",
      "Gunpowder",
      "research_gunpowder"
    ],
    [
      "denar",
      "Imperial Denar",
      "research_denar"
    ],
    [
      "runestone",
      "Runestones",
      "research_runestone"
    ],
    [
      "gem_infusion",
      "Gemstone Infusion",
      "research_infusion"
    ],
    [
      "trace_detection",
      "Arcane Trace Detection",
      "research_arcane_trace_detection"
    ],
    [
      "arcane_instability",
      "Arcane Instability",
      "(green tier, listed on page 1)"
    ]
  ]
};
export const codexLore = {
  "columns": [
    "Entry",
    "Codex ID",
    "Research project route"
  ],
  "rows": [
    [
      "The Ancient Cerrith",
      "the_ancient_cerrith",
      "No listed research project"
    ],
    [
      "The Ancients",
      "the_ancients",
      "No listed research project"
    ],
    [
      "The Arcanum",
      "the_arcanum",
      "No listed research project"
    ],
    [
      "Arcanum Fever",
      "arcanum_fever",
      "Unknown Research Paper"
    ],
    [
      "Arcanum Souls",
      "arcanum_souls",
      "No listed research project"
    ],
    [
      "Cerrith Cores",
      "cerrith_cores",
      "No listed research project"
    ],
    [
      "The Cerrithian Schism",
      "the_cerrithian_schism",
      "No listed research project"
    ],
    [
      "The Cervalic Order",
      "the_cervalic_order",
      "Unknown Research Paper"
    ],
    [
      "The Crown of Servitude",
      "the_crown_of_servitude",
      "Unknown Research Paper"
    ],
    [
      "The Decarian Cataclysm",
      "the_decarian_cataclysm",
      "No listed research project"
    ],
    [
      "The Decarian Wasteland",
      "the_decarian_wasteland",
      "Unknown Research Paper"
    ],
    [
      "The Delorians",
      "the_delorians",
      "No listed research project"
    ],
    [
      "The Heroes of Bastion",
      "the_heroes_of_bastion",
      "No listed research project"
    ],
    [
      "The Imperial Arcane Academy",
      "the_imperial_arcane_academy",
      "Unknown Research Paper"
    ],
    [
      "Malice Crawlers",
      "malice_crawlers",
      "Unknown Research Paper"
    ],
    [
      "Mitlan, the Water Plane",
      "mitlan_the_water_plane",
      "Unknown Research Paper"
    ],
    [
      "The Oseni Loyalists",
      "the_oseni_loyalists",
      "Unknown Research Paper"
    ],
    [
      "The Petty Mage Guild",
      "the_petty_mage_guild",
      "Unknown Research Paper"
    ],
    [
      "The Reclamation",
      "the_reclamation",
      "Unknown Research Paper"
    ],
    [
      "The Rothil Zerratoris",
      "the_rothil_zerratoris",
      "No listed research project"
    ],
    [
      "Seithr Essence",
      "seithr_essence",
      "Unknown Research Paper"
    ],
    [
      "The Solmyrith Empire",
      "the_solmyrith_empire",
      "No listed research project"
    ],
    [
      "Tyvanis",
      "tyvanis",
      "No listed research project"
    ],
    [
      "Vestanger",
      "vestanger",
      "Unknown Research Paper"
    ]
  ]
};
export const codexCharacters = {
  "columns": [
    "Character"
  ],
  "rows": [
    [
      "Empress Zenyra Solithar"
    ],
    [
      "Logarothar the Narrator"
    ],
    [
      "Haldorim the Host"
    ],
    [
      "Armitor the Knight"
    ],
    [
      "Cerrevictis the Physician"
    ],
    [
      "Thalorim the Squire"
    ],
    [
      "Servitor the Yeoman"
    ],
    [
      "Torvim the Miller"
    ],
    [
      "Mercator the Merchant"
    ],
    [
      "Ancientorim the Priestess"
    ],
    [
      "Evocator the Summoner"
    ],
    [
      "Talyn the Clerk"
    ],
    [
      "Cerraraxo the Parson"
    ],
    [
      "Deputy Godric Dannorath"
    ],
    [
      "Deputy Robyn Galeroot"
    ],
    [
      "Deputy Zisel Eidel"
    ],
    [
      "God-Emperor Thalrix"
    ],
    [
      "Zorander Zul"
    ],
    [
      "Archnecromancer Erandor"
    ],
    [
      "The Lady of the Tower"
    ],
    [
      "Sirocco Kassar"
    ],
    [
      "Ankala Kravaxis"
    ],
    [
      "Sagittarius the Planewalker"
    ],
    [
      "Andromeda the Planewalker"
    ],
    [
      "Ramon Zentharon"
    ]
  ]
};
export const codexSpecial = {
  "columns": [
    "Id",
    "Display name (rendered as a dark-teal gradient)",
    "Opens"
  ],
  "rows": [
    [
      "cavepaintings",
      "The Ancient Cerrith Murals",
      "special_cavepaintings"
    ],
    [
      "the_umbrythikon",
      "The Umbrythikon",
      "special_the_umbrythikon"
    ],
    [
      "the_planewalker",
      "The Planewalker",
      "special_the_planewalker"
    ]
  ]
};
export const codexAchievements = {
  "columns": [
    "Id",
    "Display name",
    "Locked hint shown in GUI",
    "MMOCore EXP",
    "How it actually fires"
  ],
  "rows": [
    [
      "die",
      "You Died!",
      "Feel the cold embrace of death.",
      "none",
      "First player death; once only."
    ],
    [
      "calavorn_100",
      "Calavorian Historian",
      "(no hint)",
      "1650",
      "Needs 37 Calavorn discoveries, but that category is no longer loaded. "
    ],
    [
      "threekingdoms_100",
      "Trinitarian Traveler",
      "Tour the Three Kingdoms and learn their history.",
      "1650",
      "Needs 12 Three Kingdoms discoveries, but that category is no longer loaded. "
    ],
    [
      "5_research",
      "Scholarly Ambition",
      "Learn a few new things via research.",
      "1650",
      "%codex_total_discoveries_research% >= 5"
    ],
    [
      "10_research",
      "Rising Researcher",
      "Learn a handful of new things via research.",
      "2750",
      ">= 10"
    ],
    [
      "25_research",
      "Top of the Class",
      "Learn a variety of new things via research.",
      "5500",
      ">= 25"
    ],
    [
      "all_research",
      "The Next Lorewalker",
      "Learn everything there is to know from research.",
      "11000",
      "Impossible: needs 49 Research discoveries; only 39 are defined."
    ],
    [
      "event_attendee",
      "I Was There",
      "Be present during a pivotal moment in history.",
      "1100",
      "No automatic unlock trigger found."
    ],
    [
      "world_boss_1",
      "Demon Slayer",
      "Slay a lost Malice Crawler, a powerful necromantic being.",
      "1650",
      "Unavailable content: listed for journal reference only."
    ],
    [
      "world_boss_2",
      "No Maidens:",
      "Slay the memory of a fallen Seithr warlord.",
      "1650",
      "Unavailable content: listed for journal reference only."
    ],
    [
      "starter_dungeon",
      "Wise Mystical Tree",
      "Venture into a land of natural whimsy and wonder.",
      "2750",
      "Unavailable content: listed for journal reference only."
    ],
    [
      "dungeon_1",
      "Part 8 at 10m 7s",
      "Cleanse an ancient stronghold of antiplanar corruption.",
      "2750",
      "Unavailable content: listed for journal reference only. No unlock trigger found."
    ],
    [
      "minidungeon_1",
      "That's Not What Happened... Is It:",
      "Relive the events of the past through the lens of a broken machine.",
      "1650",
      "Unavailable content: listed for journal reference only."
    ],
    [
      "minidungeon_2",
      "An Act's Conclusion",
      "Escape an enemy camp with stolen resources in tow.",
      "1650",
      "Unavailable content: listed for journal reference only."
    ],
    [
      "minidungeon_3",
      "Heavy Is The Crown",
      "Recover a treasured heirloom from a hidden royal tomb.",
      "2750",
      "Unavailable content: listed for journal reference only. No unlock trigger found."
    ]
  ]
};
export const codexJokes = {
  "columns": [
    "Id",
    "Display name",
    "Locked hint",
    "Trigger phrase(s)"
  ],
  "rows": [
    [
      "tf",
      "What Does TF Stand For:",
      "The great mystery of our time...",
      "tf, TF, Tf, tf., TF."
    ],
    [
      "gg",
      "GG",
      "Can't win with this king...",
      "gg, Gg, GG, gg., GG."
    ],
    [
      "no_u",
      "No U",
      "Stop whining, you're just bad at the game.",
      "skill issue (4 casings)"
    ],
    [
      "find_out_ic",
      "Found Out",
      "Hey guys, what did I miss:",
      "find out ic (5 casings)"
    ],
    [
      "erp",
      "#hall-of-fame",
      "Surely everyone reads the rules. Surely.",
      "erp, ERP, Erp"
    ],
    [
      "if_i_speak",
      "Big Trouble",
      "I am preferential to remaining silent.",
      "if i speak (4 casings): also plays troll.mourinho1"
    ],
    [
      "hoi4",
      "HALLO ALLIES",
      "\u00dcLTIMATE IMBECILES!",
      "hoi4, hoi 4, hoi IV and casings: also plays troll.geoff1"
    ],
    [
      "afk",
      "Stuck In Traffic",
      "brb rq.",
      "running /afk"
    ],
    [
      "one_sex",
      "WHAT:!:! ONE SEX:!:!",
      "I hope you passed your literacy class.",
      "one sex (4 casings)"
    ],
    [
      "tommykay",
      "TommyKay the DJ",
      "Let's call out his name!",
      "tommykay / tommy kay and casings: also plays troll.tommy1"
    ],
    [
      "aneesh",
      "The Legend of Aneesh",
      "The man, the myth, the legend...",
      "aneesh, Olyn, 0lyn, _sly, Apostasy, fa1c and casings"
    ]
  ]
};
export const codexTables = [{ title: "Material and technique studies", ...codexStudies },{ title: "Lore studies", ...codexLore },{ title: "Characters", ...codexCharacters },{ title: "Special entries", ...codexSpecial },{ title: "Achievement reference", ...codexAchievements },{ title: "Command-triggered joke achievements", ...codexJokes }];
export const codexCommands: WikiCommandSet = {system: "Codex", href: "/wiki/codex", commands: [{command:"/codex", description:"Opens the discovery journal."},{command:"/codex help", description:"Shows the commands available to you."}], excludedStaffCommands:["/codex unlock <player> <category> <discovery> [true/false]","/codex resetplayer <player>/* [category] [discovery]","/codex reload","/codex open <player> <inventory>","/codex verify"]};
export const codexSection: WikiSection = {nav:{href:"/wiki/codex",label:"Codex",category:"magic",blurb:"Browse lore, character entries and achievements, with missing unlock paths clearly identified."},commands:codexCommands};
