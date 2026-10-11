import { describe, expect, it } from "vitest";

import type { CatalogStage, CreationCatalog } from "./api";
import { characterNameError } from "../textValidation";
import {
  clueContinueBlockReason,
  dependencyMet,
  interactiveProgress,
  newDraft,
  pruneUnavailableTraits,
  stageCanContinue,
  traitDependencyBlocked,
  setTraitsForKey,
  stripInjuriesReplacedByProsthetics,
  toCreateBody,
} from "./wizardState";

function catalog(): CreationCatalog {
  return {
    stages: [],
    attribute_point_buy: {
      pool: 0,
      max_rank: 0,
      cost_for_rank: [],
      attributes: [],
    },
    races: [],
    classes: [],
    validation: {},
    slot_limits: {},
    updated_at: null,
    traits: [
      { id: "one_handed", name: "One-Handed", key: "injury", cost: 0 },
      { id: "blind", name: "Blind", key: "injury", cost: 0 },
      {
        id: "wooden_claw_arm",
        name: "Wooden Claw Arm",
        key: "prosthetic",
        cost: 1,
        replaces_injury: "one_handed",
      },
    ],
  };
}

describe("stripInjuriesReplacedByProsthetics", () => {
  it("drops matching injury when prosthetic is selected", () => {
    expect(stripInjuriesReplacedByProsthetics(["one_handed", "wooden_claw_arm", "blind"], catalog())).toEqual([
      "wooden_claw_arm",
      "blind",
    ]);
  });

  it("is case-insensitive on injury ids", () => {
    expect(stripInjuriesReplacedByProsthetics(["One_Handed", "wooden_claw_arm"], catalog())).toEqual([
      "wooden_claw_arm",
    ]);
  });
});

describe("setTraitsForKey", () => {
  it("clears injury after selecting a matching prosthetic", () => {
    const cat = catalog();
    let draft = newDraft(cat);
    draft = setTraitsForKey(draft, cat, "injury", ["one_handed", "blind"]);
    draft = setTraitsForKey(draft, cat, "prosthetic", ["wooden_claw_arm"]);
    expect(draft.traitIds).toEqual(["blind", "wooden_claw_arm"]);
  });

  it("clears matching injury when injury is selected after a prosthetic", () => {
    const cat = catalog();
    let draft = newDraft(cat);
    draft = setTraitsForKey(draft, cat, "prosthetic", ["wooden_claw_arm"]);
    draft = setTraitsForKey(draft, cat, "injury", ["one_handed", "blind"]);
    expect(draft.traitIds).toEqual(["wooden_claw_arm", "blind"]);
  });
});

describe("toCreateBody", () => {
  it("strips superseded injuries on submit", () => {
    const cat = catalog();
    const draft = newDraft(cat);
    draft.traitIds = ["one_handed", "wooden_claw_arm", "blind"];
    draft.name = "Test";
    draft.age = "20";
    draft.description = "A valid description here.";
    draft.race_id = "human";
    draft.class_id = "warrior";
    const body = toCreateBody(draft, { catalog: cat });
    expect(body.traits).toEqual(["wooden_claw_arm", "blind"]);
  });
});

describe("interactiveProgress", () => {
  const stages = ["info", "setter", "info", "selection", "summary"].map(
    (type, i) => ({ id: `s${i}`, type }) as CatalogStage,
  );

  it("counts an info card as the step it introduces", () => {
    expect(stages.map((_, i) => interactiveProgress(stages, i))).toEqual([
      { current: 1, total: 3 },
      { current: 1, total: 3 },
      { current: 2, total: 3 },
      { current: 2, total: 3 },
      { current: 3, total: 3 },
    ]);
  });

  it("stays on the last step for a trailing info card", () => {
    const trailing = [...stages, { id: "end", type: "info" } as CatalogStage];
    expect(interactiveProgress(trailing, 5)).toEqual({ current: 3, total: 3 });
  });
});

const EVIL_GATE = { type: "trait", mode: "one-or-more", depends_on: ["greedy", "callous"] };

function evilCatalog(): CreationCatalog {
  return {
    ...catalog(),
    races: [
      { id: "human", name: "Human", age_max: 110 },
      { id: "elf", name: "Elf", age_max: 210 },
    ],
    stages: [
      { id: "personality", type: "selection", target: "trait", key: "personality", max_select: 5 },
      {
        id: "evil",
        type: "selection",
        target: "trait",
        key: "evil",
        max_select: 2,
        dependency: EVIL_GATE,
        require_account_age_hours_min: 24,
      },
      { id: "age", type: "setter", target: "age" },
    ],
    traits: [
      { id: "greedy", name: "Greedy", key: "personality" },
      { id: "callous", name: "Callous", key: "personality" },
      {
        id: "mercenary",
        name: "Mercenary",
        key: "evil",
        dependency: { type: "trait", mode: "one-or-more", depends_on: ["greedy", "cynical"] },
      },
      { id: "elf_sight", name: "Elf Sight", key: "personality", dependency: { type: "race", depends_on: ["elf"] } },
    ],
    validation: { age: { minimum: 18 }, clues: { max_clues: 5, min_length: 3, max_length: 48 } },
  };
}

describe("dependencyMet", () => {
  it("matches RPCharacters trait modes, races and unknown types", () => {
    expect(dependencyMet(undefined, [])).toBe(true);
    expect(dependencyMet(EVIL_GATE, ["Callous"])).toBe(true);
    expect(dependencyMet(EVIL_GATE, ["honest"])).toBe(false);
    const both = { type: "trait", mode: "all", depends_on: ["greedy", "callous"] };
    expect(dependencyMet(both, ["greedy", "callous"])).toBe(true);
    expect(dependencyMet(both, ["greedy", "callous"], "", "callous")).toBe(false);
    expect(dependencyMet({ type: "race", depends_on: ["Elf"] }, [], "elf")).toBe(true);
    expect(dependencyMet({ type: "race", depends_on: ["elf"] }, [], "human")).toBe(false);
    expect(dependencyMet({ type: "faction", depends_on: ["x"] }, [])).toBe(false);
  });
});

describe("trait requirements", () => {
  it("blocks a pick whose requirement is missing", () => {
    const mercenary = evilCatalog().traits![2]!;
    expect(traitDependencyBlocked(mercenary, ["callous"], "human")).toBe(true);
    expect(traitDependencyBlocked(mercenary, ["greedy"], "human")).toBe(false);
  });

  it("drops evil picks once the unlocking personality is gone", () => {
    const cat = evilCatalog();
    const draft = { ...newDraft(cat), race_id: "human", traitIds: ["greedy", "mercenary"] };
    expect(pruneUnavailableTraits(draft, cat, { evilUnlocked: true })).toBe(draft);
    const swapped = { ...draft, traitIds: ["callous", "mercenary"] };
    expect(pruneUnavailableTraits(swapped, cat, { evilUnlocked: true }).traitIds).toEqual(["callous"]);
    const removed = { ...draft, traitIds: ["mercenary"] };
    expect(pruneUnavailableTraits(removed, cat, { evilUnlocked: true }).traitIds).toEqual([]);
    expect(pruneUnavailableTraits(draft, cat, { evilUnlocked: false }).traitIds).toEqual(["greedy"]);
  });

  it("drops race-only traits when the race changes", () => {
    const cat = evilCatalog();
    const elf = { ...newDraft(cat), race_id: "elf", traitIds: ["elf_sight", "unknown"] };
    expect(pruneUnavailableTraits(elf, cat).traitIds).toEqual(["elf_sight", "unknown"]);
    expect(pruneUnavailableTraits({ ...elf, race_id: "human" }, cat).traitIds).toEqual(["unknown"]);
  });
});

describe("plugin rule parity", () => {
  it("keeps age within the race's limit", () => {
    const cat = evilCatalog();
    const ageStage = cat.stages[2]!;
    const draft = { ...newDraft(cat), race_id: "human", age: "110" };
    expect(stageCanContinue(ageStage, draft, cat)).toBe(true);
    expect(stageCanContinue(ageStage, { ...draft, age: "111" }, cat)).toBe(false);
    expect(stageCanContinue(ageStage, { ...draft, race_id: "elf", age: "200" }, cat)).toBe(true);
  });

  it("refuses repeated clues", () => {
    const cat = evilCatalog();
    const draft = { ...newDraft(cat), clues: ["Blue coat", "blue coat"] };
    expect(clueContinueBlockReason(draft, cat)).toBe('Clue "blue coat" is repeated');
  });

  it("allows the names players already use and refuses digits", () => {
    for (const name of ["Dr. Dai", "Saul Go'Dar", "Sweyn Wolf-Fang", "Nøkk"]) {
      expect(characterNameError(name, { minLen: 3, maxLen: 24 })).toBeNull();
    }
    expect(characterNameError("Ar1a", { minLen: 3, maxLen: 24 })).toBe(
      "Name may only contain letters, spaces, apostrophes, hyphens and full stops",
    );
    expect(characterNameError("Al", { minLen: 3, maxLen: 24 })).toBe("Name must be at least 3 characters");
  });
});
