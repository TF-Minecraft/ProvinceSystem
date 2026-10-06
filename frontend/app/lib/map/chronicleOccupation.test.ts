import { describe, expect, it } from "vitest";

import { expandChronicleBorderMask } from "./chronicleBorderMask";
import {
  CHRONICLE_OCCUPATION_SEAM_RGBA,
  chronicleDayColorLut,
  chronicleOccupationSeamThickness,
  computeChronicleOccupationSeamMask,
  occupationDisplayRgb,
} from "./chronicleOccupation";
import type { NationOwnership, ProvinceIdGrid } from "./chroniclePaint";

/**
 * A 4x4 grid. Province 1 is Red's home, province 2 is land Red occupies,
 * province 3 is a bystander, 0 is ocean.
 *
 *   1 1 2 2
 *   1 1 2 2
 *   3 3 0 0
 *   3 3 0 0
 */
const grid: ProvinceIdGrid = {
  width: 4,
  height: 4,
  ids: new Uint16Array([1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 0, 0, 3, 3, 0, 0]),
};

const ownership: NationOwnership = {
  red: { rgb: "200,40,40", provinces: [1], occupied_held: [2] },
  blue: { rgb: "40,40,200", provinces: [3] },
};

function packed(lut: Uint32Array, id: number): [number, number, number] {
  const value = lut[id] ?? 0;
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff];
}

function setBits(bits: Uint8Array, pixelCount: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pixelCount; i++) {
    if ((bits[i >> 3]! >>> (i & 7)) & 1) out.push(i);
  }
  return out;
}

describe("occupationDisplayRgb", () => {
  it("mutes toward the colour's own luminance grey by the server's blend", () => {
    // `display_colour.occupation_display_rgb`: 22% of the way to a grey of the
    // same luminance, using the same 0.299/0.587/0.114 weights.
    const [r, g, b] = occupationDisplayRgb([200, 40, 40]);
    const luminance = 0.299 * 200 + 0.587 * 40 + 0.114 * 40;
    expect(r).toBe(Math.round(200 + (luminance - 200) * 0.22));
    expect(g).toBe(Math.round(40 + (luminance - 40) * 0.22));
    expect(b).toBe(Math.round(40 + (luminance - 40) * 0.22));
    expect(r).toBeLessThan(200);
    expect(g).toBeGreaterThan(40);
  });

  it("leaves a grey untouched, since it is already its own grey", () => {
    expect(occupationDisplayRgb([128, 128, 128])).toEqual([128, 128, 128]);
  });
});

describe("chronicleDayColorLut", () => {
  it("paints home land only when the fill is on alone", () => {
    const lut = chronicleDayColorLut(ownership, {
      fill: true,
      occupation: false,
    });
    expect(packed(lut, 1)).toEqual([173, 95, 94]);
    expect(lut[2] ?? 0).toBe(0);
  });

  it("paints occupied land in the occupier's muted colour, fill or no fill", () => {
    const muted = occupationDisplayRgb([173, 95, 94]);
    const both = chronicleDayColorLut(ownership, {
      fill: true,
      occupation: true,
    });
    expect(packed(both, 1)).toEqual([173, 95, 94]);
    expect(packed(both, 2)).toEqual(muted);

    // The layer has to stand alone: with the fill off, occupied ground is the
    // only thing painted and home land stays bare parchment.
    const alone = chronicleDayColorLut(ownership, {
      fill: false,
      occupation: true,
    });
    expect(packed(alone, 2)).toEqual(muted);
    expect(alone[1] ?? 0).toBe(0);
  });

  it("gives an empty table when neither layer is on", () => {
    expect(
      chronicleDayColorLut(ownership, { fill: false, occupation: false }).length
    ).toBe(1);
    expect(
      chronicleDayColorLut(null, { fill: true, occupation: true }).length
    ).toBe(1);
  });

  it("skips a nation the fill could not paint either", () => {
    const lut = chronicleDayColorLut(
      { ghost: { provinces: [1], occupied_held: [2] } },
      { fill: true, occupation: true }
    );
    expect(lut[1] ?? 0).toBe(0);
    expect(lut[2] ?? 0).toBe(0);
  });

  it("survives a day file whose province lists are not arrays", () => {
    // Unvalidated network JSON reaching `for...of` is what blanks the page —
    // there is no error boundary under `app/`.
    const malformed = {
      red: { rgb: "1,2,3", provinces: {}, occupied_held: "nope" },
    } as unknown as NationOwnership;
    expect(() =>
      chronicleDayColorLut(malformed, { fill: true, occupation: true })
    ).not.toThrow();
    expect(
      chronicleDayColorLut(malformed, { fill: true, occupation: true }).length
    ).toBe(1);
  });

  it("does not size the table off an absurd occupied id", () => {
    const lut = chronicleDayColorLut(
      { red: { rgb: "1,2,3", occupied_held: [2_000_000_000] } },
      { fill: false, occupation: true }
    );
    expect(lut.length).toBe(1);
  });
});

describe("computeChronicleOccupationSeamMask", () => {
  it("marks the occupied pixels that touch the same nation's home land", () => {
    const mask = computeChronicleOccupationSeamMask(grid, ownership)!;
    expect(mask).not.toBeNull();
    // The seam sits on the occupation side only, which is what makes it read
    // as a rim around the conquest rather than as a border between two realms.
    expect(setBits(mask.bits, 16)).toEqual([2, 6]);
  });

  it("stays a single pixel wide at quarter scale, and thickens at source", () => {
    // The server stamps 3x3 at 6400; a quarter-scale pixel is already four
    // source pixels across, so rounding down is the closest match available.
    expect(chronicleOccupationSeamThickness(1600)).toBe(0);
    expect(chronicleOccupationSeamThickness(6400)).toBe(1);
  });

  it("returns null when nothing is occupied", () => {
    expect(
      computeChronicleOccupationSeamMask(grid, {
        red: { rgb: "200,40,40", provinces: [1] },
      })
    ).toBeNull();
    expect(computeChronicleOccupationSeamMask(grid, null)).toBeNull();
  });

  it("draws no seam where the occupier holds no adjoining home land", () => {
    // Province 2 is occupied by Blue, whose only home land (3) does not touch
    // it. The server compares against *that nation's* home wash, not any wash.
    expect(
      computeChronicleOccupationSeamMask(grid, {
        red: { rgb: "200,40,40", provinces: [1] },
        blue: { rgb: "40,40,200", provinces: [3], occupied_held: [2] },
      })
    ).toBeNull();
  });

  it("expands into the server's occupation ink", () => {
    const mask = computeChronicleOccupationSeamMask(grid, ownership)!;
    const output = new Uint8ClampedArray(16 * 4);
    expandChronicleBorderMask(mask, output, {
      ink: CHRONICLE_OCCUPATION_SEAM_RGBA,
    });
    expect(Array.from(output.slice(8, 12))).toEqual([150, 72, 66, 210]);
    expect(Array.from(output.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it("rejects a grid whose header disagrees with its ids", () => {
    expect(() =>
      computeChronicleOccupationSeamMask(
        { width: 4, height: 4, ids: new Uint16Array(3) },
        ownership
      )
    ).toThrow();
  });
});
