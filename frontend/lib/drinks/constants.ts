/** Common potion effects shown in the brew editor (blacklist filtered client-side). */
export const COMMON_EFFECTS = [
  "nausea",
  "blindness",
  "confusion",
  "hunger",
  "poison",
  "wither",
  "weakness",
  "slowness",
  "mining_fatigue",
  "levitation",
  "slow_falling",
  "darkness",
  "jump_boost",
  "night_vision",
  "water_breathing",
  "luck",
  "unluck",
  "glowing",
] as const;

const EFFECT_LABELS: Record<string, string> = {
  nausea: "Nausea",
  blindness: "Blindness",
  confusion: "Nausea (Confusion)",
  hunger: "Hunger",
  poison: "Poison",
  wither: "Wither",
  weakness: "Weakness",
  slowness: "Slowness",
  mining_fatigue: "Mining Fatigue",
  levitation: "Levitation",
  slow_falling: "Slow Falling",
  darkness: "Darkness",
  jump_boost: "Jump Boost",
  night_vision: "Night Vision",
  water_breathing: "Water Breathing",
  luck: "Luck",
  unluck: "Bad Luck",
  glowing: "Glowing",
};

export function effectLabel(id: string): string {
  const key = (id || "").trim().toLowerCase();
  if (EFFECT_LABELS[key]) return EFFECT_LABELS[key];
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** BreweryX recipes.yml wood indexes. The form submits the code. */
export const WOOD_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "0", label: "Any" },
  { id: "1", label: "Birch" },
  { id: "2", label: "Oak" },
  { id: "3", label: "Jungle" },
  { id: "4", label: "Spruce" },
  { id: "5", label: "Acacia" },
  { id: "6", label: "Dark Oak" },
  { id: "7", label: "Crimson" },
  { id: "8", label: "Warped" },
  { id: "9", label: "Mangrove" },
  { id: "10", label: "Cherry" },
  { id: "11", label: "Bamboo" },
  { id: "12", label: "Cut Copper" },
  { id: "13", label: "Pale Oak" },
];

export const MAX_PNG_BYTES = 512 * 1024;
export const EXPECTED_PNG_SIZE = 16;
