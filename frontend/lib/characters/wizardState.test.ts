import { describe, expect, it } from "vitest";

import type { CreationCatalog } from "./api";
import { newDraft, setTraitsForKey, stripInjuriesReplacedByProsthetics, toCreateBody } from "./wizardState";

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
