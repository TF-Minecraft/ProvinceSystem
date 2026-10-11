import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { build, cookingOrigin, parseRef, parseStationRecipes } from "./build-station-recipes.mjs";

describe("station recipe parsing", () => {
  it("reads recipes indented 4/6/8 and 4/8/12 in the same file", () => {
    const { recipes, unparsed } = parseStationRecipes(`
recipes:
    narrow:
      output:
        type: PETS
        id: PET_BALL
        amount: 1
      conditions:
      - permission{list="legacy";display="Requires Legacy"}
      ingredients:
      - 'vanilla{type=BONE,amount=16}'
    wide:
        output: 'itemsadder{id="tfmc:pet_house",amount=1}'
        crafting-time: 5
        ingredients:
        - 'vanilla{type=OAK_PLANKS,amount=8}'
        options:
            hide-when-locked: true
`);
    expect(unparsed).toEqual([]);
    expect(recipes.map((recipe) => recipe.key)).toEqual(["narrow", "wide"]);
    expect(recipes[0].fields.output).toEqual({ type: "PETS", id: "PET_BALL", amount: "1" });
    expect(recipes[0].fields.ingredients).toEqual(["vanilla{type=BONE,amount=16}"]);
    expect(recipes[1].fields.options).toEqual({ "hide-when-locked": "true" });
  });

  it("still reports lines it cannot place", () => {
    const { unparsed } = parseStationRecipes(`
recipes:
    broken:
        output:
          stray: 1
            deeper: 2
`);
    expect(unparsed.map((line) => line.text.trim())).toEqual(["deeper: 2"]);
  });

  it("reads the vanilla origin of a Cooking food", () => {
    const ref = parseRef('cooking{item="seafood(type=seafood_whole;origin=Tropical Fish)",amount=64,display="Tropical Fish"}');
    expect(cookingOrigin(ref)).toBe("Tropical_Fish");
  });
});

describe("station recipe build", () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("shows a Cooking food under its own name with its vanilla identity", () => {
    dir = mkdtempSync(path.join(tmpdir(), "stations-"));
    writeFileSync(path.join(dir, "animal-station.yml"), `
recipes:
    meat-treat:
        output:
            type: PETS
            id: MEAT_TREAT
            amount: 1
        ingredients:
        - 'cooking{item="meat(type=meat_red_meat;origin=Beef)",amount=2,display="Beef Steak"}'
        - 'vanilla{type=BEEF,amount=1}'
`);
    const { recipes } = build({ sourceDir: dir, textureIndex: { byName: new Map() } });
    const [steak, beef] = recipes[0].ingredients;
    expect(steak).toMatchObject({ name: "Beef Steak", qty: 2, sourceId: "vanilla:beef" });
    // The Cooking display name must not rename plain vanilla beef.
    expect(beef).toMatchObject({ name: "Beef", sourceId: "vanilla:beef" });
  });
});
