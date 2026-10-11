import { expect, it } from "vitest";
import type { CatalogTrait, CreationCatalog } from "./api";
import { attributeCeilings } from "./attributeCeiling";

const mod = (type: string, amount: number) => ({ type, amount });
const trait = (id: string, key: string, mods: [string, number][], extra: Partial<CatalogTrait> = {}): CatalogTrait => ({
  id,
  key,
  attribute_modifiers: mods.map(([t, a]) => mod(t, a)),
  ...extra,
});

/** A cut-down copy of Main's creator: same rules, fewer options. */
function catalog(overrides: Partial<CreationCatalog> = {}): CreationCatalog {
  return {
    stages: [
      { id: "race", type: "selection", target: "race", key: "race", min_select: 1, max_select: 1 },
      { id: "gift", type: "selection", target: "trait", key: "gift", min_select: 2, max_select: 2 },
      { id: "virtue", type: "selection", target: "trait", key: "virtue", min_select: 1, max_select: 1 },
      { id: "physical", type: "selection", target: "trait", key: "physical", min_select: 1, max_select: 3, points: 1 },
      { id: "attributes", type: "attributes", key: "attributes", points: 12, max_rank: 4 },
      { id: "personality", type: "selection", target: "trait", key: "personality", min_select: 1, max_select: 2 },
      {
        id: "injury",
        type: "selection",
        target: "trait",
        key: "injury",
        filter: "permanent-only",
        min_select: 0,
        max_select: 99,
      },
    ],
    attribute_point_buy: {
      pool: 12,
      max_rank: 4,
      cost_for_rank: [1, 2, 4, 8],
      attributes: ["strength", "dexterity"],
      abbreviations: { strength: "str", dexterity: "dex" },
      trait_id_pattern: "{abbr}{rank}",
    },
    races: [
      { id: "human", attribute_modifiers: [mod("strength", 4), mod("dexterity", 4)] },
      { id: "orc", attribute_modifiers: [mod("strength", 5), mod("dexterity", 3)] },
    ],
    traits: [
      trait("strength", "gift", [["strength", 2]]),
      trait("dexterity", "gift", [["dexterity", 2]]),
      trait("charisma", "gift", [["charisma", 2]]),
      trait("discipline", "virtue", [["strength", 1]], { mutually_exclusive: ["strength"] }),
      trait("finesse", "virtue", [["dexterity", 1]], { mutually_exclusive: ["dexterity"] }),
      trait("strong", "physical", [["strength", 2]], { cost: 1, mutually_exclusive: ["weak"] }),
      trait("weak", "physical", [["strength", -2]], { cost: -1, mutually_exclusive: ["strong"] }),
      trait("agile", "physical", [["dexterity", 2]], { cost: 1 }),
      trait("awkward", "physical", [["charisma", -2]], { cost: -1 }),
      trait("brave", "personality", []),
      trait("calm", "personality", []),
      trait("broken_arm", "injury", [["strength", 9]], { has_duration: true }),
      trait("str1", "attributes", [["strength", 1]]),
      trait("str2", "attributes", [["strength", 1]]),
      trait("str3", "attributes", [["strength", 1]]),
      trait("str4", "attributes", [["strength", 1]]),
    ],
    classes: [],
    validation: {},
    slot_limits: {},
    updated_at: null,
    ...overrides,
  } as CreationCatalog;
}

it("adds the best race, affordable rank and trait picks for each attribute", () => {
  // Strength: orc 5 + rank 3 (rank 4 costs 15 of 12) + gift 2 + strong 2; discipline clashes with the gift.
  // Dexterity: human 4 + rank 3 + gift 2 + agile 2. The timed broken arm is not a creation pick.
  expect(attributeCeilings(catalog())).toEqual({ strength: 12, dexterity: 11, charisma: 2 });
});

it("takes the virtue when no gift clashes with it", () => {
  const c = catalog();
  c.traits = c.traits.filter((t) => t.id !== "strength");
  expect(attributeCeilings(c)?.strength).toBe(5 + 3 + 1 + 2);
});

it("buys point-buy ranks as plain +1s when the rank traits are missing", () => {
  const c = catalog();
  c.attribute_point_buy = { ...c.attribute_point_buy!, pool: 15 };
  expect(attributeCeilings(c)?.dexterity).toBe(4 + 4 + 2 + 2);
});

it("has no ceiling without a catalogue", () => {
  expect(attributeCeilings(null)).toBeNull();
  expect(attributeCeilings({ stages: [] } as unknown as CreationCatalog)).toBeNull();
});
