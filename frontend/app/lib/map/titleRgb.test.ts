import { describe, expect, it } from "vitest";

import { hexToRgbString, parseRgbString, rgbStringToHex, tweakRgbNear } from "./titleRgb";

describe("titleRgb", () => {
  it("rgbStringToHex converts map rgb to hex", () => {
    expect(rgbStringToHex("180,80,80")).toBe("#b45050");
  });

  it("hexToRgbString converts hex to map rgb", () => {
    expect(hexToRgbString("#b45050")).toBe("180,80,80");
  });

  it("round-trips rgb string and hex", () => {
    const rgb = "58,132,60";
    const hex = rgbStringToHex(rgb);
    expect(hex).toBeTruthy();
    expect(hexToRgbString(hex!)).toBe(rgb);
  });

  it("parseRgbString rejects invalid strings", () => {
    expect(parseRgbString("bad")).toBeNull();
    expect(parseRgbString("256,0,0")).toBeNull();
    expect(parseRgbString("10,20")).toBeNull();
  });

  it("tweakRgbNear returns base when unused", () => {
    expect(tweakRgbNear("10,20,30", [])).toBe("10,20,30");
  });

  it("tweakRgbNear finds unused colour when base collides", () => {
    const result = tweakRgbNear("10,20,30", ["10,20,30"]);
    expect(result).not.toBe("10,20,30");
    expect(parseRgbString(result)).not.toBeNull();
  });
});
