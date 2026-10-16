import { describe, expect, it } from "vitest";

import { pickProvinceAt } from "./useEditorPick";
import { buildProvinceRunIndex, type ProvinceIndex } from "@/app/lib/map/editor/buildProvinceIndex";

describe("pickProvinceAt", () => {
  it("reads the flat province map when no runs are present", () => {
    const index: ProvinceIndex = {
      rgbToProvinceId: {},
      provinceToRgb: {},
      provinceMap: Int32Array.from([4, -1, 9, 9]),
      width: 2,
      height: 2,
    };
    expect(pickProvinceAt(index, 0, 0)).toBe(4);
    expect(pickProvinceAt(index, 1, 0)).toBeNull();
    expect(pickProvinceAt(index, 1, 1)).toBe(9);
    expect(pickProvinceAt(index, 5, 5)).toBeNull();
  });

  it("prefers runs and never materialises the flat province map", () => {
    const runs = buildProvinceRunIndex(2, 2, Uint32Array.from([1, 1, 2]), Uint16Array.from([4, 0, 9]));
    const index = {
      rgbToProvinceId: {},
      provinceToRgb: {},
      width: 2,
      height: 2,
      runs,
      get provinceMap(): Int32Array {
        throw new Error("provinceMap must not be materialised on the runs path");
      },
    } as ProvinceIndex;
    expect(pickProvinceAt(index, 0, 0)).toBe(4);
    expect(pickProvinceAt(index, 1, 0)).toBeNull();
    expect(pickProvinceAt(index, 0, 1)).toBe(9);
    expect(pickProvinceAt(index, 5, 5)).toBeNull();
  });
});
