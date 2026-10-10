import type { SkinKind } from "./sizes";

/**
 * One armour submission is one metal line: up to one set per type, all the same
 * metal. Mirrors backend ARMOR_TYPES / ARMOR_METALS.
 */
export const ARMOR_TYPES = [
  "light",
  "medium",
  "heavy",
  "infantry",
  "mage",
] as const;

export type ArmorType = (typeof ARMOR_TYPES)[number];

export const ARMOR_METALS = [
  "iron",
  "steel",
  "bronze",
  "abyssalite",
  "mythril",
] as const;

/** Tier id sent to the backend: `light_iron`. Its shop base set is `light iron`. */
export function armorTier(type: string, metal: string): string {
  return `${type}_${metal}`;
}

/** `light_iron` → "Light Iron"; older bare tiers (`iron`, `mage`) → "Iron", "Mage". */
export function armorTierLabel(tier: string): string {
  return tier
    .split("_")
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

const HANDHELD = [
  "swords",
  "lutes",
  "battleaxes",
  "daggers",
  "warhammers",
  "shortswords",
  "hatchets",
  "hoes",
  "knives",
] as const;

const LARGE_HANDHELD = [
  "spears",
  "polearms",
  "greathammers",
  "staffs",
] as const;

/** Mirrors backend BASE_SETS; armour picks its metal here. */
export const BASE_SETS: Record<SkinKind, readonly string[]> = {
  armor_set: ARMOR_METALS,
  handheld: HANDHELD,
  large_handheld: LARGE_HANDHELD,
  bow: ["shortbows"],
  large_bow: ["longbows"],
  crossbow: ["crossbows"],
  item_3d: [...HANDHELD, ...LARGE_HANDHELD],
  shield: ["shields"],
  helmet_3d: ["helmets"],
  mask: ["masks"],
  gun: ["rifles", "pistols", "shotguns", "launchers"],
  book: ["books"],
};

const LABELS: Record<string, string> = {
  iron: "Iron",
  steel: "Steel",
  bronze: "Bronze",
  abyssalite: "Abyssalite",
  mythril: "Mythril",
  swords: "Swords",
  lutes: "Lutes",
  battleaxes: "Battleaxes",
  daggers: "Daggers",
  warhammers: "Warhammers",
  shortswords: "Shortswords",
  hatchets: "Hatchets",
  hoes: "Hoes",
  knives: "Knives",
  spears: "Spears",
  polearms: "Polearms",
  greathammers: "Greathammers",
  staffs: "Staffs",
  shortbows: "Shortbows",
  longbows: "Longbows",
  crossbows: "Crossbows",
  shields: "Shields",
  helmets: "Helmets",
  masks: "Masks",
  rifles: "Rifles",
  pistols: "Pistols",
  shotguns: "Shotguns",
  launchers: "Launchers",
  books: "Books",
};

export function baseSetsForKind(kind: SkinKind): readonly string[] {
  return BASE_SETS[kind];
}

export function baseSetLabel(id: string): string {
  return LABELS[id] ?? id;
}

export function defaultBaseSet(kind: SkinKind): string {
  return BASE_SETS[kind][0];
}

export function baseSetPickerTitle(kind: SkinKind): string {
  return kind === "armor_set" ? "Metal" : "Item type";
}
