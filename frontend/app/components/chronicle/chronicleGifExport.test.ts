import { describe, expect, it } from "vitest";

import { CHRONICLE_MEMORY_CEILING_BYTES } from "../../lib/map/chronicleBuild";
import { EMPTY_CHRONICLE_LAYERS } from "./chronicleLayers";
import { exportChronicleGif } from "./chronicleGifExport";

/**
 * Regression coverage for the export's byte-ceiling refusal (the "frames
 * retained without a ceiling" finding): `size * size * 4 * frames.length` is
 * checked and refused before anything else runs, so this can call
 * `exportChronicleGif` under plain node — no canvas and no `document` — and
 * still exercise the real refusal path.
 */
describe("exportChronicleGif memory ceiling", () => {
  function framesOfCount(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      day: `2000-01-${String((i % 28) + 1).padStart(2, "0")}`,
      image: null,
      layers: EMPTY_CHRONICLE_LAYERS,
    }));
  }

  it("refuses a request whose combined frame pixels exceed the ceiling, before touching a canvas", async () => {
    const size = 4096;
    const frameCount = 20; // 4096*4096*4*20 ≈ 1.3 GB, far past 256 MB.
    expect(size * size * 4 * frameCount).toBeGreaterThan(CHRONICLE_MEMORY_CEILING_BYTES);

    await expect(
      exportChronicleGif({
        frames: framesOfCount(frameCount),
        size,
        mapW: 100,
        mapH: 100,
        baseImage: null,
        fillOpacity: 1,
        delayMs: 100,
        loop: true,
        centroids: null,
        stampDay: false,
      }),
    ).rejects.toThrow(/fewer days or a smaller size/i);
  });

  it("does not refuse a request comfortably under the ceiling", async () => {
    const size = 64;
    const frameCount = 3;
    expect(size * size * 4 * frameCount).toBeLessThan(CHRONICLE_MEMORY_CEILING_BYTES);

    // No `document`/canvas exists under node, so this is expected to fail
    // later, past the ceiling check — the assertion is that it fails with a
    // *different* error, not the ceiling's.
    await expect(
      exportChronicleGif({
        frames: framesOfCount(frameCount),
        size,
        mapW: 100,
        mapH: 100,
        baseImage: null,
        fillOpacity: 1,
        delayMs: 100,
        loop: true,
        centroids: null,
        stampDay: false,
      }),
    ).rejects.not.toThrow(/fewer days or a smaller size/i);
  });
});
