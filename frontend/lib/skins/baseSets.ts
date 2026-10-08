import type { SkinKind } from "./sizes";

/** Armour tiers. Mirrors backend ARMOR_TIERS. */
export const ARMOR_TIERS = [
  "iron",
  "steel",
  "abyssalite",
  "mythril",
  "mage",
  "infantry",
] as const;

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

/** Mirrors backend BASE_SETS. */
export const BASE_SETS: Record<SkinKind, readonly string[]> = {
  armor_set: ["iron", "steel", "abyssalite", "mythril", "mage", "infantry"],
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
  abyssalite: "Abyssalite",
  mythril: "Mythril",
  mage: "Mage",
  infantry: "Infantry",
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
  return kind === "armor_set" ? "Armour tier" : "Item type";
}
