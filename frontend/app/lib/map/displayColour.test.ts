import { describe, expect, it } from "vitest";

import { parchmentWashRgb } from "./displayColour";

describe("parchmentWashRgb", () => {
  it("matches the server wash for the colours the map actually paints", () => {
    // Pinned from display_colour.parchment_wash_rgb, including the green hue
    // pull and the truncated paper blend. A raw faction RGB here would paint
    // the chronicle harsher than the overlay beside it.
    expect(parchmentWashRgb([200, 40, 40])).toEqual([173, 95, 94]);
    expect(parchmentWashRgb([40, 40, 200])).toEqual([96, 95, 171]);
    expect(parchmentWashRgb([255, 0, 0])).toEqual([193, 79, 77]);
    expect(parchmentWashRgb([0, 255, 0])).toEqual([98, 192, 77]);
    expect(parchmentWashRgb([30, 25, 20])).toEqual([131, 120, 108]);
    expect(parchmentWashRgb([128, 128, 128])).toEqual([136, 136, 134]);
    expect(parchmentWashRgb([10, 20, 30])).toEqual([95, 119, 143]);
  });
});
