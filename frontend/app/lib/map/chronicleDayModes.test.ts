import { describe, expect, it } from "vitest";

import {
  CHRONICLE_PROVINCE_PAINT_SOURCE,
  CHRONICLE_STATIC_MODES,
  chronicleProvincePaintLut,
  chronicleProvincePaintSource,
  isChronicleStaticMode,
  showsLiveProvinceRaster,
  usesChronicleProvincePaint,
} from "./chronicleDayModes";
import { CHRONICLE_FILE_NAMES } from "./chronicleData";
import { CHRONICLE_MODE_SOURCE } from "./dataSource";
import { CHRONICLE_PROSPERITY_ALPHA } from "./chronicleProsperity";
import type { MapMode } from "@/app/components/map/types";

const ALL_MODES: MapMode[] = [
  "nation",
  "county",
  "duchy",
  "kingdom",
  "empire",
  "terrain",
  "fertility",
  "province",
  "trade",
  "prosperity",
  "infestation",
];

const DAY = "2026-08-31";

describe("mode classification", () => {
  it("splits every map mode into exactly one of static, region-day, or raster-day", () => {
    for (const mode of ALL_MODES) {
      const isStatic = isChronicleStaticMode(mode);
      const isRegionDay = mode in CHRONICLE_MODE_SOURCE;
      const isRasterDay = mode in CHRONICLE_PROVINCE_PAINT_SOURCE;
      expect(
        [isStatic, isRegionDay, isRasterDay].filter(Boolean).length,
        `${mode} must be classified exactly once`
      ).toBe(1);
    }
  });

  it("classifies the three modes the user says never change as static", () => {
    expect([...CHRONICLE_STATIC_MODES].sort()).toEqual([
      "fertility",
      "province",
      "terrain",
    ]);
  });

  it("treats an unknown mode as non-static so it cannot leak live data", () => {
    expect(isChronicleStaticMode("something-new")).toBe(false);
  });

  it("names only day files the backend actually serves", () => {
    for (const file of Object.values(CHRONICLE_PROVINCE_PAINT_SOURCE)) {
      expect(CHRONICLE_FILE_NAMES).toContain(file);
    }
    for (const file of Object.values(CHRONICLE_MODE_SOURCE)) {
      expect(CHRONICLE_FILE_NAMES).toContain(file);
    }
  });
});

describe("chronicleProvincePaintSource", () => {
  it("is null for every mode that draws no province raster", () => {
    for (const mode of ["nation", "county", "duchy", "kingdom", "empire", "trade"] as MapMode[]) {
      expect(chronicleProvincePaintSource(mode, null)).toBeNull();
      expect(chronicleProvincePaintSource(mode, DAY)).toBeNull();
    }
  });

  it("keeps every raster mode live on the live map", () => {
    for (const mode of [
      "terrain",
      "fertility",
      "province",
      "prosperity",
      "infestation",
    ] as MapMode[]) {
      expect(chronicleProvincePaintSource(mode, null)).toEqual({ kind: "live" });
    }
  });

  it("keeps terrain, fertility and province live under a stored day", () => {
    for (const mode of ["terrain", "fertility", "province"] as MapMode[]) {
      expect(showsLiveProvinceRaster(mode, DAY)).toBe(true);
      expect(usesChronicleProvincePaint(mode, DAY)).toBe(false);
    }
  });

  it("day-scopes prosperity and infestation under a stored day", () => {
    expect(chronicleProvincePaintSource("prosperity", DAY)).toEqual({
      kind: "day",
      day: DAY,
      mapType: "prosperity",
      file: "province_data",
    });
    expect(chronicleProvincePaintSource("infestation", DAY)).toEqual({
      kind: "day",
      day: DAY,
      mapType: "infestation",
      file: "infestation_data",
    });
    expect(showsLiveProvinceRaster("prosperity", DAY)).toBe(false);
    expect(showsLiveProvinceRaster("infestation", DAY)).toBe(false);
  });
});

describe("chronicleProvincePaintLut", () => {
  it("paints prosperity through the shared ramp, alpha included", () => {
    const lut = chronicleProvincePaintLut("prosperity", [
      { id: 3, prosperity: 12 },
    ]);
    expect(lut.length).toBe(4);
    expect(lut[3]! & 0xff).toBe(CHRONICLE_PROSPERITY_ALPHA);
    expect(lut[1]).toBe(0);
  });

  it("paints infestation through the severity palette", () => {
    const lut = chronicleProvincePaintLut("infestation", [
      { id: 2, severity: "severe" },
    ]);
    expect(lut[2]! >>> 0).toBe(((180 << 24) | (20 << 16) | (20 << 8) | 240) >>> 0);
  });

  it("returns an empty LUT for a mode with no ramp rather than throwing", () => {
    expect(chronicleProvincePaintLut("nation", [{ id: 1 }]).length).toBe(0);
  });
});
