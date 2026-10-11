import { describe, expect, it } from "vitest";

import {
  CHRONICLE_INFESTATION_SEVERITY_RGBA,
  buildInfestationColorLut,
  chronicleInfestationRgba,
  chronicleInfestationRows,
} from "./chronicleInfestation";
import { MAX_PAINTABLE_PROVINCE_ID } from "./chroniclePaint";

const packed = (r: number, g: number, b: number, a: number) => ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;

describe("chronicleInfestationRgba", () => {
  it("matches the backend palette exactly", () => {
    expect(chronicleInfestationRgba("mild")).toEqual([230, 200, 40, 220]);
    expect(chronicleInfestationRgba("worrying")).toEqual([220, 120, 20, 230]);
    expect(chronicleInfestationRgba("severe")).toEqual([180, 20, 20, 240]);
    expect(chronicleInfestationRgba("extreme")).toEqual([90, 0, 0, 255]);
  });

  it("normalises case and whitespace like the backend does", () => {
    expect(chronicleInfestationRgba("  SEVERE ")).toEqual(CHRONICLE_INFESTATION_SEVERITY_RGBA.severe);
  });

  it("refuses anything the palette does not name", () => {
    for (const value of ["", "   ", "legendary", null, 3, {}, undefined]) {
      expect(chronicleInfestationRgba(value)).toBeNull();
    }
  });

  it("does not answer for inherited object keys", () => {
    expect(chronicleInfestationRgba("constructor")).toBeNull();
    expect(chronicleInfestationRgba("toString")).toBeNull();
  });
});

describe("chronicleInfestationRows", () => {
  it("accepts both shapes the backend loader accepts", () => {
    expect(chronicleInfestationRows([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(chronicleInfestationRows({ provinces: [{ id: 2 }] })).toEqual([{ id: 2 }]);
  });

  it("yields nothing for a payload it cannot read", () => {
    for (const value of [null, undefined, 7, "rows", {}, { provinces: 3 }]) {
      expect(chronicleInfestationRows(value)).toEqual([]);
    }
  });
});

describe("buildInfestationColorLut", () => {
  it("paints only the infested provinces", () => {
    const lut = buildInfestationColorLut([
      { id: 1, severity: "mild" },
      { id: 4, severity: "extreme" },
    ]);
    expect(lut.length).toBe(5);
    expect(lut[1]).toBe(packed(230, 200, 40, 220));
    expect(lut[2]).toBe(0);
    expect(lut[3]).toBe(0);
    expect(lut[4]).toBe(packed(90, 0, 0, 255));
  });

  it("accepts numeric-string ids, since the backend coerces with int()", () => {
    const lut = buildInfestationColorLut([{ id: "6", severity: "severe" }]);
    expect(lut[6]).toBe(packed(180, 20, 20, 240));
  });

  it("skips torn rows instead of throwing", () => {
    const lut = buildInfestationColorLut([
      null,
      "row",
      { severity: "mild" },
      { id: 0, severity: "mild" },
      { id: -2, severity: "mild" },
      { id: 1.5, severity: "mild" },
      { id: "x", severity: "mild" },
      { id: 2, severity: "unheard-of" },
      { id: 2, severity: null },
      { id: 3, severity: "mild" },
    ]);
    expect(lut.length).toBe(4);
    expect(lut[3]).toBe(packed(230, 200, 40, 220));
    expect(lut[2]).toBe(0);
  });

  it("refuses to be sized by a crafted province id", () => {
    const lut = buildInfestationColorLut([{ id: MAX_PAINTABLE_PROVINCE_ID + 1, severity: "mild" }]);
    expect(lut.length).toBe(0);
  });

  it("keeps the last row for a duplicated id", () => {
    const lut = buildInfestationColorLut([
      { id: 2, severity: "mild" },
      { id: 2, severity: "extreme" },
    ]);
    expect(lut[2]).toBe(packed(90, 0, 0, 255));
  });

  it("returns an empty LUT when nothing is usable", () => {
    expect(buildInfestationColorLut(null).length).toBe(0);
    expect(buildInfestationColorLut([{ id: 1, severity: "none" }]).length).toBe(0);
  });
});
