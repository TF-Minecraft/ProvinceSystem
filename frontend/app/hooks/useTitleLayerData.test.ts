import { describe, expect, it } from "vitest";

import type { MapMode } from "../components/map/types";
import { CHRONICLE_MODE_SOURCE } from "../lib/map/dataSource";

import { EXTRA_FETCHES, assertDayScopedTitleExtra } from "./useTitleLayerData";

const TITLE_EXTRAS: MapMode[] = ["county", "duchy", "kingdom"];
const STATIC_MODES: MapMode[] = ["terrain", "fertility", "province"];
const DAY = "2026-08-31";

describe("assertDayScopedTitleExtra", () => {
  it("allows title extras on the live map", () => {
    for (const tier of TITLE_EXTRAS) {
      expect(() => assertDayScopedTitleExtra("main", tier, null)).not.toThrow();
    }
  });

  it("allows title extras under a stored day", () => {
    for (const tier of TITLE_EXTRAS) {
      expect(() => assertDayScopedTitleExtra("dev", tier, DAY)).not.toThrow();
    }
  });

  it("refuses a static extra under a stored day rather than fetching live", () => {
    for (const tier of STATIC_MODES) {
      expect(() => assertDayScopedTitleExtra("dev", tier, DAY)).toThrow(/refuses to fetch live/);
    }
  });
});

describe("EXTRA_FETCHES", () => {
  it("only asks for extras that a stored day answers with a day file", () => {
    const extras = new Set(Object.values(EXTRA_FETCHES).flatMap((tiers) => tiers ?? []));
    expect([...extras].sort()).toEqual([...TITLE_EXTRAS].sort());
    for (const tier of extras) {
      expect(CHRONICLE_MODE_SOURCE[tier]).toBe(tier);
    }
  });
});
