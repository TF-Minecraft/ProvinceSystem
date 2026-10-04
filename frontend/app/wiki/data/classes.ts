import type { WikiCommandSet, WikiSection } from "./types";

// ---------- MMOCore: Classes, Levels, Attributes, Professions, Parties ----------

export type ClassInfo = {
  id: string;
  name: string;
  colour: string;
  maxLevel: number;
  equipment: string;
  lore: string;
  skillCount: number;
};

/** The seven selectable classes (`gui/class-select.yml`). An 8th, `default`, is hidden and unselectable. */
export const classes: ClassInfo[] = [
  {
    id: "archer",
    name: "Archer",
    colour: "Green",
    maxLevel: 6,
    equipment: "Shortbows, Longbows, Crossbows, Light Armor",
    lore: "Deadly marksmen, wielding bows with precision. They deal sustained damage from a distance, and are excellent at maintaining a favourable position, making them ever-reliable.",
    skillCount: 8,
  },
  {
    id: "bard",
    name: "Bard",
    colour: "Light Blue",
    maxLevel: 6,
    equipment: "Lutes, Light Armor",
    lore: "Charismatic minstrels, wielding Mana through music. They can provide magical blessings and hamper enemy mobility.",
    skillCount: 8,
  },
  {
    id: "guardian",
    name: "Guardian",
    colour: "Grey",
    maxLevel: 6,
    equipment: "One-Handed Weapons, Shields, Battle Standards, Heavy Armor",
    lore: "Unyielding defenders, controlling the battlefield by drawing attention, absorbing damage, and manipulating enemies.",
    skillCount: 8,
  },
  {
    id: "mage",
    name: "Mage",
    colour: "Magenta",
    maxLevel: 6,
    equipment: "Mage Staffs, Mage Wands, Mage Blades, Mage Armor",
    lore: "Command the forces of magic, casting spells via runes. With many runes available, Mages are the most diverse class. Lore warns: \"Mages are expensive to gear!\"",
    skillCount: 0,
  },
  {
    id: "musketeer",
    name: "Musketeer",
    colour: "Orange",
    maxLevel: 6,
    equipment: "Pistols, Rifles, Shotguns, Rocket Launchers, Infantry Armor",
    lore: "Excel at the usage of advanced guns and gadgets. Though lacking skills, they manufacture custom firearms, many of which deal armor-piercing damage.",
    skillCount: 0,
  },
  {
    id: "paladin",
    name: "Paladin",
    colour: "Pale Yellow",
    maxLevel: 6,
    equipment: "One-Handed Weapons, Two-Handed Weapons, Shortswords, Shields, Medium Armor",
    lore: "Resolute soldiers who excel in traditional combat, empowering themselves and protecting others.",
    skillCount: 8,
  },
  {
    id: "warrior",
    name: "Warrior",
    colour: "Red",
    maxLevel: 6,
    equipment: "One-Handed Weapons, Two-Handed Weapons, Shortswords, Battle Standards, Medium Armor",
    lore: "Mobile masters of combat, weaving attacks with an array of flexible skills to inflict great damage.",
    skillCount: 8,
  },
];

export type ClassSkill = {
  id: string;
  displayName?: string;
  description?: string;
  cooldown: string;
  mana: string;
  other?: string;
};

/** Every configured skill unlocks at class level 2 and caps at level 4. Mage and Musketeer have no class skills. */
export const classSkills: Record<string, ClassSkill[]> = {
  archer: [
    { id: "ARCHER_STEP", displayName: "Archer Step", description: "Leaps backward to quickly create distance.", cooldown: "20.0 s, -1.66/lvl", mana: "10, -1.66/lvl" },
    { id: "DECOY", displayName: "Decoy", description: "Creates copies of you that move toward players, then grants you a short burst of speed.", cooldown: "15.0 s, -1.66/lvl", mana: "5, -0.833/lvl", other: "duration 10.0 s" },
    { id: "ARROW_VOLLEY", displayName: "Arrow Volley", description: "Empowers your next shot to release a wide volley of arrows.", cooldown: "20.0 s, -4.0/lvl", mana: "5, -0.833/lvl" },
    { id: "POISON_ARROW", displayName: "Poison Arrow", description: "Empowers your next shot to damage and poison the target.", cooldown: "20.0 s", mana: "5, -0.833/lvl", other: "duration 2.0 s +1/lvl; damage 8.0 +2.33/lvl" },
    { id: "TOTEM_MINE", displayName: "Totem Mine", description: "Throws a mine that ignites and damages nearby targets when it activates.", cooldown: "20.0 s", mana: "5, -0.833/lvl", other: "duration 5.0 s +1.66/lvl; damage 10.0 +1.66/lvl" },
    { id: "HAWK_EYE", displayName: "Hawk Eye", description: "Empowers your next shot to reveal and slow targets around where the arrow lands.", cooldown: "10.0 s", mana: "5, -0.833/lvl", other: "duration 5.0 s +1.66/lvl" },
    { id: "FREEZING_SHOT", displayName: "Freezing Shot", description: "Empowers your next shot to immobilize the target.", cooldown: "40.0 s", mana: "10, -1.66/lvl", other: "duration 4.0 s +2.0/lvl" },
    { id: "ARCHER_CLOAK", displayName: "Archer Cloak", description: "Makes you invisible and faster until you attack, take damage, interact, or alter a block.", cooldown: "30.0 s", mana: "10, -1.66/lvl", other: "duration 2.0 s +1/lvl" },
  ],
  bard: [
    { id: "SOUND_WAVE", displayName: "Sound Wave", description: "Fires three spreading sound waves that damage and slow enemies they hit.", cooldown: "20.0 s", mana: "5, -0.833/lvl", other: "duration 2.0 s +0.66/lvl; damage 8.0 +2.33/lvl" },
    { id: "MEMENTO_MORI", displayName: "Memento Mori", description: "Fires a homing musical projectile that blinds its target and applies the Wither effect.", cooldown: "15.0 s", mana: "5, -0.833/lvl", other: "duration 2.0 s +1/lvl" },
    { id: "VIBRATIVE_STRIKE", displayName: "Vibrative Strike", description: "Fires a sequence of accelerating waves that immobilize enemies around each impact.", cooldown: "40.0 s, -1.66/lvl", mana: "10, -1.66/lvl", other: "duration 3.0 s +0.66/lvl" },
    { id: "SHIELD_OF_HARMONY", displayName: "Shield of Harmony", description: "Surrounds you with musical notes that repeatedly grant damage resistance to nearby players.", cooldown: "20.0 s", mana: "5, -0.833/lvl", other: "duration 5.0 s +1.66/lvl" },
    { id: "ANGELIC_SERENADE", displayName: "Angelic Serenade", description: "Summons a healing aura that restores nearby players over time.", cooldown: "25.0 s", mana: "5, -1.66/lvl", other: "duration 5.0 s +1.66/lvl; heal 2.0 +2.0/lvl" },
    { id: "RHAPSODY", displayName: "Rhapsody", description: "Grants Speed to you and nearby allies.", cooldown: "20.0 s", mana: "5, -0.833/lvl", other: "duration 7.0 s +1.66/lvl" },
    { id: "SYMPHONY_OF_DESTRUCTION", displayName: "Symphony of Destruction", description: "Sends a musical effect forward that erupts later, damaging and lifting enemies in the area.", cooldown: "30.0 s", mana: "10, -1.66/lvl", other: "duration 2.0 s +1/lvl; damage 12.0 +2.0/lvl" },
    { id: "TELEPORT", displayName: "Teleport", description: "Channels briefly, then teleports nearby players and you toward the targeted location.", cooldown: "20.0 s", mana: "10, -1.66/lvl" },
  ],
  guardian: [
    { id: "MENDING", displayName: "Mending", description: "Holds you in place and weakens you while repeatedly restoring your health.", cooldown: "30.0 s", mana: "10.0, -1.66/lvl", other: "duration 3.0 s +1.0/lvl; heal 4.0 +0.66/lvl" },
    { id: "TREMORS", displayName: "Tremors", description: "Sends repeated tremors around you that damage nearby enemies while limiting your movement.", cooldown: "25.0 s", mana: "5.0, -0.833/lvl", other: "duration 5.0 s +1.0/lvl; damage 2 +1.33/lvl" },
    { id: "GUARDIAN_ANGEL", displayName: "Guardian Angel", description: "Protects a targeted player by restoring part of the damage they take.", cooldown: "40.0 s", mana: "10, -1.66/lvl", other: "duration 8 s +2.33/lvl; percentage 8 +8/lvl" },
    { id: "GROUND_SMASH", displayName: "Ground Smash", description: "Leaps and smashes down, immobilizing nearby targets when you land.", cooldown: "30.0 s", mana: "5.0, -0.833/lvl", other: "duration 2.0 s +0.66/lvl" },
    { id: "GROUP_UP", displayName: "Group Up", description: "Gives temporary extra hearts to you and nearby players.", cooldown: "30.0 s", mana: "5, -0.833/lvl", other: "duration 10 s +2/lvl; power 4 +4/lvl" },
    { id: "SUBSTITUTE", displayName: "Substitute", description: "Swaps places with your target.", cooldown: "25.0 s, -1.66/lvl", mana: "5, -1.0/lvl" },
    { id: "SHIELD_WALL", displayName: "Shield Wall", description: "Holds you in place behind a protective wall, grants resistance, and blocks damage to nearby players.", cooldown: "40.0 s", mana: "5, -0.833/lvl", other: "duration 2.0 s +1.66/lvl" },
    { id: "TANK_PULL", displayName: "Tank Pull", description: "Pulls targets in a cone toward you and slows them.", cooldown: "20.0 s", mana: "10, -1.66/lvl", other: "duration 3 s +1.66/lvl" },
  ],
  paladin: [
    { id: "SHIELD_UP", displayName: "Shield Up", description: "Slows you while granting damage resistance.", cooldown: "20.0 s", mana: "5.0, -0.833/lvl", other: "duration 3.0 s +1.33/lvl" },
    { id: "HEALING_STRIKE", displayName: "Healing Strike", description: "Strikes in front of you, damaging and launching the target upward.", cooldown: "20.0 s", mana: "5.0, -0.833/lvl", other: "damage 7 +1.33/lvl" },
    { id: "BULK_UP", displayName: "Bulk Up", description: "Slows you while increasing your melee strength.", cooldown: "30.0 s", mana: "5.0, -0.833/lvl", other: "duration 4.0 s +1.0/lvl" },
    { id: "HEAL_AURA", displayName: "Heal Aura", description: "Repeatedly restores health to you and nearby players.", cooldown: "60.0 s", mana: "10.0, -1.66/lvl", other: "duration 3.0 s +1/lvl; heal 2.0 +1.0/lvl" },
    { id: "WAR_CRY", displayName: "War Cry", description: "Weakens and reveals targets in a cone ahead of you.", cooldown: "30.0 s", mana: "5, -0.833/lvl", other: "duration 3 s +1/lvl" },
    { id: "PALADIN_SMITE", description: "Casts a beam of light from you, dealing damage to anyone within your vicinity.", cooldown: "30.0 s", mana: "10.0, -1.66/lvl", other: "damage 10 +1.66/lvl" },
    { id: "BLESS", displayName: "Bless", description: "Repeatedly clears slowing, weakness, poison, wither, and blindness from you and nearby players.", cooldown: "20.0 s", mana: "5, -0.833/lvl", other: "duration 10 s +1.66/lvl" },
    { id: "CHALLENGE", displayName: "Challenge", description: "Relocates you and a targeted player together while protecting both during the move.", cooldown: "40.0 s, -2.33/lvl", mana: "10.0, -1.66/lvl" },
  ],
  warrior: [
    { id: "WARRIOR_DASH", displayName: "Warrior Dash", description: "Dashes forward and damages enemies along your path.", cooldown: "20.0 s", mana: "5.0, -0.833/lvl", other: "damage 8.0 +1.33/lvl" },
    { id: "WARRIOR_STRIKE", displayName: "Warrior Strike", description: "Delivers a focused physical strike directly ahead.", cooldown: "20.0 s", mana: "5, -0.833/lvl", other: "damage 8.0 +2.33/lvl" },
    { id: "WARRIOR_HOOK", displayName: "Warrior Hook", description: "Fires a chain that pulls the first enemy it catches toward you.", cooldown: "20.0 s, -1.66/lvl", mana: "5, -0.833/lvl" },
    { id: "WARRIOR_SWEEP", displayName: "Warrior Sweep", description: "Sweeps nearby enemies away, damages them, and briefly limits their movement after they land.", cooldown: "20.0 s, -1.66/lvl", mana: "5, -0.833/lvl", other: "damage 5.0 +1.66/lvl" },
    { id: "WARRIOR_LUNGE", displayName: "Warrior Lunge", description: "Leaps to the targeted location and damages nearby enemies on arrival.", cooldown: "30.0 s", mana: "10, -1.66/lvl", other: "damage 10.0 +2.0/lvl" },
    { id: "WARRIOR_HEAL", displayName: "Warrior Heal", description: "Restores your own health.", cooldown: "20.0 s", mana: "5, -0.833/lvl", other: "heal 6.0 +2.0/lvl" },
    { id: "WARRIOR_SHIELD", displayName: "Warrior Shield", description: "Raises a temporary barrier that blocks the next hit against you.", cooldown: "30.0 s, -1.66/lvl", mana: "10, -1.66/lvl", other: "duration 20 s +0.833/lvl" },
    { id: "WARRIOR_BEAM", displayName: "Warrior Beam", description: "Fires a physical beam that damages enemies along its path and near its impact.", cooldown: "40.0 s", mana: "10, -1.66/lvl", other: "damage 8.0 +2.33/lvl" },
  ],
};

export type AttributeInfo = { name: string; perPoint: string };

/** Seven attributes, each capped at 20 points (`attributes/attributes.yml`). */
export const attributes: AttributeInfo[] = [
  { name: "Strength", perPoint: "+1.0 Physical Damage" },
  { name: "Dexterity", perPoint: "+1.0 Projectile Damage" },
  { name: "Constitution", perPoint: "+0.3 Max Health" },
  { name: "Intelligence", perPoint: "+1.0 Max Mana, +0.01 Mana Regeneration" },
  { name: "Wisdom", perPoint: "+1.0 Cooldown Reduction" },
  { name: "Charisma", perPoint: "+1.0 Recoil Reduction, +1.0 Reload Reduction, +1.0 Magic Damage, +0.25 Critical Strike Chance" },
  { name: "Nutrition", perPoint: "+0.5 Physical/Projectile/Magic Damage, +0.2 Max Health, +0.5 Max Mana, +0.01 Mana Regen, +0.5 Cooldown Reduction, +0.125 Crit Chance" },
];

export type ProfessionActivityGroup = { label: string; items: string[] };

export type ProfessionInfo = {
  id: string;
  displayName: string;
  howItLevels: string;
  /** What counts towards the profession, from `plugins/MMOCore/professions/<id>.yml`. */
  activities: ProfessionActivityGroup[];
};

/** Three gathering professions, all sharing the `profession` EXP curve. */
export const professions: ProfessionInfo[] = [
  {
    id: "crafter",
    displayName: "Crafter",
    howItLevels: "Smelt stone, metals, glass and other materials; mine ores and stone; repair tools.",
    activities: [
      { label: "Smelting", items: ["Stone", "Deepslate", "Smooth Stone", "Charcoal", "Terracotta", "Smooth Sandstone", "Smooth Red Sandstone", "Smooth Basalt", "Smooth Quartz", "Sponge", "Brick", "Nether Brick", "Glass", "Copper Ingot", "Iron Ingot", "Gold Ingot"] },
      { label: "Mining", items: ["Stone", "Andesite", "Granite", "Diorite", "Deepslate", "Coal Ore", "Iron Ore", "Copper Ore", "Redstone Ore", "Gold Ore", "Lapis Ore", "Diamond Ore", "Emerald Ore"] },
      { label: "Repairing", items: ["Swords", "Pickaxes"] },
    ],
  },
  {
    id: "forager",
    displayName: "Forager",
    howItLevels: "Kill farm animals and harvest crops that you grow.",
    activities: [
      { label: "Animals", items: ["Cow", "Chicken", "Pig", "Sheep", "Rabbit"] },
      { label: "Crops", items: ["Wheat", "Beetroots", "Carrots", "Potatoes", "Cocoa", "Melon", "Pumpkin", "Sugar Cane", "Cactus"] },
      { label: "Mushrooms", items: ["Red Mushroom", "Brown Mushroom"] },
    ],
  },
  {
    id: "herborist",
    displayName: "Herborist",
    howItLevels: "Gather Nether fungi and chop logs, wood and mangrove roots.",
    activities: [
      { label: "Nether plants", items: ["Nether Wart", "Crimson Fungus", "Warped Fungus"] },
      { label: "Logs and wood", items: ["Oak", "Spruce", "Birch", "Jungle", "Acacia", "Dark Oak", "Cherry", "Mangrove", "Pale Oak", "Mangrove Roots"] },
    ],
  },
];

/** MMOCore commands from `plugins/MMOCore/commands.yml`; permission defaults from the jar's `plugin.yml`. */
export const classesCommands: WikiCommandSet = {
  system: "MMOCore",
  href: "/wiki/classes",
  commands: [
    {
      command: "/player",
      aliases: ["/p", "/profile"],
      description: "Opens \"Your Character\": level, the three professions, attribute summary, EXP boosters and party morale.",
    },
    {
      command: "/attributes",
      aliases: ["/att", "/stats"],
      description: "Opens \"Character Attributes\": spend and reallocate your attribute points across the 7 attributes.",
    },
    {
      command: "/skills",
      aliases: ["/s"],
      description: "Opens the skill list. Left-click a skill slot to bind the selected skill, right-click to unbind, shift-left-click to select.",
      notes: "Upgrading a skill costs 1 skill point; reallocating all spent points costs 1 skill reallocation point.",
    },
  ],
  excludedStaffCommands: ["/mmocore (/rpg): full admin tree"],
};

export const classesSection: WikiSection = {
  nav: {
    href: "/wiki/classes",
    label: "Classes & Character",
    category: "character",
    blurb: "Pick a class, spend attribute points, learn class skills, and level three professions.",
  },
  commands: classesCommands,
};



