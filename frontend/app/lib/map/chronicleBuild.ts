import type { ChronicleIndex } from "./chronicleData";

/**
 * Everything the timelapse studio decides *before* it touches a canvas: which
 * days a range covers, what the build will cost, and the order the build pass
 * walks them in. None of it may touch the DOM — the studio runs it in the
 * browser, the tests run it under node.
 */

/** Square edge of the painted frames the build keeps in memory. */
export const CHRONICLE_RENDER_SIZES = [1200, 900, 600] as const;
export const DEFAULT_CHRONICLE_RENDER_SIZE = 900;

/**
 * Frames are held decoded for the whole playback, so the ceiling is a real
 * browser limit rather than a preference. 256 MB is roughly 79 frames at the
 * default 900px render size — past that the studio asks the user to shorten the
 * range or drop the resolution instead of quietly allocating it.
 */
export const CHRONICLE_MEMORY_CEILING_BYTES = 256 * 1024 * 1024;

/** In-flight day fetches. Enough to hide latency, few enough to stay polite. */
export const CHRONICLE_FETCH_CONCURRENCY = 6;

/**
 * Parallel fetches overlap latency but share one pipe, so wall time does not
 * fall off linearly with the request window. Three is the speedup the estimate
 * claims; erring low keeps the number a floor the build usually beats.
 */
export const CHRONICLE_FETCH_PARALLEL_SPEEDUP = 3;

/**
 * Used only until the compose step has run a real day through the pipeline.
 * They are honest guesses, and `ChronicleEstimate.measured` tells the UI to say
 * so. `cpuMsPerDay` is the expensive case (fill plus names), because
 * under-promising a build is the failure mode that matters: on main's 806
 * provinces the label pass alone measures ~800 ms per day against ~5 ms for the
 * pixel pass, so a model that only counts pixels is off by a factor of 25.
 */
export const CHRONICLE_FALLBACK_COST = {
  cpuMsPerDay: 800,
  bytesPerDay: 900_000,
  bytesPerMs: 1_500,
} as const;

export type ChronicleRangeSelection = {
  /** Stored days inside the range, ascending. Empty when `error` is set. */
  days: string[];
  /** Subset of `days` the index flagged as captured with holes. */
  incompleteDays: string[];
  error: string | null;
};

export type ChronicleRangeIndex = Pick<
  ChronicleIndex,
  "days" | "incomplete_days"
>;

/**
 * Both endpoints must be days the map actually stored: a range anchored on a
 * day with no snapshot would silently start or end somewhere else, which reads
 * as data loss rather than as the empty gap it is. Gaps *between* the endpoints
 * are fine and simply do not produce frames.
 */
export function selectChronicleRange(
  index: ChronicleRangeIndex,
  start: string | null,
  end: string | null
): ChronicleRangeSelection {
  const empty = { days: [], incompleteDays: [] };
  // Both of these come from unvalidated network JSON. `?? []` covers null and
  // undefined only, and `incomplete_days` reaches `.map` a few lines down.
  const available = Array.isArray(index.days) ? index.days : [];

  if (!available.length) {
    return { ...empty, error: "This map has no stored chronicle days yet." };
  }
  if (!start || !end) {
    return { ...empty, error: "Pick a first and last day." };
  }
  if (start > end) {
    return { ...empty, error: "The first day is after the last day." };
  }

  const stored = new Set(available);
  const missing = [start, end].filter((day) => !stored.has(day));
  if (missing.length) {
    const unique = Array.from(new Set(missing));
    return {
      ...empty,
      error:
        unique.length === 1
          ? `${unique[0]} has no stored snapshot.`
          : `${unique.join(" and ")} have no stored snapshot.`,
    };
  }

  const days = available.filter((day) => day >= start && day <= end);
  const incomplete = new Set(
    (Array.isArray(index.incomplete_days) ? index.incomplete_days : []).map(
      (entry) => entry?.day
    )
  );

  return {
    days,
    incompleteDays: days.filter((day) => incomplete.has(day)),
    error: null,
  };
}

export type ChronicleCostSample = {
  /**
   * Which layer set the sample was taken with, from
   * `chronicleToggleSignature`. A sample measured with only the fill on says
   * nothing about a build that also draws names — the label pass is the most
   * expensive step in the day — so the estimate refuses to call itself measured
   * unless this matches the build about to run.
   */
  signature: string | null;
  /** Decompressed bytes one day's enabled sources cost. */
  bytesPerDay: number | null;
  /**
   * Decompressed bytes per millisecond observed on those fetches. Covers
   * transfer, gunzip and `JSON.parse` together, because that is how the day
   * files are actually paid for.
   */
  bytesPerMs: number | null;
  /**
   * Everything the main thread does per day once a day's sources are in hand:
   * the LUT, the pixel pass, the downscale, `transferToImageBitmap`, the label
   * pass and the marker layout. Measured end to end on the compose preview,
   * which runs every one of those steps on a real day.
   */
  cpuMsPerDay: number | null;
};

export const EMPTY_CHRONICLE_COST_SAMPLE: ChronicleCostSample = {
  signature: null,
  bytesPerDay: null,
  bytesPerMs: null,
  cpuMsPerDay: null,
};

export type ChronicleEstimate = {
  dayCount: number;
  bytesPerFrame: number;
  memoryBytes: number;
  /** Wall time attributed to pulling day files, after parallel overlap. */
  fetchMs: number;
  /** Wall time attributed to the per-day work on the main thread. */
  cpuMs: number;
  totalMs: number;
  /**
   * False when any term came from `CHRONICLE_FALLBACK_COST`, or when the sample
   * was measured with a different set of layers than the build will draw.
   */
  measured: boolean;
  /** The sample exists but describes another layer set. */
  staleSample: boolean;
  overCeiling: boolean;
};

export function chronicleFrameBytes(
  renderWidth: number,
  renderHeight: number
): number {
  return Math.max(0, renderWidth) * Math.max(0, renderHeight) * 4;
}

/**
 * Models the build as the pipeline it is: day files stream in with several
 * requests overlapping, and each day's pixels, labels and markers are then
 * computed on the one main thread.
 *
 * Two deliberate biases, both toward over-promising the wait rather than under:
 * the fetch and CPU terms are added even though fetches for later days overlap
 * the work on earlier ones, and frame reuse is ignored entirely — a build where
 * half the days are quiet repaints half as often as this predicts. A build that
 * lands early reads as the tool being quick; one that overruns its own promise
 * reads as broken.
 */
export function estimateChronicleBuild(options: {
  dayCount: number;
  sample: ChronicleCostSample;
  /** Signature of the layers the build will actually draw. */
  signature: string;
  renderWidth: number;
  renderHeight: number;
  memoryCeilingBytes?: number;
}): ChronicleEstimate {
  const { dayCount, sample, signature, renderWidth, renderHeight } = options;
  const ceiling = options.memoryCeilingBytes ?? CHRONICLE_MEMORY_CEILING_BYTES;

  const staleSample = sample.signature != null && sample.signature !== signature;
  const usable = !staleSample;

  const cpuMsPerDay =
    (usable ? sample.cpuMsPerDay : null) ?? CHRONICLE_FALLBACK_COST.cpuMsPerDay;
  const bytesPerDay =
    (usable ? sample.bytesPerDay : null) ?? CHRONICLE_FALLBACK_COST.bytesPerDay;
  const sampledBytesPerMs = usable ? sample.bytesPerMs : null;
  const bytesPerMs =
    sampledBytesPerMs && sampledBytesPerMs > 0
      ? sampledBytesPerMs
      : CHRONICLE_FALLBACK_COST.bytesPerMs;

  const days = Math.max(0, Math.floor(dayCount));
  const bytesPerFrame = chronicleFrameBytes(renderWidth, renderHeight);
  const memoryBytes = days * bytesPerFrame;
  const fetchMs =
    (days * bytesPerDay) / bytesPerMs / CHRONICLE_FETCH_PARALLEL_SPEEDUP;
  const cpuMs = days * cpuMsPerDay;

  return {
    dayCount: days,
    bytesPerFrame,
    memoryBytes,
    fetchMs,
    cpuMs,
    totalMs: fetchMs + cpuMs,
    measured:
      !staleSample &&
      sample.signature === signature &&
      sample.cpuMsPerDay != null &&
      sample.bytesPerDay != null &&
      sample.bytesPerMs != null,
    staleSample,
    overCeiling: memoryBytes > ceiling,
  };
}

/**
 * The one place that decides a build may not start, so the disabled button, the
 * reason shown next to it and `startBuild`'s own re-check can never disagree.
 *
 * A disabled button is a hint, not a guard: the range step's Back/Build pair can
 * put a second click through while the first build is still parked on a fetch,
 * and the label geometry can still be in flight when the estimate is drawn. Both
 * of those produce a silently wrong artifact rather than an error, so they are
 * refused here and re-asserted at the call site.
 */
export function chronicleBuildBlockReason(options: {
  selectionError: string | null;
  dayCount: number;
  /** True while a build is already running. */
  building: boolean;
  nationNames: boolean;
  /** False on maps with no label geometry at all. */
  namesSupported: boolean;
  /** `useMapGeometry`'s `ready`, plus the arrays the label pass actually reads. */
  geometryReady: boolean;
  overCeiling: boolean;
}): string | null {
  if (options.building) return "A build is already running.";
  if (options.selectionError) return options.selectionError;
  if (options.dayCount <= 0) return "Pick a range with at least one stored day.";
  if (options.nationNames) {
    if (!options.namesSupported) {
      return "Nation names need label geometry, which this map does not have.";
    }
    if (!options.geometryReady) {
      // Without this the label pass returns [] in microseconds: the estimate
      // would quote that empty path and the build would write unlabelled frames
      // while the toggle says names are on.
      return "Still loading label geometry — nation names cannot be measured or drawn yet.";
    }
  }
  if (options.overCeiling) {
    return "Those frames are more than this browser should hold at once.";
  }
  return null;
}

export function formatChronicleDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s";
  if (ms < 950) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

export function formatChronicleBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 100) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

/**
 * The one line the estimate step shows: "~8 s to build. ~20 MB."
 *
 * No day count — the two range selects sit directly above it — and no hedge
 * word. `measured` still distinguishes a timed sample from a default guess for
 * anything that wants it; this line no longer says which it got.
 */
export function describeChronicleEstimate(estimate: ChronicleEstimate): string {
  const time = formatChronicleDuration(estimate.totalMs);
  const memory = formatChronicleBytes(estimate.memoryBytes);
  return `~${time} to build. ~${memory}.`;
}

export class ChronicleBuildCancelled extends Error {
  constructor() {
    super("Chronicle build cancelled");
    this.name = "ChronicleBuildCancelled";
  }
}

export function isChronicleBuildCancelled(
  error: unknown
): error is ChronicleBuildCancelled {
  return error instanceof ChronicleBuildCancelled;
}

/** The part of a loaded day the runner itself reads. Effects extend it. */
export type ChronicleDayLoad = {
  /**
   * Content hash of every source that feeds the day's *painted frame*, or null
   * when nothing enabled paints one. Equal fingerprints on consecutive days
   * mean nothing the frame shows moved, so the previous frame can stand in for
   * this one.
   *
   * Deliberately not "the nation file's hash", which is what this was while the
   * fill had a single source. The frame now composites league territory and the
   * prosperity heat alongside nation ownership, and keying reuse on the nation
   * file alone silently reused a stale frame across a day where only prosperity
   * had moved. Whoever supplies this must fold in every source the frame draws
   * from and nothing else — a source that only feeds the overlay layers
   * (markers, and so the fort hatch) must stay out of it, or a quiet map with
   * busy pins would repaint every day for nothing.
   */
  imageFingerprint: string | null;
  /** Decompressed bytes this day cost, fed back into the next estimate. */
  byteLength: number;
  incomplete: boolean;
};

export type ChronicleFrame<TImage, TLayers> = {
  day: string;
  image: TImage | null;
  layers: TLayers;
  incomplete: boolean;
  /** True when `image` is the previous day's, shared rather than repainted. */
  reusedImage: boolean;
};

export type ChronicleBuildEffects<
  TLoad extends ChronicleDayLoad,
  TImage,
  TLayers,
> = {
  /** Returns null for a day whose sources are absent — it is skipped, not fatal. */
  loadDay: (day: string, signal?: AbortSignal) => Promise<TLoad | null>;
  renderDay: (day: string, load: TLoad) => Promise<TImage | null>;
  buildLayers: (day: string, load: TLoad) => TLayers;
  disposeImage: (image: TImage) => void;
};

export type ChronicleBuildProgress = {
  completed: number;
  total: number;
  day: string;
  painted: number;
  reused: number;
  skipped: number;
};

export type ChronicleBuildResult<TImage, TLayers> = {
  frames: ChronicleFrame<TImage, TLayers>[];
  paintedCount: number;
  reusedCount: number;
  skippedDays: string[];
  bytesFetched: number;
  elapsedMs: number;
};

/**
 * Several days can point at the same `ImageBitmap`, so closing per frame would
 * close a bitmap another frame still draws. Dedupe on identity first.
 */
export function disposeChronicleFrames<TImage, TLayers>(
  frames: ChronicleFrame<TImage, TLayers>[],
  disposeImage: (image: TImage) => void
): void {
  const seen = new Set<TImage>();
  for (const frame of frames) {
    if (frame.image == null || seen.has(frame.image)) continue;
    seen.add(frame.image);
    disposeImage(frame.image);
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ChronicleBuildCancelled();
}

/**
 * The whole build pass. Fetches run in a sliding window ahead of the paint
 * cursor — painting has to stay strictly in day order because frame reuse
 * compares against the day before, and because every paint goes through one
 * shared scratch canvas.
 *
 * Cancelling disposes the frames it already built; a half-built timelapse is
 * never handed back.
 */
export async function runChronicleBuild<
  TLoad extends ChronicleDayLoad,
  TImage,
  TLayers,
>(options: {
  days: string[];
  effects: ChronicleBuildEffects<TLoad, TImage, TLayers>;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ChronicleBuildProgress) => void;
  now?: () => number;
}): Promise<ChronicleBuildResult<TImage, TLayers>> {
  const { days, effects, signal, onProgress } = options;
  const now = options.now ?? Date.now;
  const window = Math.max(1, options.concurrency ?? CHRONICLE_FETCH_CONCURRENCY);
  const startedAt = now();

  const frames: ChronicleFrame<TImage, TLayers>[] = [];
  const skippedDays: string[] = [];
  const pending = new Map<number, Promise<TLoad | null>>();

  let painted = 0;
  let reused = 0;
  let bytesFetched = 0;
  let previous: { fingerprint: string | null; image: TImage | null } | null =
    null;

  const startLoad = (index: number) => {
    if (index >= days.length || pending.has(index)) return;
    const promise = effects.loadDay(days[index]!, signal);
    // The runner may bail out before awaiting this one; swallowing here keeps a
    // cancelled build from surfacing as an unhandled rejection.
    promise.catch(() => {});
    pending.set(index, promise);
  };

  for (let i = 0; i < window; i++) startLoad(i);

  try {
    for (let i = 0; i < days.length; i++) {
      throwIfCancelled(signal);
      const day = days[i]!;
      const load = await pending.get(i)!;
      pending.delete(i);
      startLoad(i + window);
      throwIfCancelled(signal);

      if (!load) {
        skippedDays.push(day);
      } else {
        bytesFetched += load.byteLength;

        const canReuse =
          previous != null &&
          load.imageFingerprint != null &&
          load.imageFingerprint === previous.fingerprint;

        let image: TImage | null;
        if (canReuse) {
          image = previous!.image;
          reused += 1;
        } else {
          image = await effects.renderDay(day, load);
          if (image != null) painted += 1;
        }

        // Register the bitmap before checking cancellation so the catch below
        // can dispose it even when an abort arrives during `renderDay`.
        frames.push({
          day,
          image,
          layers: effects.buildLayers(day, load),
          incomplete: load.incomplete,
          reusedImage: canReuse,
        });
        previous = { fingerprint: load.imageFingerprint, image };
        throwIfCancelled(signal);
      }

      onProgress?.({
        completed: i + 1,
        total: days.length,
        day,
        painted,
        reused,
        skipped: skippedDays.length,
      });
    }
  } catch (error) {
    disposeChronicleFrames(frames, effects.disposeImage);
    throw error;
  }

  return {
    frames,
    paintedCount: painted,
    reusedCount: reused,
    skippedDays,
    bytesFetched,
    elapsedMs: now() - startedAt,
  };
}
