/**
 * @vitest-environment jsdom
 *
 * Checks main-thread export chunking: Turbopack cannot bundle the browser
 * Worker (see `encodeGif.ts` for build evidence), so both frame loops must
 * yield to repaint progress and process cancellation during encoding too.
 * Frames stay in a local array until encoding finishes, making the memory
 * ceiling essential before any pixel allocation; it is asserted here as well
 * as in `chronicleGifExport.test.ts`.
 *
 * jsdom has no 2D context, so `getContext` is stubbed with a proxy that
 * no-ops everything except `getImageData` (real, correctly-sized pixels) and
 * `measureText`. `scheduler.yield` is stubbed too — that stub is the counter
 * the yield assertions read, and it doubles as coverage of the
 * `scheduler.yield`-over-`setTimeout` preference in `yieldToEventLoop`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeGifSteps } from "../../lib/map/gif/encodeGif";
import { CHRONICLE_MEMORY_CEILING_BYTES } from "../../lib/map/chronicleBuild";
import { EMPTY_CHRONICLE_LAYERS } from "./chronicleLayers";
import {
  exportChronicleGif,
  isChronicleGifCancelled,
  type ChronicleGifProgress,
} from "./chronicleGifExport";

const SIZE = 8;

function makeFakeCtx(edge: number): CanvasRenderingContext2D {
  const store: Record<string, unknown> = {};
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "getImageData") {
          return () => ({ data: new Uint8ClampedArray(edge * edge * 4) });
        }
        if (prop === "measureText") return () => ({ width: 10 });
        if (prop in store) return store[prop as string];
        return () => undefined;
      },
      set(_target, prop, value) {
        store[prop as string] = value;
        return true;
      },
    }
  ) as unknown as CanvasRenderingContext2D;
}

/** Fails synchronously: `loadImages` treats a failed icon as "draw without
 * it", so this keeps the one `await loadImages(...)` from hanging on jsdom's
 * un-implemented image loading. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onerror?.());
  }
}

/** Installs the fakes and returns the live yield counter. */
function install(edge = SIZE): { count: number } {
  const counter = { count: 0 };
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
  vi.stubGlobal("scheduler", {
    yield: () => {
      counter.count += 1;
      return Promise.resolve();
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() =>
    makeFakeCtx(edge)
  );
  return counter;
}

function framesOfCount(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    day: `2000-01-${String((i % 28) + 1).padStart(2, "0")}`,
    image: null,
    layers: EMPTY_CHRONICLE_LAYERS,
  }));
}

function baseOptions(count: number) {
  return {
    frames: framesOfCount(count),
    size: SIZE,
    mapW: 100,
    mapH: 100,
    baseImage: null,
    fillOpacity: 1,
    delayMs: 100,
    loop: true,
    centroids: null,
    stampDay: false,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("encodeGifSteps", () => {
  it("yields exactly once per frame and returns the finished bytes", () => {
    const frames = Array.from({ length: 4 }, () => ({
      data: new Uint8ClampedArray(SIZE * SIZE * 4),
      delayMs: 100,
    }));
    const steps = encodeGifSteps({ width: SIZE, height: SIZE, frames });

    const yields: number[] = [];
    let step = steps.next();
    while (!step.done) {
      yields.push(step.value);
      step = steps.next();
    }

    expect(yields).toEqual([1, 2, 3, 4]);
    expect(step.value).toBeInstanceOf(Uint8Array);
    expect(String.fromCharCode(...step.value.slice(0, 6))).toBe("GIF89a");
  });

  it("validates on the first step rather than at call time", () => {
    const steps = encodeGifSteps({ width: 0, height: SIZE, frames: [] });
    expect(() => steps.next()).toThrow(/width must be a positive integer/i);
  });
});

describe("exportChronicleGif chunked encode", () => {
  it("hands the thread back between render frames and between encode frames", async () => {
    const yields = install();

    const result = await exportChronicleGif(baseOptions(3));

    expect(String.fromCharCode(...result.bytes.slice(0, 6))).toBe("GIF89a");
    // Two between the three rendered days, plus one before each of the four
    // encode steps — three that write a frame and the final one that returns.
    // The first of those four is the one that lets "encode 0 / 3" paint before
    // the global palette scan takes the thread. Without the encode-side yields
    // this would be 2.
    expect(yields.count).toBe(6);
  });

  it("reports encode progress for every frame", async () => {
    install();
    const encodeProgress: number[] = [];

    await exportChronicleGif({
      ...baseOptions(3),
      onProgress: (progress: ChronicleGifProgress) => {
        if (progress.phase === "encode") encodeProgress.push(progress.completed);
      },
    });

    expect(encodeProgress).toEqual([0, 1, 2, 3]);
  });

  it("cancels between encode frames, not only between rendered days", async () => {
    install();
    const controller = new AbortController();
    const seen: number[] = [];

    const promise = exportChronicleGif({
      ...baseOptions(4),
      signal: controller.signal,
      onProgress: (progress: ChronicleGifProgress) => {
        if (progress.phase !== "encode") return;
        seen.push(progress.completed);
        // Aborting after the first frame is written proves the loop checks
        // between steps: a single blocking `encodeGif` call would ignore this
        // and run to completion.
        if (progress.completed === 1) controller.abort();
      },
    });

    await expect(promise).rejects.toSatisfy(isChronicleGifCancelled);
    // 0 (phase start) and 1 (first frame). Frames 2-4 were never encoded.
    expect(seen).toEqual([0, 1]);
  });

  it("cancels between rendered days", async () => {
    install();
    const controller = new AbortController();

    const promise = exportChronicleGif({
      ...baseOptions(4),
      signal: controller.signal,
      onProgress: (progress: ChronicleGifProgress) => {
        if (progress.phase === "render" && progress.completed === 1) {
          controller.abort();
        }
      },
    });

    await expect(promise).rejects.toSatisfy(isChronicleGifCancelled);
  });

  it("refuses an over-ceiling request before allocating any frame pixels", async () => {
    const yields = install();
    const size = 4096;
    const frameCount = 20; // ~1.3 GB, far past the 256 MB ceiling.
    expect(size * size * 4 * frameCount).toBeGreaterThan(
      CHRONICLE_MEMORY_CEILING_BYTES
    );

    await expect(
      exportChronicleGif({ ...baseOptions(frameCount), size })
    ).rejects.toThrow(/fewer days or a smaller size/i);
    // Nothing was rendered, so nothing yielded.
    expect(yields.count).toBe(0);
  });
});
