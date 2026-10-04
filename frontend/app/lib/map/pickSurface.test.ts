/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import {
  EMPTY_PICK_SURFACE,
  PickSurfaceBuilder,
  pickSurfaceFromImage,
  pickSurfaceFromImageData,
} from "./pickSurface";

function image(rows: [number, number, number, number][][]) {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => row.forEach((px, x) => data.set(px, (y * width + x) * 4)));
  return { data, width, height };
}

const A: [number, number, number, number] = [10, 20, 30, 255];
const B: [number, number, number, number] = [40, 50, 60, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

describe("PickSurface", () => {
  it("answers every pixel with the colour a canvas would read back", () => {
    const surface = pickSurfaceFromImageData(
      image([
        [A, A, B, B, A],
        [B, B, B, B, B],
        [CLEAR, A, A, CLEAR, B],
      ])
    );
    expect([0, 1, 2, 3, 4].map((x) => surface.rgbAt(x, 0))).toEqual([
      "10,20,30",
      "10,20,30",
      "40,50,60",
      "40,50,60",
      "10,20,30",
    ]);
    expect(surface.rgbAt(4, 1)).toBe("40,50,60");
    expect(surface.rgbAt(0, 2)).toBe("0,0,0");
    expect(surface.rgbAt(2, 2)).toBe("10,20,30");
    expect(surface.rgbAt(4, 2)).toBe("40,50,60");
  });

  it("reads a transparent pixel as 0,0,0 whatever colour it carries", () => {
    const surface = pickSurfaceFromImageData(image([[[10, 20, 30, 0], A]]));
    expect(surface.rgbAt(0, 0)).toBe("0,0,0");
    expect(surface.rgbAt(1, 0)).toBe("10,20,30");
  });

  it("has nothing outside the map", () => {
    const surface = pickSurfaceFromImageData(image([[A, B]]));
    expect(surface.rgbAt(-1, 0)).toBeNull();
    expect(surface.rgbAt(2, 0)).toBeNull();
    expect(surface.rgbAt(0, 1)).toBeNull();
    expect(EMPTY_PICK_SURFACE.rgbAt(0, 0)).toBeNull();
  });

  it("grows past its first guess at the number of runs", () => {
    const width = 3000;
    const builder = new PickSurfaceBuilder(width, 1);
    const data = new Uint8ClampedArray(width * 4);
    for (let x = 0; x < width; x++) data.set(x % 2 ? A : B, x * 4);
    builder.addRows(data, 1);
    const surface = builder.finish();
    expect(surface.rgbAt(0, 0)).toBe("40,50,60");
    expect(surface.rgbAt(2999, 0)).toBe("10,20,30");
  });

  it("reads an image band by band and stops when cancelled", async () => {
    const rows = 600;
    const width = 2;
    const draws: number[] = [];
    let bandTop = 0;
    let clock = 0;
    const ctx = {
      clearRect: () => {},
      drawImage: (_s: unknown, _sx: number, sy: number) => {
        draws.push(sy);
        bandTop = sy;
        clock += 5;
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let r = 0; r < h; r++) data.set(bandTop + r < 300 ? A : B, r * w * 4);
        return { data };
      },
    };
    const original = document.createElement.bind(document);
    const createElement = (tag: string) => {
      const element = original(tag);
      if (tag === "canvas") {
        (element as HTMLCanvasElement).getContext = (() => ctx) as never;
      }
      return element;
    };
    document.createElement = createElement as typeof document.createElement;
    try {
      // Each band "takes" 5 ms: two fill the 8 ms budget, then a frame.
      let yields = 0;
      const surface = await pickSurfaceFromImage(
        {} as CanvasImageSource,
        width,
        rows,
        () => false,
        async () => {
          yields += 1;
        },
        () => clock
      );
      expect(draws).toEqual([0, 64, 128, 192, 256, 320, 384, 448, 512, 576]);
      expect(yields).toBe(5);
      expect(surface?.rgbAt(0, 299)).toBe("10,20,30");
      expect(surface?.rgbAt(1, 300)).toBe("0,0,0");
      expect(surface?.rgbAt(0, 300)).toBe("40,50,60");

      let frames = 0;
      const stopped = await pickSurfaceFromImage(
        {} as CanvasImageSource,
        width,
        rows,
        () => frames > 0,
        async () => {
          frames += 1;
        },
        () => clock
      );
      expect(stopped).toBeNull();
    } finally {
      document.createElement = original;
    }
  });
});
