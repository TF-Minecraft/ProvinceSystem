import { describe, expect, it } from "vitest";

import {
  CHRONICLE_PROSPERITY_ALPHA,
  CHRONICLE_PROSPERITY_DOMAIN_MAX,
  CHRONICLE_PROSPERITY_RAMP,
  buildProsperityColorLut,
  chronicleProsperityFraction,
  chronicleProsperityRgb,
} from "./chronicleProsperity";

const unpack = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

describe("chronicleProsperityFraction", () => {
  it("puts an unprospering province exactly on the first stop", () => {
    expect(chronicleProsperityFraction(0)).toBe(0);
  });

  it("clamps at the fixed top of the domain instead of rescaling", () => {
    // The point of the fixed domain: a colour means the same number on every
    // frame, so a province warming over a timelapse warms on screen.
    expect(chronicleProsperityFraction(CHRONICLE_PROSPERITY_DOMAIN_MAX)).toBe(1);
    expect(chronicleProsperityFraction(CHRONICLE_PROSPERITY_DOMAIN_MAX * 10)).toBe(1);
  });

  it("rises monotonically", () => {
    const samples = [0, 0.5, 1, 5, 13, 39.3, 80];
    const fractions = samples.map(chronicleProsperityFraction);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]!).toBeGreaterThan(fractions[i - 1]!);
    }
  });

  it("spreads the ordinary values the real data actually holds", () => {
    // A straight ratio would put main's typical single-digit provinces in the
    // bottom tenth of the ramp and make the layer unreadable; the log lift is
    // what keeps them apart.
    expect(chronicleProsperityFraction(5)).toBeGreaterThan(0.3);
    expect(chronicleProsperityFraction(13)).toBeGreaterThan(0.5);
  });

  it("treats junk and negatives as the floor rather than throwing", () => {
    expect(chronicleProsperityFraction(Number.NaN)).toBe(0);
    expect(chronicleProsperityFraction(Number.POSITIVE_INFINITY)).toBe(0);
    expect(chronicleProsperityFraction(-12)).toBe(0);
  });
});

describe("chronicleProsperityRgb", () => {
  it("lands on the ramp's own ends", () => {
    expect(chronicleProsperityRgb(0)).toEqual([...CHRONICLE_PROSPERITY_RAMP[0]!]);
    expect(chronicleProsperityRgb(1)).toEqual([...CHRONICLE_PROSPERITY_RAMP[CHRONICLE_PROSPERITY_RAMP.length - 1]!]);
  });

  it("rises in luminance end to end, which is what makes it readable to everyone", () => {
    // Viridis is monotonic in lightness, so the ordering survives greyscale and
    // every common colour vision deficiency. A red-green ramp would not.
    const luminance = (rgb: number[]) => 0.299 * rgb[0]! + 0.587 * rgb[1]! + 0.114 * rgb[2]!;
    let previous = -1;
    for (let i = 0; i <= 20; i++) {
      const value = luminance(chronicleProsperityRgb(i / 20));
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it("clamps out-of-range and unusable fractions", () => {
    expect(chronicleProsperityRgb(-1)).toEqual(chronicleProsperityRgb(0));
    expect(chronicleProsperityRgb(4)).toEqual(chronicleProsperityRgb(1));
    expect(chronicleProsperityRgb(Number.NaN)).toEqual(chronicleProsperityRgb(0));
  });
});

describe("buildProsperityColorLut", () => {
  it("paints every province the day reports, zero included", () => {
    // A flat floor-colour map on day one is the honest picture of a world that
    // has not prospered yet, and it is what makes the first province to warm up
    // visible at all.
    const lut = buildProsperityColorLut([
      { id: 1, prosperity: 0 },
      { id: 3, prosperity: 12.5 },
    ]);
    expect(lut).toHaveLength(4);
    expect(lut[1]).not.toBe(0);
    expect(lut[3]).not.toBe(0);
    // Unmentioned provinces stay transparent, so a partial capture shows a hole
    // rather than a false floor.
    expect(lut[2]).toBe(0);
  });

  it("packs the shared alpha so the fill beneath still reads", () => {
    const lut = buildProsperityColorLut([{ id: 1, prosperity: 3 }]);
    expect(unpack(lut[1]!)[3]).toBe(CHRONICLE_PROSPERITY_ALPHA);
  });

  it("keeps the heat ordered by value", () => {
    const lut = buildProsperityColorLut([
      { id: 1, prosperity: 0 },
      { id: 2, prosperity: 40 },
    ]);
    const luminance = (packed: number) => {
      const [r, g, b] = unpack(packed);
      return 0.299 * r! + 0.587 * g! + 0.114 * b!;
    };
    expect(luminance(lut[2]!)).toBeGreaterThan(luminance(lut[1]!));
  });

  it("keeps the last row for a duplicated id", () => {
    const lut = buildProsperityColorLut([
      { id: 1, prosperity: 0 },
      { id: 1, prosperity: 40 },
    ]);
    expect(lut[1]).toBe(buildProsperityColorLut([{ id: 1, prosperity: 40 }])[1]);
  });
});

describe("buildProsperityColorLut against a malformed day file", () => {
  // Every one of these must produce a missing province rather than a throw:
  // there is no error boundary under `app/`, so a throw while this LUT is built
  // blanks the whole page instead of dropping one layer.
  it("treats a non-list payload as a day with no prosperity", () => {
    expect(buildProsperityColorLut(null)).toHaveLength(0);
    expect(buildProsperityColorLut(undefined)).toHaveLength(0);
    expect(buildProsperityColorLut({ 1: { prosperity: 5 } })).toHaveLength(0);
    expect(buildProsperityColorLut("nope")).toHaveLength(0);
  });

  it("drops torn rows and keeps the good ones beside them", () => {
    const lut = buildProsperityColorLut([
      null,
      "nope",
      42,
      { prosperity: 5 },
      { id: "7", prosperity: 5 },
      { id: 1.5, prosperity: 5 },
      { id: -3, prosperity: 5 },
      { id: 0, prosperity: 5 },
      { id: 2, prosperity: null },
      { id: 3, prosperity: "5" },
      { id: 4, prosperity: Number.NaN },
      { id: 5, prosperity: 7 },
    ]);
    expect(lut).toHaveLength(6);
    expect(lut[5]).not.toBe(0);
    for (const id of [0, 1, 2, 3, 4]) expect(lut[id]).toBe(0);
  });

  it("does not let one crafted id size the allocation", () => {
    // Same defence as `MAX_PAINTABLE_PROVINCE_ID` guards in `chroniclePaint`:
    // without it a single `"id": 2000000000` sizes this array — and the
    // per-frame device LUT derived from it — at 8 GB and wedges the tab.
    const lut = buildProsperityColorLut([
      { id: 2_000_000_000, prosperity: 5 },
      { id: 2, prosperity: 5 },
    ]);
    expect(lut).toHaveLength(3);
  });

  it("is empty when no row survived, rather than a stray one-entry table", () => {
    expect(buildProsperityColorLut([{ id: 0, prosperity: 5 }])).toHaveLength(0);
  });

  it("negative prosperity paints the floor instead of vanishing", () => {
    const lut = buildProsperityColorLut([{ id: 1, prosperity: -4 }]);
    expect(lut[1]).toBe(buildProsperityColorLut([{ id: 1, prosperity: 0 }])[1]);
  });
});
