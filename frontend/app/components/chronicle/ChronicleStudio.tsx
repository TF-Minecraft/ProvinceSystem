"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccessibleMaps } from "../../hooks/useAccessibleMaps";
import { useCharacterSessionToken } from "../../hooks/useCharacterSessionToken";
import { useMapGeometry, chronicleNamesSupported } from "../../hooks/useMapGeometry";
import { useMapViewport } from "../../hooks/useMapViewport";
import { useResponsiveFitMode } from "../../hooks/useResponsiveFitMode";
import { computeVisibleNationLabels } from "../../lib/mapLabels";
import type { NationLabelSpec } from "../../lib/mapLabels";
import {
  CHRONICLE_BORDER_INK_RGBA,
  computeChronicleBorderMask,
  type ChronicleBorderMask,
} from "../../lib/map/chronicleBorderMask";
import {
  CHRONICLE_ZOC_HATCH_RGBA,
  computeChronicleZocMask,
  fortZocProvinceIds,
} from "../../lib/map/chronicleFortControl";
import {
  CHRONICLE_OCCUPATION_SEAM_RGBA,
  chronicleDayColorLut,
  computeChronicleOccupationSeamMask,
} from "../../lib/map/chronicleOccupation";
import { overviewFillOwnership } from "../../lib/map/chronicleOwnership";
import {
  focusChronicleFillLut,
  stackChronicleFillLuts,
} from "../../lib/map/chronicleFillStack";
import {
  CHRONICLE_FOCUS_NONE,
  chronicleFocusOptions,
  chronicleFocusProvinceIds,
} from "../../lib/map/chronicleFocus";
import { buildProsperityColorLut } from "../../lib/map/chronicleProsperity";
import { buildTradeLeagueColorLut } from "../../lib/map/chronicleTradeLeagues";
import {
  chronicleDiscardedProvinceMask,
  omitDiscardedProvinces,
} from "../../lib/map/chronicleWater";
import ChronicleBorderCanvas from "./ChronicleBorderCanvas";
import type {
  NationColorLut,
  ProvinceIdGrid,
} from "../../lib/map/chroniclePaint";
import {
  CHRONICLE_FETCH_CONCURRENCY,
  DEFAULT_CHRONICLE_RENDER_SIZE,
  EMPTY_CHRONICLE_COST_SAMPLE,
  disposeChronicleFrames,
  estimateChronicleBuild,
  chronicleBuildBlockReason,
  isChronicleBuildCancelled,
  runChronicleBuild,
  selectChronicleRange,
  ChronicleBuildCancelled,
  type ChronicleBuildProgress,
  type ChronicleCostSample,
  type ChronicleDayLoad,
  type ChronicleFrame,
} from "../../lib/map/chronicleBuild";
import {
  fetchChronicleDayFile,
  fetchChronicleDayMarkers,
  fetchChronicleIndex,
  fetchProvinceIdGridQ4,
  isChronicleDayFileMissing,
  type ChronicleIndex,
} from "../../lib/map/chronicleData";
import {
  MapAccessError,
  fetchMapJson,
  isAbortError,
  mapRequiresAuth,
  staffMapAccessReason,
} from "@/lib/map/api";
import MapAccessGate, { type MapAccessGateReason } from "../map/MapAccessGate";
import MapAuthImage from "../map/MapAuthImage";
import MapMarkerLayer from "../map/MapMarkerLayer";
import MapViewport from "../map/MapViewport";
import LabelLayer from "../map/LabelLayer";
import WarCampaignLineLayer from "../map/WarCampaignLineLayer";
import {
  mapDisplayName,
  mapFallbackSize,
  type MapId,
  type MapMarkersResponse,
  type RegionRecord,
} from "../map/types";
import { chronicleDayHref, liveMapHref } from "../../lib/map/chronicleDayRoute";
import {
  DEFAULT_CHRONICLE_GIF_SIZE,
  DEFAULT_CHRONICLE_WATERMARK_CORNER,
  type ChronicleWatermarkCorner,
  chronicleGifDelayMs,
  chronicleGifFilename,
} from "../../lib/map/chronicleGifFrame";
import {
  downloadGif,
  exportChronicleGif,
  isChronicleGifCancelled,
} from "./chronicleGifExport";
import { formatChronicleDay } from "../../lib/map/chronicleDayLabel";
import { DownloadIcon } from "../map/shell/MapIcons";
import MapShell from "../map/shell/MapShell";
import MapZoomControls from "../map/shell/MapZoomControls";
import {
  ChronicleBuildPanel,
  ChronicleNotice,
  ChroniclePlaque,
  ChroniclePlaybackPanel,
  ChroniclePlayer,
  ChronicleRangePanel,
  ChronicleSheetSummary,
  ChronicleSteps,
  ChronicleTogglePanel,
  primaryButtonClass,
  quietButtonClass,
  type ChronicleStep,
} from "./ChroniclePanels";
import LedgerChartsPanel from "./LedgerChartsPanel";
import { useLedgerSeries } from "./useLedgerSeries";
import {
  CHRONICLE_TOGGLES_OFF,
  CHRONICLE_TOGGLE_ORDER,
  EMPTY_CHRONICLE_LAYERS,
  anyChronicleToggleOn,
  buildChronicleLayers,
  chronicleClipLabel,
  chronicleLabelMapObjects,
  chronicleRegionData,
  chronicleToggleSignature,
  needsMarkers,
  needsNationFile,
  needsProvinceData,
  needsProvinceGrid,
  needsTradeFile,
  paintsChronicleFill,
  type ChronicleClip,
  type ChronicleFrameLayers,
  type ChronicleToggleKey,
  type ChronicleToggles,
} from "./chronicleLayers";
import {
  clearChronicleCanvas,
  createChronicleRenderTarget,
  drawChronicleBitmap,
  renderChronicleFrame,
  type ChronicleRenderTarget,
} from "./chronicleRenderTarget";

/**
 * The timelapse studio: compose the look, pick a range, see what it costs,
 * build every frame in one pass, then play it.
 *
 * The whole design turns on one rule — playback issues no requests. Every day's
 * pixels, labels and markers are fetched and computed during the build pass and
 * held in memory, so scrubbing the slider is a `drawImage` and an array swap.
 */

/** Painted ownership sits under the parchment's texture, not on top of it. */
const CHRONICLE_FILL_OPACITY = 0.88;

/** How many days back the range opens on, when the map has that many. */
const DEFAULT_RANGE_DAYS = 25;

type ChronicleStage = "compose" | "range" | "build" | "play";

type ChronicleDay = ChronicleDayLoad & {
  nation: RegionRecord | null;
  markers: MapMarkersResponse | null;
  /** `trade.json`, which is a nation file keyed by league. */
  trade: RegionRecord | null;
  /**
   * `province_data.json`, held as `unknown` on purpose. It is the one day file
   * that is a JSON *list*, and every row of it is unvalidated — giving it a
   * shape here would be asserting one the wire never promised, so
   * `buildProsperityColorLut` is the single place that inspects it.
   */
  provinceData: unknown;
  /**
   * Content hash of the day's `nation` file alone. Separate from
   * `imageFingerprint`, which covers everything the *frame* draws: the labels,
   * the border mask and the occupation seam are pure functions of the nation
   * file and nothing else, so folding trade or prosperity into their reuse key
   * would recompute the most expensive pass in the build for a change that
   * cannot affect it.
   */
  nationFingerprint: string | null;
};

type StudioFrame = ChronicleFrame<ImageBitmap, ChronicleFrameLayers> & {
  /** Set when this frame belongs to a queued look. Null for a single-look build. */
  clipLabel: string | null;
};

type WaterMaskStatus = "loading" | "ready" | "error";

/** Measured once per source so the estimate can re-derive itself per toggle. */
type SourceCost = { bytes: number; ms: number };

export default function ChronicleStudio({ mapId }: { mapId: MapId }) {
  const sessionToken = useCharacterSessionToken();
  const { maps } = useAccessibleMaps();
  const authToken = mapRequiresAuth(mapId, maps) ? sessionToken : null;
  const displayName = mapDisplayName(mapId, maps);

  const [index, setIndex] = useState<ChronicleIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [gateReason, setGateReason] = useState<MapAccessGateReason | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);

  const [stage, setStage] = useState<ChronicleStage>("compose");
  const [toggles, setToggles] = useState<ChronicleToggles>(CHRONICLE_TOGGLES_OFF);
  /**
   * Queued looks, played in order over the same range. Empty means the build
   * is the draft toggles alone, which is what the studio has always done.
   */
  const [clips, setClips] = useState<ChronicleClip[]>([]);
  const clipSerial = useRef(0);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  /**
   * Water and sea province ids, from the live terrain record. Prosperity and
   * trade leagues must not paint those, matching the live map generators.
   * Null until the fetch settles, and null again on failure: those two layers
   * stay unpainted rather than flashing water.
   */
  const [waterMask, setWaterMask] = useState<Uint8Array | null>(null);
  const [waterMaskStatus, setWaterMaskStatus] = useState<WaterMaskStatus>("loading");
  /**
   * The realm the whole timelapse is narrowed to, or `CHRONICLE_FOCUS_NONE`.
   *
   * Kept out of `ChronicleToggles` on purpose. It switches no layer on, fetches
   * nothing of its own and cannot make a build worth running — putting it in
   * the toggle record would make `anyChronicleToggleOn` true for a picker that
   * draws nothing, and offer to build a range of empty frames.
   */
  const [focusNationId, setFocusNationId] = useState<string>(
    CHRONICLE_FOCUS_NONE
  );
  /**
   * The focus as everything downstream sees it.
   *
   * Null whenever no nation layer is on, even with a realm still selected in
   * the picker. The realm list comes from the preview day's nation file, and
   * that file is only *fetched* by a nation layer — so a focus left standing
   * after those layers were switched off would narrow the compose preview from
   * data still sitting in state, then quietly lapse in a build that never pulls
   * a nation file. Better to say so in the panel and mean one thing everywhere.
   *
   * A queued look counts as much as the draft: queue a nation-fill look, then
   * set the draft to prosperity alone to queue the next, and that first look
   * must still build narrowed to the realm picked for it.
   */
  const focusWanted =
    needsNationFile(toggles) || clips.some((clip) => needsNationFile(clip.toggles));
  const activeFocusNationId = focusWanted ? focusNationId || null : null;
  const [notice, setNotice] = useState<string | null>(null);
  const [layerError, setLayerError] = useState<string | null>(null);
  const [layersLoading, setLayersLoading] = useState(false);

  const [previewNation, setPreviewNation] = useState<RegionRecord | null>(null);
  const [previewMarkers, setPreviewMarkers] =
    useState<MapMarkersResponse | null>(null);
  const [previewTrade, setPreviewTrade] = useState<RegionRecord | null>(null);
  const [previewProvinceData, setPreviewProvinceData] =
    useState<unknown>(null);

  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [renderSize, setRenderSize] = useState(DEFAULT_CHRONICLE_RENDER_SIZE);

  const [buildProgress, setBuildProgress] =
    useState<ChronicleBuildProgress | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [skippedDays, setSkippedDays] = useState<string[]>([]);

  const [playIndex, setPlayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [loop, setLoop] = useState(true);
  // The ledger charts rail. Play-stage only, and off by default — most builds
  // never focus a nation, and the fetch behind it is gated on this anyway.
  const [chartsOpen, setChartsOpen] = useState(false);
  // The phone sheet pulled down to one row, leaving the map the whole screen.
  const [sheetMin, setSheetMin] = useState(false);

  const [gifSize, setGifSize] = useState<number>(DEFAULT_CHRONICLE_GIF_SIZE);
  /**
   * On by default. A GIF that leaves the studio has nothing else to say which
   * days it covers — the Play panel does not travel with the file — so the
   * dates are carried unless the user deliberately strips them.
   */
  const [gifStampDay, setGifStampDay] = useState(true);
  /** Both travel with the file unless the user strips them for a site that forbids the mark. */
  const [gifLogo, setGifLogo] = useState(true);
  const [gifDiscordLink, setGifDiscordLink] = useState(true);
  /** Where the logo and Discord line sit, when either is on. */
  const [gifCorner, setGifCorner] = useState<ChronicleWatermarkCorner>(
    DEFAULT_CHRONICLE_WATERMARK_CORNER
  );
  const [gifStatus, setGifStatus] = useState<string | null>(null);
  const [gifError, setGifError] = useState<string | null>(null);
  const [gifNotice, setGifNotice] = useState<string | null>(null);
  /**
   * Set when the base map failed to load *with* `crossOrigin="anonymous"`.
   *
   * The attribute is what makes the decoded image safe to read back out of a
   * canvas, and the API serves the asset with an `Access-Control-Allow-Origin`
   * for every deployed origin — but a deployment that ever stopped doing so
   * would make the attributed request fail outright, and a studio with no base
   * map at all is a far worse bug than a GIF with no parchment. So the failure
   * is caught and the image is re-rendered bare. The flag is only ever set,
   * never cleared by an error, which is what stops the retry from looping.
   */
  const [baseCorsFailed, setBaseCorsFailed] = useState(false);

  const [mapSize, setMapSize] = useState({
    w: mapFallbackSize(mapId),
    h: mapFallbackSize(mapId),
  });
  // The three halves of a day's CPU cost, each measured on the compose preview
  // and each only required when the toggle that pays for it is on.
  const [frameMs, setFrameMs] = useState<number | null>(null);
  const [labelMs, setLabelMs] = useState<number | null>(null);
  const [borderMs, setBorderMs] = useState<number | null>(null);
  const [occupationMs, setOccupationMs] = useState<number | null>(null);
  const [zocMs, setZocMs] = useState<number | null>(null);
  const [layerMs, setLayerMs] = useState<number | null>(null);
  const [nationCost, setNationCost] = useState<SourceCost | null>(null);
  const [markersCost, setMarkersCost] = useState<SourceCost | null>(null);
  const [tradeCost, setTradeCost] = useState<SourceCost | null>(null);
  const [provinceDataCost, setProvinceDataCost] = useState<SourceCost | null>(
    null
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The base map the page already decoded. The GIF composites the parchment
  // under every frame, and re-requesting a multi-megabyte authenticated asset
  // to do it would double the map's download for a picture already on screen.
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  // One export at a time, guarded by a ref for the same reason the build is:
  // two clicks can land inside one tick, before the disabled button re-renders.
  const exportingRef = useRef(false);
  const gridRef = useRef<ProvinceIdGrid | null>(null);
  const gridPromiseRef = useRef<Promise<ProvinceIdGrid> | null>(null);
  const previewTargetRef = useRef<{
    target: ChronicleRenderTarget;
    size: number;
  } | null>(null);
  // The grid lives in a ref because the paint path wants it synchronously, but a
  // ref write cannot wake an effect. This counter is the render-visible half:
  // without it, whether the preview ever painted came down to which promise
  // resolved last - the grid arriving after the day's nation data left the
  // canvas blank with no error anywhere.
  const [gridVersion, setGridVersion] = useState(0);
  const framesRef = useRef<StudioFrame[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * `abortRef` alone is not enough to stop a second build. The build panel's
   * Back button cancels and returns to the range step, which re-enables Build —
   * but a build parked on a fetch keeps running until that fetch resolves, and
   * a second click would overwrite `abortRef` and leave the first build both
   * unreferenced and uncancellable. One flag, cleared only by the build that
   * set it, keeps exactly one build alive at a time.
   */
  const buildingRef = useRef(false);
  // The ref is the guard (two clicks can land in one tick, before any re-render);
  // this is the same fact in a form the panels can render a reason from.
  const [building, setBuilding] = useState(false);
  // Preview fetches are cancelled on unmount only: aborting them whenever this
  // component re-renders would race the once-per-source `attemptedRef` guard and
  // leave a source neither fetched nor retried.
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewAbortSignal = useCallback((): AbortSignal => {
    if (!previewAbortRef.current) previewAbortRef.current = new AbortController();
    return previewAbortRef.current.signal;
  }, []);
  /**
   * One controller per GIF export, so `exportChronicleGif`'s render loop and
   * its chunked encode loop both actually see an abort instead of running to
   * completion — and, on the way out, dropping the frame pixels they are
   * holding — after the studio no longer wants the result.
   * `exportingRef` already keeps two exports from overlapping, so
   * there is only ever one of these live at a time; it is cleared here too
   * on unmount, the one place this component has no button to cancel from.
   */
  const gifAbortRef = useRef<AbortController | null>(null);
  // Bumped whenever `framesRef` is replaced, so the render reads the new array.
  const [framesVersion, setFramesVersion] = useState(0);

  const fitMode = useResponsiveFitMode();
  const viewport = useMapViewport({
    mapSize,
    fitMode,
    dragPan: true,
    keyboard: true,
    // Safari would otherwise back the scaled-down map with a full-size layer
    // and run out of memory (see restingZoom).
    restingZoom: true,
  });
  const geometry = useMapGeometry(mapId, authToken);
  // Names need neighbor + centroid files. Missing files leave names off rather
  // than drawing an empty layer; loading still reports supported so the build
  // waits instead of claiming the map has no geometry.
  const namesSupported = chronicleNamesSupported(geometry);

  const days = useMemo(() => index?.days ?? [], [index]);
  const incompleteSet = useMemo(
    () => new Set((index?.incomplete_days ?? []).map((entry) => entry.day)),
    [index]
  );
  const previewDay = index?.last ?? null;

  useEffect(() => {
    let cancelled = false;
    setIndexLoading(true);
    setIndexError(null);
    setGateReason(null);

    fetchChronicleIndex(mapId, authToken)
      .then((loaded) => {
        if (cancelled) return;
        setIndex(loaded);
        const last = loaded.last;
        const first =
          loaded.days.length > DEFAULT_RANGE_DAYS
            ? loaded.days[loaded.days.length - DEFAULT_RANGE_DAYS]!
            : loaded.first;
        setRangeStart(first ?? null);
        setRangeEnd(last ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof MapAccessError && err.status === 403) {
          setGateReason(staffMapAccessReason(err));
          return;
        }
        setIndexError(
          err instanceof Error ? err.message : "Failed to load the chronicle."
        );
      })
      .finally(() => {
        if (!cancelled) setIndexLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mapId, authToken]);

  // Terrain does not change by day. One fetch covers every frame, and only
  // the terrain field is read — the payload also carries today's prosperity.
  useEffect(() => {
    let cancelled = false;
    setWaterMask(null);
    setWaterMaskStatus("loading");
    fetchMapJson<unknown>(`/${mapId}/compiled_data/provinces`, {
      sessionToken: authToken,
    })
      .then((payload) => {
        if (cancelled) return;
        const mask = chronicleDiscardedProvinceMask(payload);
        if (!mask) {
          setWaterMaskStatus("error");
          return;
        }
        setWaterMask(mask);
        setWaterMaskStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return;
        setWaterMaskStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [mapId, authToken]);

  // The grid is fetched under one session's credentials. After a login or a
  // logout in another tab `authToken` changes underneath us, and a cached grid
  // from the old session would keep being served to every later frame. Drop it
  // — and any fetch still in flight for it — whenever the identity changes.
  useEffect(() => {
    gridRef.current = null;
    gridPromiseRef.current = null;
    previewTargetRef.current = null;
    setGridVersion((version) => version + 1);
    // A different asset gets its own verdict: the previous one's CORS failure
    // says nothing about this one, and staying latched would silently give up
    // the parchment in every later export.
    setBaseCorsFailed(false);
  }, [mapId, authToken]);

  const ensureGrid = useCallback(
    async (signal?: AbortSignal): Promise<ProvinceIdGrid> => {
      if (gridRef.current) return gridRef.current;
      // Share one in-flight fetch: compose and build can both ask for the grid
      // before either has it, and the artifact is the same 95 KB either way.
      if (!gridPromiseRef.current) {
        gridPromiseRef.current = fetchProvinceIdGridQ4(mapId, authToken, signal)
          .then((grid) => {
            gridRef.current = grid;
            setGridVersion((version) => version + 1);
            return grid;
          })
          .catch((err) => {
            gridPromiseRef.current = null;
            throw err;
          });
      }
      return gridPromiseRef.current;
    },
    [mapId, authToken]
  );

  /**
   * One render target for the whole session: the compose preview and the build
   * paint through the same scratch canvas, so the timing the preview reports is
   * the timing the build will pay, and the 1600x1600 scratch buffer is only
   * ever allocated once.
   */
  const ensureRenderTarget = useCallback(
    (grid: ProvinceIdGrid): ChronicleRenderTarget => {
      const existing = previewTargetRef.current;
      if (
        existing &&
        existing.size === renderSize &&
        existing.target.grid === grid
      ) {
        return existing.target;
      }
      const target = createChronicleRenderTarget(grid, renderSize, renderSize);
      previewTargetRef.current = { target, size: renderSize };
      return target;
    },
    [renderSize]
  );

  /**
   * Each source times itself as it arrives: the build estimate is measured from
   * the bytes and milliseconds already spent rather than guessed at.
   */
  const loadNationFile = useCallback(
    async (day: string, signal?: AbortSignal) => {
      const startedAt = performance.now();
      const file = await fetchChronicleDayFile<RegionRecord>(
        mapId,
        day,
        "nation",
        authToken,
        signal
      );
      // Only the first fetch is recorded: one sample is all the estimate needs,
      // and re-recording would queue a render behind every day of a build.
      const cost = {
        bytes: file.byteLength,
        ms: Math.max(1, performance.now() - startedAt),
      };
      setNationCost((current) => current ?? cost);
      return file;
    },
    [mapId, authToken]
  );

  const loadMarkersFile = useCallback(
    async (day: string, signal?: AbortSignal) => {
      const startedAt = performance.now();
      try {
        const file = await fetchChronicleDayMarkers(mapId, day, authToken, signal);
        const cost = {
          bytes: file.byteLength,
          ms: Math.max(1, performance.now() - startedAt),
        };
        setMarkersCost((current) => current ?? cost);
        return file;
      } catch (err) {
        // A day with no stored markers still has a map worth painting.
        if (isChronicleDayFileMissing(err)) return null;
        throw err;
      }
    },
    [mapId, authToken]
  );

  /**
   * `trade` and `province_data` are their own per-day sources, timed and
   * tolerated exactly like the markers payload: a capture that missed one of
   * them is a day without leagues, or without a heat map, not a failed build.
   * Only `ChronicleDayFileMissingError` is swallowed — a transport failure or a
   * torn gzip still surfaces, because silently painting a blank layer for it
   * would be indistinguishable from a genuinely empty day.
   */
  const loadTradeFile = useCallback(
    async (day: string, signal?: AbortSignal) => {
      const startedAt = performance.now();
      try {
        const file = await fetchChronicleDayFile<RegionRecord>(
          mapId,
          day,
          "trade",
          authToken,
          signal
        );
        const cost = {
          bytes: file.byteLength,
          ms: Math.max(1, performance.now() - startedAt),
        };
        setTradeCost((current) => current ?? cost);
        return file;
      } catch (err) {
        if (isChronicleDayFileMissing(err)) return null;
        throw err;
      }
    },
    [mapId, authToken]
  );

  const loadProvinceDataFile = useCallback(
    async (day: string, signal?: AbortSignal) => {
      const startedAt = performance.now();
      try {
        const file = await fetchChronicleDayFile<unknown>(
          mapId,
          day,
          "province_data",
          authToken,
          signal
        );
        const cost = {
          bytes: file.byteLength,
          ms: Math.max(1, performance.now() - startedAt),
        };
        setProvinceDataCost((current) => current ?? cost);
        return file;
      } catch (err) {
        if (isChronicleDayFileMissing(err)) return null;
        throw err;
      }
    },
    [mapId, authToken]
  );

  const loadDay = useCallback(
    async (
      day: string,
      wants: {
        nation: boolean;
        markers: boolean;
        trade: boolean;
        provinceData: boolean;
      },
      signal?: AbortSignal
    ): Promise<ChronicleDay | null> => {
      let nation: RegionRecord | null = null;
      let markers: MapMarkersResponse | null = null;
      let trade: RegionRecord | null = null;
      let provinceData: unknown = null;
      let byteLength = 0;
      let nationFingerprint: string | null = null;
      // Each entry is one source that feeds the painted frame: its content hash
      // when the day has it, or `-` when it has none. The `-` matters — two
      // consecutive days that both lack a trade capture genuinely have the same
      // (absent) leagues, and dropping the slot entirely would let a day with
      // one source collide with a day that has another.
      const imageParts: string[] = [];

      if (wants.nation) {
        const file = await loadNationFile(day, signal);
        nation = file.value;
        nationFingerprint = file.fingerprint;
        byteLength += file.byteLength;
      }
      if (wants.markers) {
        const file = await loadMarkersFile(day, signal);
        if (file) {
          markers = file.value;
          byteLength += file.byteLength;
        }
      }
      if (wants.trade) {
        const file = await loadTradeFile(day, signal);
        if (file) {
          trade = file.value;
          byteLength += file.byteLength;
        }
        imageParts.push(file?.fingerprint ?? "-");
      }
      if (wants.provinceData) {
        const file = await loadProvinceDataFile(day, signal);
        if (file) {
          provinceData = file.value;
          byteLength += file.byteLength;
        }
        imageParts.push(file?.fingerprint ?? "-");
      }

      return {
        nation,
        markers,
        trade,
        provinceData,
        nationFingerprint,
        // Every source this build pulled that could change a painted frame,
        // joined in a fixed order. Null only when the build pulled none of
        // them, which is a build with no frame to reuse in the first place.
        //
        // Slightly conservative on one edge: a build drawing nation *names*
        // over a prosperity heat map folds the nation hash in here even though
        // names are not painted into the frame. That costs an unnecessary
        // repaint on a day where realms moved and prosperity did not, which is
        // the right way round to be wrong — the other way silently shows the
        // wrong day's pixels.
        // The focus is part of the key because it is part of what gets
        // *painted*: a defocused province is greyed inside the frame's own
        // colour table, not by an overlay drawn later. Two days that share a
        // nation file still share a frame — the focus is constant across one
        // build — but a frame carried into a build with a different focus would
        // be stale pixels, and this is what stops that from ever being possible.
        imageFingerprint: imageParts.length || nationFingerprint
          ? [
              nationFingerprint ?? "-",
              ...imageParts,
              `focus:${activeFocusNationId ?? "-"}`,
            ].join("|")
          : null,
        byteLength,
        incomplete: incompleteSet.has(day),
      };
    },
    [
      loadNationFile,
      loadMarkersFile,
      loadTradeFile,
      loadProvinceDataFile,
      incompleteSet,
      activeFocusNationId,
    ]
  );

  // The preview day's nation file also lists the realms the focus picker
  // offers, so it is fetched while any queued look still uses the focus.
  const wantNation = focusWanted;
  const wantMarkers = needsMarkers(toggles);
  const wantTrade = needsTradeFile(toggles);
  const wantProvinceData = needsProvinceData(toggles);
  const paintsFill = paintsChronicleFill(toggles);
  const dayWants = useMemo(
    () => ({
      nation: wantNation,
      markers: wantMarkers,
      trade: wantTrade,
      provinceData: wantProvinceData,
    }),
    [wantNation, wantMarkers, wantTrade, wantProvinceData]
  );
  // `|| wantNation` only so the nation file's arrival keeps pulling the grid
  // with it exactly as it always has. Nation names do not need the grid, but
  // making this the moment that stops being true is a change for its own sake.
  const wantGrid = needsProvinceGrid(toggles) || wantNation;
  // One attempt per source: stops two quick toggles from starting the same
  // fetch twice, and stops a day that genuinely has no markers from being asked
  // for again every time another layer is switched. Cleared on failure so a
  // later toggle can retry.
  const attemptedRef = useRef({
    nation: false,
    markers: false,
    trade: false,
    provinceData: false,
    grid: false,
  });
  /** Compose-preview loads still running: two toggles can overlap them. */
  const previewLoadsRef = useRef(0);
  const clearAttempts = useCallback(() => {
    attemptedRef.current = {
      nation: false,
      markers: false,
      trade: false,
      provinceData: false,
      grid: false,
    };
  }, []);

  // Compose preview: pull a source only when a toggle that needs it turns on,
  // and only once. Switching a layer back off keeps what was fetched — the
  // layer components and the paint pass gate on the toggles themselves, so
  // re-enabling one costs nothing.
  useEffect(() => {
    if (!previewDay) return;
    const fetchNation =
      wantNation && !previewNation && !attemptedRef.current.nation;
    const fetchMarkers =
      wantMarkers && !previewMarkers && !attemptedRef.current.markers;
    const fetchTrade =
      wantTrade && !previewTrade && !attemptedRef.current.trade;
    const fetchProvinceData =
      wantProvinceData &&
      !previewProvinceData &&
      !attemptedRef.current.provinceData;
    const fetchGrid = wantGrid && !attemptedRef.current.grid;
    if (
      !fetchNation &&
      !fetchMarkers &&
      !fetchTrade &&
      !fetchProvinceData &&
      !fetchGrid
    ) {
      return;
    }

    // No per-run cancellation. Every source is fetched once and marked as
    // attempted the moment it starts, so a load must land whatever happens to
    // the effect meanwhile: switching on a second layer while the first was
    // still loading re-ran this effect, and dropping the first load's result
    // then left that layer never fetched and the panel loading for good.
    // Unmounting aborts the shared signal, which is the one real cancel.
    const signal = previewAbortSignal();
    previewLoadsRef.current += 1;
    setLayersLoading(true);
    setLayerError(null);

    const load = async () => {
      try {
        if (fetchGrid) {
          attemptedRef.current.grid = true;
          // No signal on the grid: it is shared with the build, and one panel
          // re-render must not tear down a fetch the build is waiting on.
          await ensureGrid();
        }
        if (fetchNation) {
          attemptedRef.current.nation = true;
          const file = await loadNationFile(previewDay, signal);
          setPreviewNation(file.value);
        }
        if (fetchMarkers) {
          attemptedRef.current.markers = true;
          const file = await loadMarkersFile(previewDay, signal);
          setPreviewMarkers(file?.value ?? null);
        }
        if (fetchTrade) {
          attemptedRef.current.trade = true;
          const file = await loadTradeFile(previewDay, signal);
          setPreviewTrade(file?.value ?? null);
        }
        if (fetchProvinceData) {
          attemptedRef.current.provinceData = true;
          const file = await loadProvinceDataFile(previewDay, signal);
          setPreviewProvinceData(file?.value ?? null);
        }
      } catch (err) {
        // Our own abort, or a grid fetch some other caller cancelled — neither
        // is something to put in front of the user.
        if (signal.aborted || isAbortError(err)) return;
        clearAttempts();
        setLayerError(
          err instanceof Error
            ? err.message
            : `Failed to load ${previewDay}'s layers.`
        );
      } finally {
        previewLoadsRef.current -= 1;
        // Loading until the last of the overlapping loads is in.
        if (previewLoadsRef.current === 0) setLayersLoading(false);
      }
    };

    void load();
  }, [
    previewDay,
    wantNation,
    wantMarkers,
    wantTrade,
    wantProvinceData,
    wantGrid,
    previewNation,
    previewMarkers,
    previewTrade,
    previewProvinceData,
    ensureGrid,
    loadNationFile,
    loadMarkersFile,
    loadTradeFile,
    loadProvinceDataFile,
    clearAttempts,
  ]);

  const previewRegionData = useMemo(
    () => chronicleRegionData(previewNation),
    [previewNation]
  );
  const previewLabelObjects = useMemo(
    () => chronicleLabelMapObjects(previewRegionData, previewNation),
    [previewRegionData, previewNation]
  );

  const computeLabels = useCallback(
    (
      regionData: ReturnType<typeof chronicleRegionData>,
      labelObjects: ReturnType<typeof chronicleLabelMapObjects>
    ): NationLabelSpec[] | null => {
      const { neighbors, labelNeighbors, centroids, labelGrid } = geometry;
      // Null, not []. An empty array is a legitimate answer for a day with no
      // realms; "the geometry has not landed" is not an answer at all, and
      // returning [] for it let the estimate time the empty path and let the
      // build write unlabelled frames while the names toggle was on.
      if (!namesSupported || !geometry.ready || !neighbors || !centroids) {
        return null;
      }
      if (!Object.keys(regionData).length) return [];
      return computeVisibleNationLabels(
        regionData,
        neighbors,
        centroids,
        labelObjects,
        {
          grid: labelGrid ?? undefined,
          labelNeighbors: labelNeighbors ?? neighbors,
        }
      );
    },
    [geometry, namesSupported]
  );

  // The label pass is the most expensive thing a chronicle day does — connected
  // components across every province of every realm — so it is timed here on a
  // real day rather than assumed. `ms` stays null when there was no realm to
  // label, which would otherwise record a suspiciously free measurement.
  const previewLabels = useMemo(() => {
    if (!toggles.nationNames || !Object.keys(previewRegionData).length) {
      return { labels: [] as NationLabelSpec[], ms: null as number | null };
    }
    const startedAt = performance.now();
    const labels = computeLabels(previewRegionData, previewLabelObjects);
    // No geometry yet, so nothing was measured. Reporting `ms: 0.02` here made
    // the panel promise "about 0.95 s" for a build that really costs ~63 s.
    if (labels == null) {
      return { labels: [] as NationLabelSpec[], ms: null as number | null };
    }
    return { labels, ms: performance.now() - startedAt };
  }, [
    toggles.nationNames,
    computeLabels,
    previewRegionData,
    previewLabelObjects,
  ]);

  // Computed on the preview day so the estimate quotes a measured border pass,
  // exactly as it does for the label pass. `gridVersion` is the dependency
  // rather than the ref, which React cannot see change.
  const previewBorders = useMemo(() => {
    const grid = gridRef.current;
    if (!toggles.nationBorders || !grid || !previewNation) {
      return {
        mask: null as ChronicleBorderMask | null,
        ms: null as number | null,
      };
    }
    const startedAt = performance.now();
    const mask = computeChronicleBorderMask(
      grid,
      overviewFillOwnership(previewNation)
    );
    return { mask, ms: performance.now() - startedAt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggles.nationBorders, previewNation, gridVersion]);

  useEffect(() => {
    if (previewBorders.ms != null) setBorderMs(previewBorders.ms);
  }, [previewBorders]);

  // Both of the passes below are timed on the preview day for the same reason
  // the border pass is: each walks all 2.5M grid cells, so the estimate must
  // quote a measurement rather than a guess. `gridVersion` stands in for the
  // grid ref, which React cannot see change.
  const previewOccupation = useMemo(() => {
    const grid = gridRef.current;
    if (!toggles.occupation || !grid || !previewNation) {
      return {
        mask: null as ChronicleBorderMask | null,
        ms: null as number | null,
      };
    }
    const startedAt = performance.now();
    const mask = computeChronicleOccupationSeamMask(grid, previewNation);
    return { mask, ms: performance.now() - startedAt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggles.occupation, previewNation, gridVersion]);

  useEffect(() => {
    if (previewOccupation.ms != null) setOccupationMs(previewOccupation.ms);
  }, [previewOccupation]);

  const previewFortControl = useMemo(() => {
    const grid = gridRef.current;
    if (!toggles.fortControl || !grid || !previewMarkers) {
      return {
        mask: null as ChronicleBorderMask | null,
        ms: null as number | null,
      };
    }
    const startedAt = performance.now();
    const mask = computeChronicleZocMask(grid, fortZocProvinceIds(previewMarkers));
    return { mask, ms: performance.now() - startedAt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggles.fortControl, previewMarkers, gridVersion]);

  useEffect(() => {
    if (previewFortControl.ms != null) setZocMs(previewFortControl.ms);
  }, [previewFortControl]);

  const previewLayers = useMemo(() => {
    const startedAt = performance.now();
    const layers = buildChronicleLayers({
      toggles,
      markers: previewMarkers,
      labels: previewLabels.labels,
      labelObjects: previewLabelObjects,
      borders: previewBorders.mask,
      occupationSeam: previewOccupation.mask,
      fortControl: previewFortControl.mask,
      focusNationId: activeFocusNationId,
      nationFile: previewNation,
    });
    return {
      layers,
      // Marker layout is only worth timing when there were markers to lay out.
      ms: previewMarkers ? performance.now() - startedAt : null,
    };
  }, [
    toggles,
    previewMarkers,
    previewLabels.labels,
    previewLabelObjects,
    previewBorders.mask,
    previewOccupation.mask,
    previewFortControl.mask,
    activeFocusNationId,
  ]);

  useEffect(() => {
    if (previewLabels.ms != null) setLabelMs(previewLabels.ms);
  }, [previewLabels]);

  useEffect(() => {
    if (previewLayers.ms != null) setLayerMs(previewLayers.ms);
  }, [previewLayers]);

  /**
   * The one place the fill stack's order is decided, so the compose preview and
   * the build cannot disagree about what covers what — and, because everything
   * lands in the frame's single `ImageBitmap`, so the GIF export gets the same
   * order for free rather than reimplementing it a third time.
   *
   * Bottom to top:
   *
   * 1. Home territory, then occupied territory. Both opaque, both the
   *    outright owner of the ground, and already one table between them.
   * 2. The prosperity heat, partially transparent. It covers every land
   *    province the day reported — water and sea are left bare, as the live
   *    map leaves them — so it has to sit above the fill to be visible at all
   *    and has to be translucent so the realm underneath still reads. Above
   *    the nation colour it works as a wash over ownership; with the fill off
   *    it is the whole picture.
   * 3. League territory, partially transparent, on top because it is the
   *    sparsest mark of the four — a couple of hundred provinces against the
   *    map — and burying a sparse layer under a full-coverage one hides it.
   *
   * Nothing here is opaque above something else that is on, so no layer can
   * silently erase another: a nation whose land a league claims keeps its own
   * colour showing through the league's.
   */
  const composeFillLut = useCallback(
    (
      day: {
        nation: RegionRecord | null;
        trade: RegionRecord | null;
        provinceData: unknown;
      },
      lookToggles: ChronicleToggles = toggles
    ): NationColorLut => {
      // No terrain yet, or the fetch failed: withhold the two layers the live
      // map refuses to paint on water, rather than paint them and correct
      // later. A heat map that flashes across the sea is the bug this avoids.
      const terrainReady = waterMaskStatus === "ready" && waterMask != null;
      // Focus is the last step, over the finished stack rather than over each
      // layer: what the eye reads is "everything that is not this realm", and
      // that includes the league wash and the prosperity heat sitting on other
      // realms' land. Applying it per layer would leave those two in full
      // colour over grey ground.
      return focusChronicleFillLut(
        stackChronicleFillLuts([
          lookToggles.nationFill || lookToggles.occupation
            ? chronicleDayColorLut(
                day.nation ? overviewFillOwnership(day.nation) : null,
                {
                  fill: lookToggles.nationFill,
                  occupation: lookToggles.occupation,
                }
              )
            : null,
          lookToggles.prosperity && terrainReady
            ? omitDiscardedProvinces(
                buildProsperityColorLut(day.provinceData),
                waterMask
              )
            : null,
          lookToggles.tradeLeagues && terrainReady
            ? omitDiscardedProvinces(
                buildTradeLeagueColorLut(day.trade),
                waterMask
              )
            : null,
        ]),
        chronicleFocusProvinceIds(day.nation, activeFocusNationId)
      );
    },
    [toggles, activeFocusNationId, waterMask, waterMaskStatus]
  );

  // The compose preview *is* a build frame: same render target, same downscale,
  // same `transferToImageBitmap`. Two things fall out of that — what the user
  // composes is exactly what playback will show, and the time this takes is the
  // per-frame time the build will pay rather than a fraction of it.
  useEffect(() => {
    // Compose only. The build paints through this same render target, and on the
    // `createImageBitmap` fallback path the two interleave and tear each other's
    // frames; `stage === "play"` alone let the preview run right through a build.
    if (stage !== "compose") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const grid = gridRef.current;
    // Every fill layer paints through this same canvas, so any one of them keeps
    // the preview alive with the others switched off: occupied ground alone, or
    // leagues alone, or the heat map alone, on bare parchment.
    if (!paintsFill || !grid) {
      clearChronicleCanvas(canvas);
      setFrameMs(null);
      return;
    }
    const lut = composeFillLut({
      nation: previewNation,
      trade: previewTrade,
      provinceData: previewProvinceData,
    });
    // Every enabled source is still in flight, or this day genuinely has none of
    // them. Painting an empty table would blank the canvas anyway and record a
    // meaninglessly fast `frameMs` for the estimate to quote.
    if (lut.length === 0) {
      clearChronicleCanvas(canvas);
      setFrameMs(null);
      return;
    }

    let cancelled = false;
    const paint = async () => {
      const target = ensureRenderTarget(grid);
      const startedAt = performance.now();
      const { bitmap } = await renderChronicleFrame(target, lut);
      const ms = performance.now() - startedAt;
      if (cancelled) {
        bitmap.close();
        return;
      }
      drawChronicleBitmap(canvas, bitmap);
      // `drawImage` copies synchronously and no frame array holds this one.
      bitmap.close();
      setFrameMs(ms);
    };

    void paint();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stage,
    paintsFill,
    composeFillLut,
    previewNation,
    previewTrade,
    previewProvinceData,
    gridVersion,
    ensureRenderTarget,
  ]);

  const toggleSignature = useMemo(
    () => chronicleToggleSignature(toggles),
    [toggles]
  );

  /**
   * A sample is only offered once every layer that is switched on has been
   * measured on the preview day. Anything short of that returns the empty
   * sample, whose null signature makes the estimate admit it is guessing.
   */
  const costSample: ChronicleCostSample = useMemo(() => {
    const wantNation = needsNationFile(toggles);
    const wantMarkers = needsMarkers(toggles);
    const wantTrade = needsTradeFile(toggles);
    const wantProvinceData = needsProvinceData(toggles);
    const sources: SourceCost[] = [];

    if (wantNation) {
      if (!nationCost) return EMPTY_CHRONICLE_COST_SAMPLE;
      sources.push(nationCost);
    }
    if (wantMarkers) {
      if (!markersCost) return EMPTY_CHRONICLE_COST_SAMPLE;
      sources.push(markersCost);
    }
    if (wantTrade) {
      if (!tradeCost) return EMPTY_CHRONICLE_COST_SAMPLE;
      sources.push(tradeCost);
    }
    if (wantProvinceData) {
      if (!provinceDataCost) return EMPTY_CHRONICLE_COST_SAMPLE;
      sources.push(provinceDataCost);
    }
    if (!sources.length) return EMPTY_CHRONICLE_COST_SAMPLE;

    if (paintsChronicleFill(toggles) && frameMs == null) {
      return EMPTY_CHRONICLE_COST_SAMPLE;
    }
    if (toggles.nationBorders && borderMs == null) {
      return EMPTY_CHRONICLE_COST_SAMPLE;
    }
    if (toggles.occupation && occupationMs == null) {
      return EMPTY_CHRONICLE_COST_SAMPLE;
    }
    if (toggles.fortControl && zocMs == null) {
      return EMPTY_CHRONICLE_COST_SAMPLE;
    }
    if (toggles.nationNames && labelMs == null) {
      return EMPTY_CHRONICLE_COST_SAMPLE;
    }
    if (wantMarkers && layerMs == null) return EMPTY_CHRONICLE_COST_SAMPLE;

    const bytes = sources.reduce((sum, cost) => sum + cost.bytes, 0);
    const ms = sources.reduce((sum, cost) => sum + cost.ms, 0);

    return {
      signature: toggleSignature,
      bytesPerDay: bytes,
      bytesPerMs: ms > 0 ? bytes / ms : null,
      // Only the layers that are on contribute: a build with no names never
      // runs the label pass, so its cost must not be carried into the estimate.
      cpuMsPerDay:
        // One pixel pass covers all four fill layers: ownership, occupation,
        // leagues and the heat map are composited into the frame's one colour
        // table, so switching more of them on is not more paints.
        (paintsChronicleFill(toggles) ? frameMs! : 0) +
        (toggles.nationBorders ? borderMs! : 0) +
        (toggles.occupation ? occupationMs! : 0) +
        (toggles.fortControl ? zocMs! : 0) +
        (toggles.nationNames ? labelMs! : 0) +
        (wantMarkers ? layerMs! : 0),
    };
  }, [
    toggles,
    toggleSignature,
    nationCost,
    markersCost,
    tradeCost,
    provinceDataCost,
    frameMs,
    borderMs,
    occupationMs,
    zocMs,
    labelMs,
    layerMs,
  ]);

  const selection = useMemo(
    () =>
      selectChronicleRange(
        { days, incomplete_days: index?.incomplete_days ?? [] },
        rangeStart,
        rangeEnd
      ),
    [days, index, rangeStart, rangeEnd]
  );

  const clipSignature = useMemo(
    () =>
      clips
        .map((clip) => `${clip.id}:${chronicleToggleSignature(clip.toggles)}`)
        .join("|"),
    [clips]
  );
  const lookCount = Math.max(1, clips.length);
  /**
   * A sequence is several layer sets. The preview's timing describes only the
   * draft, so the estimate refuses to call itself measured and falls back to
   * the expensive case, multiplied by the number of looks.
   */
  const estimateSignature = clips.length
    ? `sequence:${clipSignature}`
    : toggleSignature;

  const estimate = useMemo(
    () =>
      estimateChronicleBuild({
        dayCount: selection.days.length * lookCount,
        sample: costSample,
        signature: estimateSignature,
        renderWidth: renderSize,
        renderHeight: renderSize,
      }),
    [
      selection.days.length,
      lookCount,
      costSample,
      estimateSignature,
      renderSize,
    ]
  );

  /**
   * The label pass needs `useMapGeometry`'s five fetches to have landed. Until
   * they do it returns nothing in microseconds, which is both an unmeasurable
   * estimate and an unlabelled build — so names being on makes the geometry a
   * hard prerequisite rather than a nice-to-have.
   */
  const geometryReady = Boolean(
    geometry.ready && geometry.neighbors && geometry.centroids
  );

  const queuedLooks = clips.length > 0 ? clips.map((clip) => clip.toggles) : [toggles];
  const sequenceNeedsNames = queuedLooks.some((look) => look.nationNames);
  const sequenceNeedsTerrain = queuedLooks.some(
    (look) => look.prosperity || look.tradeLeagues
  );
  const terrainBlock =
    sequenceNeedsTerrain && waterMaskStatus !== "ready"
      ? waterMaskStatus === "error"
        ? "Prosperity and trade leagues skip water, and the province terrain could not be loaded."
        : "Still loading which provinces are water."
      : null;

  const buildBlockReason = useMemo(
    () =>
      terrainBlock ??
      chronicleBuildBlockReason({
        selectionError: selection.error,
        dayCount: selection.days.length,
        building,
        nationNames: sequenceNeedsNames,
        namesSupported,
        geometryReady,
        overCeiling: estimate.overCeiling,
      }),
    [
      terrainBlock,
      selection,
      building,
      sequenceNeedsNames,
      namesSupported,
      geometryReady,
      estimate.overCeiling,
    ]
  );

  /** Step 1 only cares about the geometry; the range is not picked yet. */
  const composeBlockReason =
    toggles.nationNames && namesSupported && !geometryReady
      ? "Still loading label geometry — nation names cannot be measured or drawn yet."
      : null;

  const discardFrames = useCallback(() => {
    if (!framesRef.current.length) return;
    disposeChronicleFrames(framesRef.current, (bitmap) => bitmap.close());
    framesRef.current = [];
    setFramesVersion((version) => version + 1);
    setPlayIndex(0);
    setPlaying(false);
  }, []);

  // Frames are painted from one set of toggles; changing them makes every one
  // of them a lie. A queued sequence is painted from the clips, not the draft,
  // so editing the tiles leaves those frames alone until the sequence itself
  // changes.
  useEffect(() => {
    if (clipsRef.current.length > 0) return;
    if (!framesRef.current.length) return;
    discardFrames();
    setStage("compose");
    setNotice(
      "Layers changed, so the built frames were discarded. Build again when the look is right."
    );
  }, [toggles, discardFrames]);

  useEffect(() => {
    if (!framesRef.current.length) return;
    discardFrames();
    setStage("compose");
    setNotice(
      "The sequence changed, so the built frames were discarded. Build again when the order is right."
    );
  }, [clipSignature, discardFrames]);

  // The focus is painted into every frame's pixels and filtered into every
  // frame's labels and pins, so changing it makes the built frames as wrong as
  // changing a layer does. Same treatment: discard and say why, rather than
  // leaving a play head scrubbing over the previous focus's frames.
  useEffect(() => {
    if (!framesRef.current.length) return;
    discardFrames();
    setStage("compose");
    setNotice(
      "The focused realm changed, so the built frames were discarded. Build again when the look is right."
    );
  }, [activeFocusNationId, discardFrames]);

  useEffect(() => {
    if (!framesRef.current.length) return;
    discardFrames();
    setStage("range");
    setNotice("The range changed, so the built frames were discarded.");
  }, [rangeStart, rangeEnd, renderSize, discardFrames]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      previewAbortRef.current?.abort();
      gifAbortRef.current?.abort();
      disposeChronicleFrames(framesRef.current, (bitmap) => bitmap.close());
      framesRef.current = [];
    };
  }, []);

  const startBuild = useCallback(async () => {
    // The disabled button is a hint; this is the guard. A second click while the
    // first build is parked on a fetch must not start a build that nothing holds
    // a reference to, and `estimate.overCeiling` must be re-checked here rather
    // than trusted from a button that a stage change already re-enabled.
    if (buildingRef.current || buildBlockReason) return;

    buildingRef.current = true;
    setBuilding(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // Every write below is guarded on this: only the build that still owns
    // `abortRef` may touch the stage, the frames or the progress bar. A build
    // that lost the ref is a ghost and must land silently.
    const owns = () => abortRef.current === controller;
    discardFrames();
    setStage("build");
    setBuildError(null);
    // An empty queue is the draft look, labelled null so the player does not
    // announce a sequence of one. Each queued look is its own pass: frame
    // reuse stays inside the look, so the last borders frame is never the
    // first prosperity frame.
    const looks: { label: string | null; toggles: ChronicleToggles }[] =
      clips.length > 0
        ? clips.map((clip) => ({ label: clip.label, toggles: clip.toggles }))
        : [{ label: null, toggles }];
    const dayTotal = selection.days.length;
    const frameTotal = dayTotal * looks.length;
    setBuildProgress({
      completed: 0,
      total: frameTotal,
      day: selection.days[0]!,
      painted: 0,
      reused: 0,
      skipped: 0,
      look: looks[0]?.label ?? null,
    });

    setSkippedDays([]);
    // One measurement per build is enough, and it keeps the paint pass from
    // queueing a React update between every pair of frames.
    let measuredPaint = false;
    const accumulated: StudioFrame[] = [];
    const skipped = new Set<string>();
    let paintedTotal = 0;
    let reusedTotal = 0;

    try {
      const sequenceNeedsGrid = looks.some(
        (look) =>
          needsProvinceGrid(look.toggles) || needsNationFile(look.toggles)
      );
      const sequencePaintsFill = looks.some((look) =>
        paintsChronicleFill(look.toggles)
      );
      const grid = sequenceNeedsGrid ? await ensureGrid(controller.signal) : null;
      // The same target the compose preview painted through: one
      // grid-resolution scratch buffer and one small output canvas, reused for
      // every day of every look.
      const target =
        grid && sequencePaintsFill ? ensureRenderTarget(grid) : null;

      for (let lookIndex = 0; lookIndex < looks.length; lookIndex++) {
        const look = looks[lookIndex]!;
        const lookToggles = look.toggles;
        // Reset per look. A quiet stretch reuses within the look only.
        let lastLabels: {
          fingerprint: string | null;
          labels: NationLabelSpec[];
        } | null = null;
        let lastBorders: {
          fingerprint: string | null;
          mask: ChronicleBorderMask | null;
        } | null = null;
        let lastOccupation: {
          fingerprint: string | null;
          mask: ChronicleBorderMask | null;
        } | null = null;

        const result = await runChronicleBuild<
          ChronicleDay,
          ImageBitmap,
          ChronicleFrameLayers
        >({
          days: selection.days,
          concurrency: CHRONICLE_FETCH_CONCURRENCY,
          signal: controller.signal,
          onProgress: (progress) => {
            if (!owns()) return;
            setBuildProgress({
              ...progress,
              completed: lookIndex * dayTotal + progress.completed,
              total: frameTotal,
              painted: paintedTotal + progress.painted,
              reused: reusedTotal + progress.reused,
              skipped: skipped.size + progress.skipped,
              look: look.label,
            });
          },
          effects: {
            loadDay: async (day, signal) => {
              try {
                return await loadDay(
                  day,
                  {
                    nation: needsNationFile(lookToggles),
                    markers: needsMarkers(lookToggles),
                    trade: needsTradeFile(lookToggles),
                    provinceData: needsProvinceData(lookToggles),
                  },
                  signal
                );
              } catch (err) {
                if (signal?.aborted) throw new ChronicleBuildCancelled();
                // A day missing its sources is a hole in the history, not a
                // failure: the build reports it and carries on.
                if (isChronicleDayFileMissing(err)) return null;
                throw err;
              }
            },
            renderDay: async (_day, load) => {
              if (!target || !paintsChronicleFill(lookToggles)) return null;
              const lut = composeFillLut(load, lookToggles);
              // Nothing to paint: this day is missing every source the enabled
              // fill layers read. It becomes a frame with no bitmap — the
              // overlays still draw over bare parchment — rather than a skip.
              if (lut.length === 0) return null;
              const startedAt = performance.now();
              const { bitmap } = await renderChronicleFrame(target, lut);
              // The first real build frame is a better sample than the preview's,
              // and it costs one state update rather than one per day.
              if (!measuredPaint && owns()) {
                measuredPaint = true;
                setFrameMs(performance.now() - startedAt);
              }
              return bitmap;
            },
            buildLayers: (_day, load) => {
              const regionData = chronicleRegionData(load.nation);
              const labelObjects = chronicleLabelMapObjects(
                regionData,
                load.nation
              );

              let labels: NationLabelSpec[] = [];
              if (lookToggles.nationNames) {
                const reusable =
                  lastLabels != null &&
                  load.nationFingerprint != null &&
                  lastLabels.fingerprint === load.nationFingerprint;
                labels = reusable
                  ? lastLabels!.labels
                  : (computeLabels(regionData, labelObjects) ?? []);
                lastLabels = { fingerprint: load.nationFingerprint, labels };
              }

              let borders: ChronicleBorderMask | null = null;
              if (lookToggles.nationBorders && grid && load.nation) {
                const reusable =
                  lastBorders != null &&
                  load.nationFingerprint != null &&
                  lastBorders.fingerprint === load.nationFingerprint;
                borders = reusable
                  ? lastBorders!.mask
                  : computeChronicleBorderMask(
                      grid,
                      overviewFillOwnership(load.nation)
                    );
                lastBorders = {
                  fingerprint: load.nationFingerprint,
                  mask: borders,
                };
              }

              let occupationSeam: ChronicleBorderMask | null = null;
              if (lookToggles.occupation && grid && load.nation) {
                const reusable =
                  lastOccupation != null &&
                  load.nationFingerprint != null &&
                  lastOccupation.fingerprint === load.nationFingerprint;
                occupationSeam = reusable
                  ? lastOccupation!.mask
                  : computeChronicleOccupationSeamMask(grid, load.nation);
                lastOccupation = {
                  fingerprint: load.nationFingerprint,
                  mask: occupationSeam,
                };
              }

              const fortControl =
                lookToggles.fortControl && grid
                  ? computeChronicleZocMask(
                      grid,
                      fortZocProvinceIds(load.markers)
                    )
                  : null;

              return buildChronicleLayers({
                toggles: lookToggles,
                markers: load.markers,
                labels,
                labelObjects,
                borders,
                occupationSeam,
                fortControl,
                focusNationId: activeFocusNationId,
                nationFile: load.nation,
              });
            },
            disposeImage: (bitmap) => bitmap.close(),
          },
        });

        if (!owns()) {
          // Cancelled and superseded while this build was still in flight. Its
          // frames belong to nobody: hand them back to the GC rather than
          // overwriting the live build's array and leaking it.
          disposeChronicleFrames(result.frames, (bitmap) => bitmap.close());
          disposeChronicleFrames(accumulated, (bitmap) => bitmap.close());
          return;
        }

        paintedTotal += result.paintedCount;
        reusedTotal += result.reusedCount;
        for (const day of result.skippedDays) skipped.add(day);
        for (const frame of result.frames) {
          accumulated.push({ ...frame, clipLabel: look.label });
        }
      }

      if (!owns()) {
        disposeChronicleFrames(accumulated, (bitmap) => bitmap.close());
        return;
      }

      framesRef.current = accumulated;
      setSkippedDays(Array.from(skipped));
      setFramesVersion((version) => version + 1);
      setPlayIndex(0);
      setStage(accumulated.length ? "play" : "range");
      if (!accumulated.length) {
        setBuildError("No day in that range had anything to draw.");
      }
    } catch (err) {
      disposeChronicleFrames(accumulated, (bitmap) => bitmap.close());
      if (!owns()) return;
      if (isChronicleBuildCancelled(err) || isAbortError(err)) {
        setBuildProgress(null);
        setStage("range");
        return;
      }
      setBuildError(
        err instanceof Error ? err.message : "The build failed part-way."
      );
    } finally {
      buildingRef.current = false;
      setBuilding(false);
      // Identity check: a superseded build must not clear the ref belonging to
      // the build that replaced it, which is what made Cancel and Back no-ops.
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [
    buildBlockReason,
    selection,
    toggles,
    clips,
    composeFillLut,
    ensureGrid,
    ensureRenderTarget,
    loadDay,
    computeLabels,
    discardFrames,
    activeFocusNationId,
  ]);

  const cancelBuild = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const frames = framesRef.current;
  const activeFrame: StudioFrame | null =
    stage === "play" ? (frames[playIndex] ?? null) : null;

  // `ChroniclePlaybackPanel`'s `days` prop, built once per build rather than
  // once per render — `frames` above is a fresh read of a ref every render,
  // so `.map()` on it allocated a brand-new array every time even when the
  // built frames hadn't changed at all. `framesRef.current` only actually
  // changes alongside `framesVersion` (see the effects above), the same
  // dependency those already key off instead of `frames` itself.
  const frameDays = useMemo(
    () => framesRef.current.map((frame) => frame.day),
    [framesVersion]
  );

  // Ledger charts read the range actually built, not the range inputs — a
  // build can skip days, and the panel's cursor has to walk the same span
  // `exploreHref`'s prev/next does.
  const ledgerCharts = useLedgerSeries({
    mapId,
    sessionToken: authToken,
    active: stage === "play" && chartsOpen,
    firstDay: frames.length ? frames[0]!.day : null,
    lastDay: frames.length ? frames[frames.length - 1]!.day : null,
    focusNationId: activeFocusNationId,
  });
  const activeLayers = activeFrame?.layers ?? EMPTY_CHRONICLE_LAYERS;
  const layers = stage === "play" ? activeLayers : previewLayers.layers;

  // Playback and scrubbing are the same two operations: draw the day's bitmap,
  // swap in its precomputed overlays. Nothing here touches the network.
  useEffect(() => {
    if (stage !== "play") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawChronicleBitmap(canvas, framesRef.current[playIndex]?.image ?? null);
  }, [stage, playIndex, framesVersion]);

  // Advancing from a ref rather than from `playIndex` keeps the loop off the
  // effect's dependency list, so a running playback is never torn down and
  // restarted between two frames.
  const playIndexRef = useRef(0);
  useEffect(() => {
    playIndexRef.current = playIndex;
  }, [playIndex]);

  useEffect(() => {
    if (stage !== "play" || !playing) return;
    const total = framesRef.current.length;
    if (total < 2) return;

    let raf = 0;
    let last = performance.now();
    const step = (time: number) => {
      raf = requestAnimationFrame(step);
      const frameIntervalMs = 1000 / speed;
      const elapsed = time - last;
      if (elapsed < frameIntervalMs) return;
      last = time - (elapsed % frameIntervalMs);

      const next = playIndexRef.current + 1;
      if (next < total) {
        playIndexRef.current = next;
        setPlayIndex(next);
      } else if (loop) {
        playIndexRef.current = 0;
        setPlayIndex(0);
      } else {
        setPlaying(false);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [stage, playing, speed, loop, framesVersion]);

  /**
   * Flattens the built frames into a GIF and hands it to the browser.
   *
   * Everything is inside one try/catch that lands in `gifError`: there is no
   * error boundary under `app/`, so an escaping throw here would not fail the
   * button, it would blank the page. The `finally` is what guarantees the
   * button comes back — a stuck "Encoding…" with no way out is worse than the
   * failure it is hiding.
   */
  const exportGif = useCallback(async () => {
    if (exportingRef.current) return;
    const built = framesRef.current;
    if (!built.length) return;

    exportingRef.current = true;
    // The render loop yields between days, so a playback still running would
    // keep repainting the preview canvas and stealing the frames' turn on the
    // main thread for the whole export.
    setPlaying(false);
    setGifError(null);
    setGifNotice(null);
    setGifStatus("Preparing…");

    // One controller per export — `exportChronicleGif` checks the signal
    // between rendered days and between encode frames, and can stop neither
    // loop from an abort that never reaches it.
    // `exportingRef` guarantees only one of these is ever live, but a stale
    // one from a run that already finished is aborted first regardless, the
    // same defensive pattern `previewAbortSignal` uses.
    gifAbortRef.current?.abort();
    const controller = new AbortController();
    gifAbortRef.current = controller;

    try {
      const { bytes, baseMapOmitted } = await exportChronicleGif({
        frames: built.map((frame) => ({
          day: frame.day,
          image: frame.image,
          layers: frame.layers,
        })),
        size: gifSize,
        mapW: mapSize.w,
        mapH: mapSize.h,
        baseImage: baseImageRef.current,
        fillOpacity: CHRONICLE_FILL_OPACITY,
        delayMs: chronicleGifDelayMs(speed),
        loop,
        centroids: geometry.centroids,
        stampDay: gifStampDay,
        logo: gifLogo,
        discordLink: gifDiscordLink,
        watermarkCorner: gifCorner,
        signal: controller.signal,
        onProgress: (progress) => {
          setGifStatus(
            progress.phase === "render"
              ? `Rendering day ${progress.completed + 1} of ${progress.total}…`
              : "Encoding…"
          );
        },
      });
      downloadGif(
        bytes,
        chronicleGifFilename(
          displayName,
          built[0]!.day,
          built[built.length - 1]!.day
        )
      );
      if (baseMapOmitted) {
        setGifNotice(
          "Exported without the base map — the browser would not let its pixels be read."
        );
      }
    } catch (err) {
      if (!isChronicleGifCancelled(err)) {
        setGifError(
          err instanceof Error ? err.message : "The GIF export failed."
        );
      }
    } finally {
      if (gifAbortRef.current === controller) gifAbortRef.current = null;
      exportingRef.current = false;
      setGifStatus(null);
    }
  }, [
    gifSize,
    gifStampDay,
    gifLogo,
    gifDiscordLink,
    gifCorner,
    mapSize,
    speed,
    loop,
    geometry.centroids,
    displayName,
  ]);

  const focusOptions = useMemo(
    () => chronicleFocusOptions(previewNation),
    [previewNation]
  );

  const toggleLayer = useCallback((key: ChronicleToggleKey) => {
    setNotice(null);
    setToggles((current) => ({ ...current, [key]: !current[key] }));
  }, []);


  // Space plays and pauses, as in a video player, unless a control has focus:
  // there Space already means "press this".
  useEffect(() => {
    if (stage !== "play") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== " " || event.repeat || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, select, textarea, [contenteditable]")) return;
      event.preventDefault();
      setPlaying((current) => !current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stage]);

  if (gateReason) {
    return <MapAccessGate reason={gateReason} mapDisplayName={displayName} />;
  }

  const disabledReasons: Partial<Record<ChronicleToggleKey, string>> =
    namesSupported
      ? {}
      : { nationNames: "Unavailable — label geometry only exists for the live map." };

  const emptyChronicle = !indexLoading && !indexError && days.length === 0;
  const layersOn = CHRONICLE_TOGGLE_ORDER.filter(({ key }) => toggles[key]).length;
  const hasQueuedLook = clips.some((clip) => anyChronicleToggleOn(clip.toggles));
  const composeReady =
    (anyChronicleToggleOn(toggles) || hasQueuedLook) &&
    !composeBlockReason &&
    !layersLoading &&
    !indexLoading;

  const step: ChronicleStep =
    stage === "compose" ? "layers" : stage === "play" ? "watch" : "dates";
  const reachable: Record<ChronicleStep, boolean> = {
    layers: !building,
    dates: !building && (composeReady || stage !== "compose"),
    watch: !building && frames.length > 0,
  };
  const goToStep = (next: ChronicleStep) => {
    if (next === step) return;
    setNotice(null);
    setPlaying(false);
    setStage(next === "layers" ? "compose" : next === "dates" ? "range" : "play");
  };

  const player = (variant: "bar" | "sheet") => (
    <ChroniclePlayer
      variant={variant}
      days={frameDays}
      activeIndex={playIndex}
      onScrub={(next) => {
        setPlaying(false);
        setPlayIndex(Math.max(0, Math.min(frameDays.length - 1, next)));
      }}
      playing={playing}
      onTogglePlay={() => setPlaying((current) => !current)}
      speed={speed}
      onSpeedChange={setSpeed}
      loop={loop}
      onLoopChange={setLoop}
      incomplete={Boolean(activeFrame?.incomplete)}
      look={activeFrame?.clipLabel}
    />
  );

  const charts =
    stage === "play" && chartsOpen ? (
      <LedgerChartsPanel result={ledgerCharts} cursorDay={activeFrame?.day ?? null} />
    ) : null;

  const exploreHref = activeFrame
    ? chronicleDayHref(
        mapId,
        activeFrame.day,
        // The span of the timelapse as it was actually built, not the range
        // inputs: skipped days move the ends, and the day page's previous/next
        // must walk what the reader watched.
        frames.length
          ? { start: frames[0].day, end: frames[frames.length - 1].day }
          : null
      )
    : null;

  // What the pulled-down phone sheet says, so the step is never out of mind.
  const sheetSummary =
    stage === "compose"
      ? layersOn
        ? `${layersOn} layer${layersOn === 1 ? "" : "s"} on`
        : "No layers on yet"
      : stage === "range"
        ? rangeStart && rangeEnd
          ? `${formatChronicleDay(rangeStart)} – ${formatChronicleDay(rangeEnd)}`
          : "Pick the days"
        : stage === "build"
          ? `Building · ${buildProgress?.completed ?? 0} of ${buildProgress?.total ?? 0} days`
          : activeFrame
            ? activeFrame.clipLabel
              ? `${activeFrame.clipLabel} · ${formatChronicleDay(activeFrame.day)}`
              : formatChronicleDay(activeFrame.day)
            : "";

  const indexNotices = (
    <>
      {indexError ? <ChronicleNotice>{indexError}</ChronicleNotice> : null}
      {emptyChronicle ? (
        <ChronicleNotice tone="quiet">
          No days have been captured for this map yet. The timelapse starts once the
          first daily snapshot lands.
        </ChronicleNotice>
      ) : null}
      {layerError ? <ChronicleNotice>{layerError}</ChronicleNotice> : null}
    </>
  );

  const stepBody =
    emptyChronicle || (indexError && !index) ? null : stage === "compose" ? (
      <ChronicleTogglePanel
        toggles={toggles}
        onToggle={toggleLayer}
        disabledReasons={disabledReasons}
        notice={notice}
        focusOptions={focusOptions}
        focusNationId={focusNationId}
        onFocusChange={(next) => {
          setNotice(null);
          setFocusNationId(next);
        }}
        focusDisabledReason={
          focusWanted
            ? focusOptions.length
              ? null
              : "Waiting on the latest day's realms…"
            : "Switch on a nation layer to pick a nation."
        }
        clips={clips}
        canAddClip={anyChronicleToggleOn(toggles)}
        onAddClip={() => {
          if (!anyChronicleToggleOn(toggles)) return;
          clipSerial.current += 1;
          setClips((current) => [
            ...current,
            {
              id: `look-${clipSerial.current}`,
              label: chronicleClipLabel(toggles),
              toggles: { ...toggles },
            },
          ]);
        }}
        onRemoveClip={(id) => {
          setClips((current) => current.filter((clip) => clip.id !== id));
        }}
        onMoveClip={(id, direction) => {
          setClips((current) => {
            const index = current.findIndex((clip) => clip.id === id);
            const next = index + direction;
            if (index < 0 || next < 0 || next >= current.length) return current;
            const copy = current.slice();
            const [moved] = copy.splice(index, 1);
            copy.splice(next, 0, moved!);
            return copy;
          });
        }}
      />
    ) : stage === "range" ? (
      <ChronicleRangePanel
        days={days}
        incompleteDays={incompleteSet}
        start={rangeStart}
        end={rangeEnd}
        onStartChange={setRangeStart}
        onEndChange={setRangeEnd}
        selection={selection}
        estimate={estimate}
        renderSize={renderSize}
        onRenderSizeChange={setRenderSize}
        blockReason={buildBlockReason}
        notice={notice ?? buildError}
        lookCount={lookCount}
      />
    ) : stage === "build" ? (
      <ChronicleBuildPanel progress={buildProgress} error={buildError} />
    ) : (
      <ChroniclePlaybackPanel
        player={player("sheet")}
        skippedDays={skippedDays}
        exploreHref={exploreHref}
        chartsOpen={chartsOpen}
        onToggleCharts={() => setChartsOpen((current) => !current)}
        charts={charts}
        gifSize={gifSize}
        onGifSizeChange={setGifSize}
        gifStampDay={gifStampDay}
        onGifStampDayChange={setGifStampDay}
        gifLogo={gifLogo}
        onGifLogoChange={setGifLogo}
        gifDiscordLink={gifDiscordLink}
        onGifDiscordLinkChange={setGifDiscordLink}
        gifCorner={gifCorner}
        onGifCornerChange={setGifCorner}
        gifStatus={gifStatus}
        gifError={gifError}
        gifNotice={gifNotice}
      />
    );

  const stepFooter =
    emptyChronicle || (indexError && !index) ? null : stage === "compose" ? (
      <button
        type="button"
        className={`${primaryButtonClass} w-full`}
        onClick={() => goToStep("dates")}
        disabled={!composeReady}
      >
        {layersLoading || indexLoading
          ? "Loading layers…"
          : composeBlockReason
            ? "Waiting on label geometry…"
            : anyChronicleToggleOn(toggles) || hasQueuedLook
              ? "Next: choose the days"
              : "Switch on a layer first"}
      </button>
    ) : stage === "range" ? (
      <div className="flex gap-2">
        <button type="button" className={quietButtonClass} onClick={() => goToStep("layers")}>
          Back
        </button>
        <button
          type="button"
          className={`${primaryButtonClass} flex-1`}
          onClick={() => void startBuild()}
          disabled={Boolean(buildBlockReason)}
        >
          {clips.length > 0
            ? `Build ${clips.length} ${clips.length === 1 ? "look" : "looks"}`
            : `Build ${selection.days.length || ""} frames`}
        </button>
      </div>
    ) : stage === "build" ? (
      buildError ? (
        <button
          type="button"
          className={`${quietButtonClass} w-full`}
          onClick={() => setStage("range")}
        >
          Back to the days
        </button>
      ) : (
        <button type="button" className={`${quietButtonClass} w-full`} onClick={cancelBuild}>
          Cancel build
        </button>
      )
    ) : (
      <div className="flex gap-2">
        <button
          type="button"
          className={quietButtonClass}
          onClick={() => {
            discardFrames();
            setStage("compose");
            setNotice(null);
          }}
        >
          Start over
        </button>
        <button
          type="button"
          className={`${primaryButtonClass} flex-1`}
          onClick={() => void exportGif()}
          disabled={gifStatus != null}
        >
          <DownloadIcon size={17} />
          {gifStatus ?? "Export GIF"}
        </button>
      </div>
    );

  const panel = sheetMin ? (
    <ChronicleSheetSummary step={step} summary={sheetSummary} onOpen={() => setSheetMin(false)} />
  ) : (
    <div className="space-y-5 pt-4">
      {indexNotices}
      {stepBody}
    </div>
  );

  return (
    <MapShell
      plaque={<ChroniclePlaque displayName={displayName} liveHref={liveMapHref(mapId)} />}
      details={panel}
      // A fresh sheet, at its smaller size, when it is pulled down or put back,
      // and when playback starts, so the player is what shows.
      detailsKey={sheetMin ? "summary" : stage === "play" ? "watch" : "steps"}
      onDetailsClose={() => setSheetMin(true)}
      detailsHeader={
        sheetMin ? null : (
          <ChronicleSteps current={step} reachable={reachable} onSelect={goToStep} />
        )
      }
      detailsFooter={sheetMin ? null : stepFooter}
      status={
        indexLoading
          ? "Loading the timelapse…"
          : stage === "compose" && layersLoading
            ? "Loading layers…"
            : null
      }
      zoomControls={
        <MapZoomControls
          onZoom={viewport.zoomBy}
          onReset={() => viewport.resetViewport({ animated: true })}
        />
      }
      footer={stage === "play" && frameDays.length ? player("bar") : null}
      aside={charts ? <div className="space-y-3">{charts}</div> : null}
    >
      <MapViewport
        mapSize={mapSize}
        viewportRef={viewport.viewportRef}
        contentRef={viewport.contentRef}
        transformStyle={viewport.transformStyle}
        zoom={viewport.zoom}
        transformTransition={viewport.transformTransition}
        cursorClassName={viewport.cursorClassName}
        isPanning={viewport.isPanning}
        fill
        capturesTouch
      >
        <MapAuthImage
          mapId={mapId}
          path={`/${mapId}/map`}
          sessionToken={authToken}
          alt={`${displayName} base map`}
          className="pointer-events-none block h-full w-full"
          // The GIF export composites this exact decoded image, and a
          // canvas it taints can never be read back. Asking for it with
          // CORS costs nothing when the header is there — it is the same
          // request, so the ~34 MB asset is not fetched twice — and the
          // `onError` swap below covers the case where it is not.
          crossOrigin={baseCorsFailed ? undefined : "anonymous"}
          onError={() => {
            // Idempotent on purpose: the bare retry this triggers can fail
            // again (a genuinely missing asset), and React bails out of a
            // set to the value already held, so there is no render loop.
            setBaseCorsFailed(true);
          }}
          imgRef={(node) => {
            baseImageRef.current = node;
          }}
          onLoad={(event) => {
            const img = event.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setMapSize((current) =>
                current.w === img.naturalWidth && current.h === img.naturalHeight
                  ? current
                  : { w: img.naturalWidth, h: img.naturalHeight }
              );
            }
          }}
        />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 z-[12] h-full w-full"
          style={{ opacity: CHRONICLE_FILL_OPACITY }}
        />
        {/*
          All three share z-13 and stack by document order: the fort hatch
          under the borders it runs beneath, the occupation seam over them,
          which is the order the GIF export composites them in too.
        */}
        <ChronicleBorderCanvas mask={layers.fortControl} ink={CHRONICLE_ZOC_HATCH_RGBA} />
        <ChronicleBorderCanvas mask={layers.borders} ink={CHRONICLE_BORDER_INK_RGBA} />
        <ChronicleBorderCanvas
          mask={layers.occupationSeam}
          ink={CHRONICLE_OCCUPATION_SEAM_RGBA}
        />
        {layers.wars.length ? (
          <WarCampaignLineLayer
            wars={layers.wars}
            centroids={geometry.centroids}
            mapW={mapSize.w}
            mapH={mapSize.h}
          />
        ) : null}
        {/*
          `alwaysVisible` on both: every layer here is one the user ticked
          on in Compose, so the live map's zoom-size gate would hide the
          thing they asked for. Crowding is theirs to judge — the toggle
          that switched the layer on switches it back off.
        */}
        <MapMarkerLayer
          markers={layers.markers}
          mapW={mapSize.w}
          mapH={mapSize.h}
          mapType="nation"
          displayScale={viewport.displayScale}
          layer="base"
          alwaysVisible
        />
        <LabelLayer
          labels={layers.labels}
          mapW={mapSize.w}
          mapH={mapSize.h}
          displayScale={viewport.displayScale}
          alwaysVisible
        />
      </MapViewport>
    </MapShell>
  );
}
