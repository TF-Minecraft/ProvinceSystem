import { describe, expect, it } from "vitest";
import { WOOD_OPTIONS } from "./constants";

describe("WOOD_OPTIONS", () => {
  it("submits BreweryX wood indexes in order", () => {
    expect(WOOD_OPTIONS.map((opt) => [opt.id, opt.label])).toEqual([
      ["0", "Any"],
      ["1", "Birch"],
      ["2", "Oak"],
      ["3", "Jungle"],
      ["4", "Spruce"],
      ["5", "Acacia"],
      ["6", "Dark Oak"],
      ["7", "Crimson"],
      ["8", "Warped"],
      ["9", "Mangrove"],
      ["10", "Cherry"],
      ["11", "Bamboo"],
      ["12", "Cut Copper"],
      ["13", "Pale Oak"],
    ]);
  });
});
