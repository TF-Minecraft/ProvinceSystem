import { describe, expect, it } from "vitest";

import { buildProvinceToCountyId } from "./countyAssignment";
import {
  buildProvinceIndexFromGrid,
  deserializeProvinceIdGrid,
} from "./buildProvinceIndex";

describe("deserializeProvinceIdGrid", () => {
  it("unpacks width height and row-major ids", () => {
    const header = new ArrayBuffer(8);
    const headerView = new DataView(header);
    headerView.setInt32(0, 2, true);
    headerView.setInt32(4, 2, true);

    const body = new Uint16Array([1, 2, 1, 2]);
    const bytes = new Uint8Array(8 + body.byteLength);
    bytes.set(new Uint8Array(header), 0);
    bytes.set(new Uint8Array(body.buffer), 8);

    const { width, height, ids } = deserializeProvinceIdGrid(bytes.buffer);
    expect(width).toBe(2);
    expect(height).toBe(2);
    expect(Array.from(ids)).toEqual([1, 2, 1, 2]);
  });
});

describe("buildProvinceIndexFromGrid", () => {
  it("maps grid ids and ocean pixels while retaining catalogue colours", () => {
    const provinces = [
      { id: 1, rgb: "58,132,60" },
      { id: 2, rgb: "40,123,42" },
    ];
    const index = buildProvinceIndexFromGrid(
      provinces, 2, 2, new Uint16Array([1, 2, 0, 1])
    );

    expect(index.width).toBe(2);
    expect(index.height).toBe(2);
    expect(index.rgbToProvinceId).toEqual({ "58,132,60": 1, "40,123,42": 2 });
    expect(index.provinceToRgb).toEqual({ 1: "58,132,60", 2: "40,123,42" });
    expect(Array.from(index.provinceMap)).toEqual([1, 2, -1, 1]);
  });
});

describe("buildProvinceToCountyId", () => {
  it("maps province ids to county ids", () => {
    const map = buildProvinceToCountyId({
      COUNTY_1: { provinces: [1, 2] },
      COUNTY_2: { provinces: [3] },
    });
    expect(map.get(1)).toBe("COUNTY_1");
    expect(map.get(3)).toBe("COUNTY_2");
    expect(map.get(99)).toBeUndefined();
  });
});
