import { describe, expect, it } from "vitest";

import { mapModeLabel, mapModeOptions } from "./mapModes";
import type { MapMode } from "./types";

const ALL_MODES: MapMode[] = [
  "nation",
  "empire",
  "kingdom",
  "duchy",
  "county",
  "province",
  "terrain",
  "fertility",
  "trade",
  "prosperity",
  "infrastructure",
  "infestation",
];

describe("mapModeOptions", () => {
  it("offers every map mode, including extras that used to be main/dev only", () => {
    const values = mapModeOptions().map((opt) => opt.value);
    expect(values).toHaveLength(12);
    expect(values).toEqual(ALL_MODES);
  });

  it("puts realms first, then the title tiers from the top, then the world modes", () => {
    const groups = mapModeOptions().map((opt) => opt.group);
    expect(groups[0]).toBe("realms");
    expect(groups.slice(1, 5).every((group) => group === "titles")).toBe(true);
    expect(groups.slice(5).every((group) => group === "world")).toBe(true);
  });
});

describe("mapModeLabel", () => {
  it("names the nation map Realms", () => {
    expect(mapModeLabel("nation")).toBe("Realms");
    expect(mapModeLabel("infestation")).toBe("Infestation");
  });
});
