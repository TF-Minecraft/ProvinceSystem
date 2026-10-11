import { expect, it } from "vitest";
import type { CreationCatalog } from "./api";
import { backgroundTraits } from "./background";

const CATALOG = {
  races: [
    { id: "human", name: "Human" },
    { id: "oseni", name: "Oseni" },
  ],
  traits: [
    {
      id: "beyond",
      name: "Outsider",
      key: "homeland",
      description: [
        "This character hails from some other civilization",
        "in the Great Main, or possibly even beyond...",
      ],
    },
    {
      id: "escapee",
      name: "Elusive Escapee",
      key: "cataclysm",
      description: [
        "This character or their parents escaped prison and/or",
        "lived on the run during the Decarian Cataclysm.",
        "Oseni: This character or their parents became cut",
        "off from, or deserted their previous warband.",
      ],
    },
    {
      id: "agile",
      name: "Agile",
      key: "physical",
      description: ["This character moves with swiftness and skill."],
    },
    { id: "str1", name: "Strength I", key: "attributes", description: [] },
  ],
} as unknown as CreationCatalog;

const SYNCED = [
  "This character hails from some other civilization",
  "in the Great Main, or possibly even beyond...",
  "This character or their parents escaped prison and/or",
  "lived on the run during the Decarian Cataclysm.",
  "Oseni: This character or their parents became cut",
  "off from, or deserted their previous warband.",
  "This character moves with swiftness and skill.",
].join("\n");

it("finds the creation choices behind a synced background", () => {
  const { traits, rest } = backgroundTraits(SYNCED, CATALOG, "human");
  expect(traits.map((t) => [t.key, t.name])).toEqual([
    ["homeland", "Outsider"],
    ["cataclysm", "Elusive Escapee"],
    ["physical", "Agile"],
  ]);
  expect(traits[0].description).toBe(
    "This character hails from some other civilization in the Great Main, or possibly even beyond...",
  );
  expect(traits[1].description).toBe(
    "This character or their parents escaped prison and/or lived on the run during the Decarian Cataclysm.",
  );
  expect(rest).toBe("");
});

it("reads a race's own version of a choice to that race", () => {
  const { traits } = backgroundTraits(SYNCED, CATALOG, "Oseni");
  expect(traits[1].description).toBe(
    "This character or their parents became cut off from, or deserted their previous warband.",
  );
});

it("keeps lines no choice explains as rejoined sentences", () => {
  const text = `Raised by wolves on the\nnorthern ridge.\n${SYNCED}\nLater lore line.`;
  const { traits, rest } = backgroundTraits(text, CATALOG, "human");
  expect(traits).toHaveLength(3);
  expect(rest).toBe("Raised by wolves on the northern ridge.\n\nLater lore line.");
  expect(backgroundTraits(SYNCED, null).rest).toBe(SYNCED.replaceAll("\n", " "));
});
