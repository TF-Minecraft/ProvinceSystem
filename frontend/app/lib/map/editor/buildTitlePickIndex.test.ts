import { describe, expect, it } from "vitest";

import { buildRgbToTitleId, pickTitleIdAt } from "./buildTitlePickIndex";

function makeImageData(
  width: number,
  height: number,
  pixels: Array<[number, number, number] | [number, number, number, number]>,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    const [r, g, b, a = 255] = pixels[i]!;
    const offset = i * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = a;
  }
  return { width, height, data } as ImageData;
}

describe("buildTitlePickIndex", () => {
  it("buildRgbToTitleId maps title rgb to ids", () => {
    const map = buildRgbToTitleId({
      TITLE_1: { name: "A", rgb: "58,132,60" },
      TITLE_2: { name: "B", rgb: "40,123,42" },
    });
    expect(map["58,132,60"]).toBe("TITLE_1");
    expect(map["40,123,42"]).toBe("TITLE_2");
  });

  it("pickTitleIdAt resolves title from pixel", () => {
    const imageData = makeImageData(2, 1, [
      [58, 132, 60],
      [40, 123, 42],
    ]);
    const rgbToTitleId = {
      "58,132,60": "TITLE_1",
      "40,123,42": "TITLE_2",
    };
    expect(pickTitleIdAt(imageData, 0, 0, rgbToTitleId)).toBe("TITLE_1");
    expect(pickTitleIdAt(imageData, 1, 0, rgbToTitleId)).toBe("TITLE_2");
    expect(pickTitleIdAt(imageData, 5, 0, rgbToTitleId)).toBeNull();
  });

  it("pickTitleIdAt treats transparent pixels as no title, even for a black title", () => {
    const imageData = makeImageData(4, 1, [
      [0, 0, 0, 0],
      [58, 132, 60, 0],
      [0, 0, 0, 255],
      [58, 132, 60, 128],
    ]);
    const rgbToTitleId = {
      "58,132,60": "TITLE_1",
      "0,0,0": "BLACK_TITLE",
    };
    expect(pickTitleIdAt(imageData, 0, 0, rgbToTitleId)).toBeNull();
    expect(pickTitleIdAt(imageData, 1, 0, rgbToTitleId)).toBeNull();
    expect(pickTitleIdAt(imageData, 2, 0, rgbToTitleId)).toBe("BLACK_TITLE");
    // Only fully transparent is empty; partial alpha keeps matching on RGB.
    expect(pickTitleIdAt(imageData, 3, 0, rgbToTitleId)).toBe("TITLE_1");
  });
});
