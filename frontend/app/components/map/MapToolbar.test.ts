import { describe, expect, it } from "vitest";

import { mapToolbarModeOptions } from "./MapToolbar";
import type { MapMode } from "./types";

const ALL_MODES: MapMode[] = [
  "nation",
  "county",
  "duchy",
  "kingdom",
  "empire",
  "province",
  "terrain",
  "fertility",
  "trade",
  "prosperity",
  "infrastructure",
  "infestation",
];

describe("mapToolbarModeOptions", () => {
  it("offers every map mode, including extras that used to be main/dev only", () => {
    const values = mapToolbarModeOptions().map((opt) => opt.value);
    expect(values).toHaveLength(12);
    expect(values).toEqual(ALL_MODES);
  });
});
