import { describe, expect, it, vi } from "vitest";

import {
  CHRONICLE_FALLBACK_COST,
  CHRONICLE_MEMORY_CEILING_BYTES,
  ChronicleBuildCancelled,
  chronicleBuildBlockReason,
  describeChronicleEstimate,
  disposeChronicleFrames,
  estimateChronicleBuild,
  formatChronicleBytes,
  formatChronicleDuration,
  isChronicleBuildCancelled,
  runChronicleBuild,
  selectChronicleRange,
  type ChronicleDayLoad,
} from "./chronicleBuild";

type TestLoad = ChronicleDayLoad & { day: string };

type TestImage = { id: string };

function index(days: string[], incomplete: string[] = []) {
  return {
    days,
    incomplete_days: incomplete.map((day) => ({
      day,
      missing: ["nation"],
      invalid: [],
    })),
  };
}

/** Effects whose painted frame is described by one fingerprint per day. */
function testEffects(fingerprints: Record<string, string | null>) {
  const rendered: string[] = [];
  const disposed: TestImage[] = [];
  const loaded: string[] = [];

  return {
    rendered,
    disposed,
    loaded,
    effects: {
      loadDay: async (day: string): Promise<TestLoad | null> => {
        loaded.push(day);
        if (!(day in fingerprints)) return null;
        return {
          day,
          imageFingerprint: fingerprints[day] ?? null,
          byteLength: 100,
          incomplete: false,
        };
      },
      renderDay: async (day: string): Promise<TestImage> => {
        rendered.push(day);
        return { id: day };
      },
      buildLayers: (day: string) => ({ day }),
      disposeImage: (image: TestImage) => {
        disposed.push(image);
      },
    },
  };
}

describe("selectChronicleRange", () => {
  it("returns the stored days inside the range and flags incomplete ones", () => {
    const selection = selectChronicleRange(
      index(["2026-01-01", "2026-01-02", "2026-01-04"], ["2026-01-02"]),
      "2026-01-01",
      "2026-01-04"
    );

    expect(selection.error).toBeNull();
    expect(selection.days).toEqual(["2026-01-01", "2026-01-02", "2026-01-04"]);
    expect(selection.incompleteDays).toEqual(["2026-01-02"]);
  });

  it("rejects a range anchored on a day the map never stored", () => {
    const selection = selectChronicleRange(
      index(["2026-01-01", "2026-01-02"]),
      "2026-01-01",
      "2026-01-03"
    );

    expect(selection.days).toEqual([]);
    expect(selection.error).toContain("2026-01-03");
  });

  it("rejects a reversed range and an unset one", () => {
    const stored = index(["2026-01-01", "2026-01-02"]);
    expect(
      selectChronicleRange(stored, "2026-01-02", "2026-01-01").error
    ).toMatch(/after/);
    expect(selectChronicleRange(stored, null, "2026-01-02").error).toMatch(
      /first and last/
    );
  });

  it("treats a map with no history as empty rather than broken", () => {
    const selection = selectChronicleRange(index([]), null, null);
    expect(selection.days).toEqual([]);
    expect(selection.error).toMatch(/no stored chronicle days/);
  });
});

describe("estimateChronicleBuild", () => {
  const signature = "nationFill+nationNames";
  const sample = {
    signature,
    bytesPerDay: 300_000,
    bytesPerMs: 1_000,
    cpuMsPerDay: 800,
  };

  it("scales with the day count", () => {
    const one = estimateChronicleBuild({
      dayCount: 1,
      sample,
      signature,
      renderWidth: 900,
      renderHeight: 900,
    });
    const ten = estimateChronicleBuild({
      dayCount: 10,
      sample,
      signature,
      renderWidth: 900,
      renderHeight: 900,
    });

    expect(ten.totalMs).toBeCloseTo(one.totalMs * 10, 6);
    expect(ten.memoryBytes).toBe(one.memoryBytes * 10);
    expect(ten.memoryBytes).toBe(10 * 900 * 900 * 4);
    expect(ten.measured).toBe(true);
  });

  it("counts the whole per-day pipeline, not just the pixel pass", () => {
    const estimate = estimateChronicleBuild({
      dayCount: 14,
      sample,
      signature,
      renderWidth: 900,
      renderHeight: 900,
    });

    // 14 days x 800 ms of frame + labels + markers, plus the fetch term.
    expect(estimate.cpuMs).toBe(11_200);
    expect(estimate.fetchMs).toBeCloseTo(1_400, 6);
    expect(estimate.totalMs).toBeCloseTo(12_600, 6);
  });

  it("refuses to call itself measured when the layers have changed", () => {
    const estimate = estimateChronicleBuild({
      dayCount: 10,
      sample,
      signature: "nationFill",
      renderWidth: 900,
      renderHeight: 900,
    });

    expect(estimate.staleSample).toBe(true);
    expect(estimate.measured).toBe(false);
    // A sample taken with names on says nothing about a build without them, so
    // the fallback is used rather than the measured number.
    expect(estimate.cpuMs).toBe(10 * CHRONICLE_FALLBACK_COST.cpuMsPerDay);
  });

  it("falls back to guesses and says so when nothing has been measured", () => {
    const estimate = estimateChronicleBuild({
      dayCount: 5,
      sample: {
        signature: null,
        bytesPerDay: null,
        bytesPerMs: null,
        cpuMsPerDay: null,
      },
      signature,
      renderWidth: 600,
      renderHeight: 600,
    });

    expect(estimate.measured).toBe(false);
    expect(estimate.staleSample).toBe(false);
    expect(estimate.totalMs).toBeGreaterThan(0);
    // The line reads the same whether or not the sample was measured; only the
    // numbers behind it differ.
    expect(describeChronicleEstimate(estimate)).toMatch(
      /^~.+ to build\. ~.+\.$/
    );
  });

  it("flags a range that would blow the memory ceiling", () => {
    const dayCount =
      Math.ceil(CHRONICLE_MEMORY_CEILING_BYTES / (900 * 900 * 4)) + 1;
    const estimate = estimateChronicleBuild({
      dayCount,
      sample,
      signature,
      renderWidth: 900,
      renderHeight: 900,
    });

    expect(estimate.overCeiling).toBe(true);
    expect(
      estimateChronicleBuild({
        dayCount,
        sample,
        signature,
        renderWidth: 600,
        renderHeight: 600,
      }).overCeiling
    ).toBe(false);
  });

  it("describes a build in the studio's own words", () => {
    const estimate = estimateChronicleBuild({
      dayCount: 25,
      sample,
      signature,
      renderWidth: 900,
      renderHeight: 900,
    });
    expect(describeChronicleEstimate(estimate)).toBe(
      "~23 s to build. ~77.2 MB."
    );
  });
});

describe("format helpers", () => {
  it("keeps durations readable at every magnitude", () => {
    expect(formatChronicleDuration(120)).toBe("120 ms");
    expect(formatChronicleDuration(8_000)).toBe("8.0 s");
    expect(formatChronicleDuration(42_000)).toBe("42 s");
    expect(formatChronicleDuration(125_000)).toBe("2 min 5 s");
  });

  it("reports memory in the unit the number belongs in", () => {
    expect(formatChronicleBytes(20 * 1024 * 1024)).toBe("20.0 MB");
    expect(formatChronicleBytes(512 * 1024 * 1024)).toBe("512 MB");
    expect(formatChronicleBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });
});

describe("runChronicleBuild", () => {
  it("paints once for identical consecutive days and shares the bitmap", async () => {
    const { effects, rendered } = testEffects({
      "2026-01-01": "abc",
      "2026-01-02": "abc",
    });

    const result = await runChronicleBuild({
      days: ["2026-01-01", "2026-01-02"],
      effects,
    });

    expect(rendered).toEqual(["2026-01-01"]);
    expect(result.paintedCount).toBe(1);
    expect(result.reusedCount).toBe(1);
    expect(result.frames).toHaveLength(2);
    expect(result.frames[1]!.reusedImage).toBe(true);
    expect(result.frames[1]!.image).toBe(result.frames[0]!.image);
  });

  it("repaints when the day's fingerprint changes", async () => {
    const { effects, rendered } = testEffects({
      "2026-01-01": "abc",
      "2026-01-02": "def",
      "2026-01-03": "def",
    });

    const result = await runChronicleBuild({
      days: ["2026-01-01", "2026-01-02", "2026-01-03"],
      effects,
    });

    expect(rendered).toEqual(["2026-01-01", "2026-01-02"]);
    expect(result.frames.map((frame) => frame.reusedImage)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("skips a day whose sources are absent instead of failing the build", async () => {
    const { effects } = testEffects({
      "2026-01-01": "abc",
      "2026-01-03": "abc",
    });

    const result = await runChronicleBuild({
      days: ["2026-01-01", "2026-01-02", "2026-01-03"],
      effects,
    });

    expect(result.skippedDays).toEqual(["2026-01-02"]);
    expect(result.frames.map((frame) => frame.day)).toEqual([
      "2026-01-01",
      "2026-01-03",
    ]);
  });

  it("stops painting and frees what it built when cancelled", async () => {
    const controller = new AbortController();
    const { effects, rendered, disposed } = testEffects({
      "2026-01-01": "a",
      "2026-01-02": "b",
      "2026-01-03": "c",
      "2026-01-04": "d",
    });

    const onProgress = vi.fn(() => {
      if (rendered.length >= 2) controller.abort();
    });

    await expect(
      runChronicleBuild({
        days: ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"],
        effects,
        signal: controller.signal,
        onProgress,
      })
    ).rejects.toBeInstanceOf(ChronicleBuildCancelled);

    expect(rendered).toEqual(["2026-01-01", "2026-01-02"]);
    expect(disposed.map((image) => image.id)).toEqual([
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("reports progress and elapsed time from the injected clock", async () => {
    const { effects } = testEffects({ "2026-01-01": "a", "2026-01-02": "b" });
    const ticks = [1_000, 1_400];
    const progress: number[] = [];

    const result = await runChronicleBuild({
      days: ["2026-01-01", "2026-01-02"],
      effects,
      now: () => ticks.shift() ?? 1_400,
      onProgress: (update) => progress.push(update.completed),
    });

    expect(progress).toEqual([1, 2]);
    expect(result.elapsedMs).toBe(400);
    expect(result.bytesFetched).toBe(200);
  });
});

describe("disposeChronicleFrames", () => {
  it("closes each shared bitmap exactly once", () => {
    const shared: TestImage = { id: "shared" };
    const other: TestImage = { id: "other" };
    const closed: TestImage[] = [];

    disposeChronicleFrames(
      [
        { day: "a", image: shared, layers: null, incomplete: false, reusedImage: false },
        { day: "b", image: shared, layers: null, incomplete: false, reusedImage: true },
        { day: "c", image: other, layers: null, incomplete: false, reusedImage: false },
        { day: "d", image: null, layers: null, incomplete: false, reusedImage: false },
      ],
      (image) => closed.push(image)
    );

    expect(closed).toEqual([shared, other]);
  });
});

describe("isChronicleBuildCancelled", () => {
  it("only matches the runner's own cancellation", () => {
    expect(isChronicleBuildCancelled(new ChronicleBuildCancelled())).toBe(true);
    expect(isChronicleBuildCancelled(new Error("nope"))).toBe(false);
  });
});

describe("runChronicleBuild cancellation", () => {
  it("disposes a bitmap that renderDay produced just as the cancel landed", async () => {
    // `renderDay` can await (`createImageBitmap` does), letting an abort land
    // after a bitmap exists but before a frame owns it. The catch only disposes
    // `frames`, so failing to register it leaks a full frame on every cancel
    // (3.24 MB at 900²), with no bound across repeated cancellations.
    const controller = new AbortController();
    const disposed: TestImage[] = [];

    const effects = {
      loadDay: async (day: string): Promise<TestLoad | null> => ({
        day,
        imageFingerprint: day,
        byteLength: 10,
        incomplete: false,
      }),
      renderDay: async (day: string): Promise<TestImage> => {
        // Cancel while this render is in flight, exactly like Back does.
        controller.abort();
        return { id: day };
      },
      buildLayers: (day: string) => ({ day }),
      disposeImage: (image: TestImage) => {
        disposed.push(image);
      },
    };

    const error = await runChronicleBuild({
      days: ["2026-01-01", "2026-01-02"],
      effects,
      signal: controller.signal,
    }).catch((err: unknown) => err);

    expect(isChronicleBuildCancelled(error)).toBe(true);
    expect(disposed).toEqual([{ id: "2026-01-01" }]);
  });

  it("still disposes every frame it had already finished", async () => {
    const controller = new AbortController();
    const { effects, disposed } = testEffects({
      "2026-01-01": "a",
      "2026-01-02": "b",
      "2026-01-03": "c",
    });

    const error = await runChronicleBuild({
      days: ["2026-01-01", "2026-01-02", "2026-01-03"],
      effects,
      signal: controller.signal,
      onProgress: (update) => {
        if (update.completed === 2) controller.abort();
      },
    }).catch((err: unknown) => err);

    expect(isChronicleBuildCancelled(error)).toBe(true);
    expect(disposed).toEqual([{ id: "2026-01-01" }, { id: "2026-01-02" }]);
  });

  it("does not double-dispose a bitmap shared by a reused day", async () => {
    const controller = new AbortController();
    const { effects, disposed } = testEffects({
      "2026-01-01": "same",
      "2026-01-02": "same",
      "2026-01-03": "moved",
    });

    await runChronicleBuild({
      days: ["2026-01-01", "2026-01-02", "2026-01-03"],
      effects,
      signal: controller.signal,
      onProgress: (update) => {
        if (update.completed === 2) controller.abort();
      },
    }).catch(() => {});

    expect(disposed).toEqual([{ id: "2026-01-01" }]);
  });
});

describe("selectChronicleRange against a malformed index", () => {
  it("treats non-array days and incomplete_days as an empty history", () => {
    const selection = selectChronicleRange(
      { days: {}, incomplete_days: {} } as never,
      "2026-01-01",
      "2026-01-02"
    );

    expect(selection.days).toEqual([]);
    expect(selection.incompleteDays).toEqual([]);
    expect(selection.error).toContain("no stored chronicle days");
  });

  it("survives a malformed incomplete_days entry on a usable range", () => {
    const selection = selectChronicleRange(
      { days: ["2026-01-01", "2026-01-02"], incomplete_days: [null] } as never,
      "2026-01-01",
      "2026-01-02"
    );

    expect(selection.error).toBeNull();
    expect(selection.days).toEqual(["2026-01-01", "2026-01-02"]);
    expect(selection.incompleteDays).toEqual([]);
  });
});

describe("chronicleBuildBlockReason", () => {
  const buildable = {
    selectionError: null,
    dayCount: 25,
    building: false,
    nationNames: false,
    namesSupported: true,
    geometryReady: true,
    overCeiling: false,
  };

  it("lets a well-formed build through", () => {
    expect(chronicleBuildBlockReason(buildable)).toBeNull();
    expect(
      chronicleBuildBlockReason({ ...buildable, nationNames: true })
    ).toBeNull();
  });

  it("refuses a second build while one is still running", () => {
    // The reentrancy case: Back re-enables Build while the first build is still
    // parked on a fetch it cannot be interrupted out of.
    expect(chronicleBuildBlockReason({ ...buildable, building: true })).toBe(
      "A build is already running."
    );
  });

  it("refuses nation names until the label geometry has landed", () => {
    const reason = chronicleBuildBlockReason({
      ...buildable,
      nationNames: true,
      geometryReady: false,
    });
    expect(reason).toMatch(/loading nation names/i);

    // With names off the same un-ready geometry costs nothing.
    expect(
      chronicleBuildBlockReason({ ...buildable, geometryReady: false })
    ).toBeNull();
  });

  it("refuses nation names on a map with no label geometry at all", () => {
    expect(
      chronicleBuildBlockReason({
        ...buildable,
        nationNames: true,
        namesSupported: false,
      })
    ).toMatch(/aren't available for this map/i);
    expect(
      chronicleBuildBlockReason({
        ...buildable,
        nationNames: true,
        namesSupported: false,
      })
    ).not.toMatch(/only the live map/i);
  });

  it("re-asserts the memory ceiling and the range errors", () => {
    expect(
      chronicleBuildBlockReason({ ...buildable, overCeiling: true })
    ).toMatch(/too many frames/i);
    expect(
      chronicleBuildBlockReason({ ...buildable, selectionError: "bad range" })
    ).toBe("bad range");
    expect(chronicleBuildBlockReason({ ...buildable, dayCount: 0 })).toMatch(
      /at least one recorded day/i
    );
  });

  it("reports the running build ahead of every other reason", () => {
    // Otherwise a click that is refused for being reentrant would explain
    // itself as something the user could act on, and they would keep clicking.
    expect(
      chronicleBuildBlockReason({
        ...buildable,
        building: true,
        overCeiling: true,
        selectionError: "bad range",
      })
    ).toBe("A build is already running.");
  });
});
