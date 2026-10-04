import { describe, expect, it } from "vitest";

import { mapModeLabel, mapModeOptions, mapModeTileLayer } from "./mapModes";
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
  "infestation",
];

describe("mapModeOptions", () => {
  it("offers every map mode for each map", () => {
    const values = mapModeOptions().map((opt) => opt.value);
    expect(values).toHaveLength(11);
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

describe("mapModeTileLayer", () => {
  it("gives every mode the pyramid the live map colours it from", () => {
    expect(mapModeTileLayer("nation")).toBe("regions-nation");
    expect(mapModeTileLayer("trade")).toBe("regions-trade");
    expect(mapModeTileLayer("terrain")).toBe("mapdata-terrain");
    expect(mapModeTileLayer("province")).toBe("mapdata-province");
    for (const mode of ALL_MODES) expect(mapModeTileLayer(mode)).not.toBeNull();
  });
});
