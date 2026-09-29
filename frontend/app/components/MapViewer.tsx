"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useMapEngine } from "../core/MapEngineContext";
import { useMapHover } from "../hooks/useMapHover";
import type { MapPickViewport } from "../hooks/useMapCoords";
import useMapPaint from "../hooks/useMapPaint";
import { useMapModeData } from "../hooks/useMapModeData";
import { useMapGeometry } from "../hooks/useMapGeometry";
import { useMapMarkers } from "../hooks/useMapMarkers";
import { isMarkerMapMode } from "../lib/mapMarkers";
import type { FitMode } from "../lib/mapViewportMath";
import {
  installationToMapMarker,
} from "../lib/installationMarkers";
import { warBattleMarkersFromWars } from "../lib/warBattleMarkers";
import {
  settlementToMapMarker,
  visibleSettlementKind,
} from "../lib/settlementMarkers";
import { useGuildCache } from "../hooks/useGuildCache";
import { useTitleLayerData } from "../hooks/useTitleLayerData";
import {
  computeRegionLabelGeometry,
  filterRegionLabelsForMapObjects,
  LABEL_MAP_MODES,
} from "../lib/mapLabels";
import {
  applyDrillStack,
  drillStackNames,
  getAncestryChain,
  getNextDrillTarget,
  type DrillLayer,
} from "./map/drillUtils";
import MapAccessGate, {
  type MapAccessGateReason,
} from "./map/MapAccessGate";
import MapCanvas from "./map/MapCanvas";
import MapPageLayout from "./map/MapPageLayout";
import MapToolbar from "./map/MapToolbar";
import PaintToolbar from "./map/PaintToolbar";
import {
  MapDesktopSidePanel,
  MapDrillStackBar,
} from "./map/MapSidePanel";
import NationDetailModal from "./map/NationDetailModal";
import { buildRegionInfo } from "./map/regionInfo";
import type {
  CursorTooltip,
  HoverOverlay,
  MapId,
  MapMode,
  RegionInfo,
} from "./map/types";
import { mapFallbackSize, mapDisplayName } from "./map/types";
import { useAccessibleMaps } from "../hooks/useAccessibleMaps";
import { useCharacterSessionToken } from "../hooks/useCharacterSessionToken";
import { useCanEditMap } from "../hooks/useCanEditMap";
import {
  MapAccessError,
  fetchMapBlobUrl,
  fetchMapJson,
  mapApiUrl,
  mapRequiresAuth,
  revokeMapBlobUrl,
  staffMapAccessReason,
} from "@/lib/map/api";
import { editorUrl } from "@/lib/map/editorAccess";
import { chronicleStudioHref, liveMapHref } from "@/app/lib/map/chronicleDayRoute";
import { isArchivedMap, showReviewHistory } from "@/app/lib/map/archiveMaps";
import MapArchiveMenu from "./map/MapArchiveMenu";
import ChronicleOwnershipLayer from "./chronicle/ChronicleOwnershipLayer";
import { fetchProvinceIdGridQ4 } from "@/app/lib/map/chronicleData";
import { directOwnership } from "@/app/lib/map/chronicleOwnership";
import ChronicleProvincePaintLayer from "./chronicle/ChronicleProvincePaintLayer";
import { useChronicleProvincePaint } from "../hooks/useChronicleProvincePaint";
import { usesChronicleProvincePaint } from "@/app/lib/map/chronicleDayModes";
import {
  buildNationColorLut,
  paintChronicleFrameToImageData,
  type ProvinceIdGrid,
} from "@/app/lib/map/chroniclePaint";

const editTitlesLinkClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-cream)] no-underline transition hover:brightness-110 hover:border-[var(--tfmc-accent)]";

/**
 * The chronicle is the one feature nothing else on the map hints at, so this
 * sits beside the map's title in accent colours rather than reading as a peer
 * of "Edit titles". Without it a viewer has no way to discover the map has any
 * history at all.
 */
const reviewHistoryLinkClass =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--tfmc-accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_16%,transparent)] px-2.5 py-1.5 text-xs font-medium text-[var(--tfmc-cream)] no-underline transition hover:border-[var(--tfmc-accent)] hover:bg-[color-mix(in_srgb,var(--tfmc-accent)_28%,transparent)]";

function ReviewHistoryLink({ mapId }: { mapId: MapId }) {
  return (
    <Link href={chronicleStudioHref(mapId)} className={reviewHistoryLinkClass}>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-[var(--tfmc-accent)]"
      >
        <path
          d="M10 5.5V10l2.75 1.75M3 10a7 7 0 1 0 2.2-5.1M3 3.5V7h3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Review History
    </Link>
  );
}

const fitModeLabelClass = (active: boolean) =>
  `text-xs transition ${active ? "text-[var(--tfmc-cream)]" : "text-[var(--tfmc-stone)]"}`;

type MapViewerProps = {
  mapId: MapId;
  /**
   * A chronicle day (`YYYY-MM-DD`) to render instead of the live map, or `null`
   * for the live map. Taken as a prop rather than read from
   * `ChronicleDayContext` so the data flow is visible at the call site and this
   * component stays usable without a provider.
   *
   * Non-null switches every day-scoped source over *and* replaces the three
   * server-rendered nation layers with client-side paints — see the pick canvas
   * effect and `ChronicleOwnershipLayer`.
   */
  day?: string | null;
};

const MapViewer = ({ mapId, day = null }: MapViewerProps) => {
  const chronicle = day !== null;
  /*
   * A stored day offers the *same* mode list as the live map, with no
   * filtering. Every mode now has an honest day answer: the day-varying ones
   * (`nation`, `trade`, `empire`, `prosperity`, `infestation`) come out of that
   * day's capture, and the static ones (`terrain`, `fertility`, `province`)
   * are province geometry that does not change day to day, so their live
   * source *is* their historical answer. Title modes (`county`, `duchy`,
   * `kingdom`, `empire`) come from that day's capture.
   *
   * A mode with nothing stored for a particular day still falls through to the
   * "missing from this capture" panel below rather than being hidden — the
   * capture set is still growing, and an option that disappears per day is
   * harder to reason about than one that says what it does not have.
   */
  const sessionToken = useCharacterSessionToken();
  const { maps } = useAccessibleMaps();
  const { canEdit, loading: canEditLoading } = useCanEditMap(mapId, sessionToken);
  const authToken = mapRequiresAuth(mapId, maps) ? sessionToken : null;
  const [gateReason, setGateReason] = useState<MapAccessGateReason | null>(
    null
  );
  const [accessChecked, setAccessChecked] = useState(mapId === "main");

  const [mapType, setMapType] = useState<MapMode>("nation");
  const [fitMode, setFitMode] = useState<FitMode>("contain");
  const [hoveredOverlay, setHoveredOverlay] = useState<HoverOverlay | null>(
    null
  );
  const [hoveredFortZoc, setHoveredFortZoc] = useState<HoverOverlay | null>(
    null
  );
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [regionInfo, setRegionInfo] = useState<RegionInfo | null>(null);
  const [modalRegionInfo, setModalRegionInfo] = useState<RegionInfo | null>(
    null
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [drillStack, setDrillStack] = useState<DrillLayer[]>([]);
  const [pendingDrillId, setPendingDrillId] = useState<string | null>(null);
  const [cursorTooltip, setCursorTooltip] = useState<CursorTooltip | null>(
    null
  );
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportCoordsRef = useRef<MapPickViewport | null>(null);
  const lastProvinceIdRef = useRef<number | null>(null);

  const displayName = mapDisplayName(mapId, maps);

  useEffect(() => {
    if (!mapRequiresAuth(mapId, maps)) {
      setGateReason(null);
      setAccessChecked(true);
      return;
    }

    let cancelled = false;
    setAccessChecked(false);
    setGateReason(null);

    void fetchMapJson(`/${mapId}/data/nation`, { sessionToken: authToken })
      .then(() => {
        if (!cancelled) setGateReason(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof MapAccessError && err.status === 403) {
          setGateReason(staffMapAccessReason(err));
        }
      })
      .finally(() => {
        if (!cancelled) setAccessChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [mapId, authToken, maps]);

  const guildNameCacheRef = useGuildCache(mapId, authToken, day);
  const paint = useMapPaint({ mapId, viewportCoordsRef });

  const {
    mapObjects,
    loadData,
    resetDrillVisibility,
    resetMapObjects,
    getHoverRegion,
    drillDownRegion,
  } = useMapEngine();
  const {
    regionData,
    loading,
    accessError,
    notCapturedForDay,
    dayFileMissing,
  } = useMapModeData({
    mapId,
    mapType,
    loadData,
    sessionToken: authToken,
    day,
  });
  /**
   * `prosperity` and `infestation` under a stored day. Both are drawn on the
   * live map as `/{mapId}/mapdata/{mode}`, a raster regenerated from today's
   * data with no per-day variant, so the day page paints them itself from that
   * day's captured file — see `ChronicleProvincePaintLayer`.
   */
  const provincePaint = useChronicleProvincePaint({
    mapId,
    mapType,
    day,
    sessionToken: authToken,
  });
  const { layers: titleLayers } = useTitleLayerData(
    mapId,
    mapType,
    regionData,
    authToken,
    day
  );
  const {
    neighbors,
    labelNeighbors,
    centroids,
    labelGrid,
    ready: geometryReady,
  } = useMapGeometry(mapId, authToken);
  const markersEnabled = accessChecked && gateReason === null;
  const { settlements, installations, forts, wars } = useMapMarkers(mapId, authToken, markersEnabled, day);

  const mapMarkers = useMemo(() => {
    if (!isMarkerMapMode(mapType)) return [];
    const battleMarkers = warBattleMarkersFromWars(wars);
    return [
      ...settlements.map((settlement) =>
        settlementToMapMarker({
          ...settlement,
          kind: visibleSettlementKind(
            settlement.kind,
            settlement.faction_id,
            mapObjects
          ),
        })
      ),
      ...installations.map(installationToMapMarker),
      ...battleMarkers,
    ];
  }, [settlements, installations, wars, mapType, mapObjects]);

  const labelGeometry = useMemo(() => {
    if (!LABEL_MAP_MODES.has(mapType)) return null;
    if (!regionData || !neighbors || !centroids) return null;
    const needsTitleLayers =
      mapType === "duchy" ||
      mapType === "kingdom" ||
      mapType === "empire" ||
      mapType === "trade";
    if (needsTitleLayers && !titleLayers) {
      return null;
    }
    return computeRegionLabelGeometry(
      mapType,
      regionData,
      titleLayers,
      neighbors,
      centroids,
      {
        grid: labelGrid ?? undefined,
        labelNeighbors: labelNeighbors ?? neighbors,
      }
    );
  }, [
    mapType,
    regionData,
    titleLayers,
    neighbors,
    labelNeighbors,
    centroids,
    labelGrid,
  ]);

  const regionLabels = useMemo(
    () => filterRegionLabelsForMapObjects(labelGeometry, mapType, mapObjects),
    [labelGeometry, mapType, mapObjects]
  );

  useEffect(() => {
    if (!pendingDrillId || !regionData) return;

    drillDownRegion(pendingDrillId, regionData);

    const region = regionData[pendingDrillId];
    const name = region?.name || pendingDrillId;

    setDrillStack([
      {
        regionId: pendingDrillId,
        name,
        rgb: region?.rgb ?? "128,128,128",
      },
    ]);
    setPendingDrillId(null);
  }, [pendingDrillId, regionData, drillDownRegion]);

  /**
   * The quarter-scale province id grid every chronicle paint reads. Held in
   * state, not a ref, precisely so the paint effects below re-run when it
   * lands: a ref write cannot wake an effect, and the phase 2 version of this
   * left the canvas blank whenever the grid resolved after the data did.
   *
   * Only fetched for a stored day. The live map still gets its borders and its
   * pick image as server-rendered PNGs and must not pay ~95 KB for this.
   */
  const [chronicleGrid, setChronicleGrid] = useState<ProvinceIdGrid | null>(
    null
  );

  useEffect(() => {
    if (day === null) {
      setChronicleGrid(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void fetchProvinceIdGridQ4(mapId, authToken, controller.signal)
      .then((grid) => {
        if (!cancelled) setChronicleGrid(grid);
      })
      .catch((err) => {
        if (cancelled || controller.signal.aborted) return;
        console.error("Failed to load chronicle province grid:", err);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `day` only gates the fetch: the grid is geometry, shared by every day.
  }, [mapId, authToken, day]);

  const mapCanvasMounted =
    !loading && geometryReady;

  // Pick pixels are read from the hidden canvas inside MapCanvas. That node
  // does not exist until loading/geometry finish, so this effect must wait
  // for mapCanvasMounted or it draws once into a null ref and never retries.
  useEffect(() => {
    if (!accessChecked || gateReason || !mapCanvasMounted) {
      return;
    }

    let blobUrl: string | null = null;
    let cancelled = false;
    let retryId = 0;
    let retries = 0;

    const drawImage = async () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        if (retries++ > 60) return;
        retryId = requestAnimationFrame(() => {
          if (!cancelled) void drawImage();
        });
        return;
      }
      // getImageData runs per hover frame; keep the backing store CPU-side.
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      const path = `/${mapId}/mapdata/${mapType}`;
      let src = mapApiUrl(path);
      if (mapRequiresAuth(mapId, maps) && authToken) {
        try {
          src = await fetchMapBlobUrl(path, authToken);
          blobUrl = src;
        } catch (err) {
          console.error("Failed to load pick map image:", err);
          return;
        }
      }

      if (cancelled) {
        revokeMapBlobUrl(blobUrl);
        return;
      }

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      img.onload = () => {
        if (cancelled) return;
        // Resizing re-allocates the (6400x6400 => ~164MB) backing store, so
        // only touch the dimensions when the pick image actually changed size.
        if (canvas.width !== img.width || canvas.height !== img.height) {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.onerror = () => {
        console.error("Failed to load pick map image:", src);
      };
    };

    setCursorTooltip(null);
    setDrillStack([]);
    setHoveredOverlay(null);
    setHoveredFortZoc(null);
    setRegionInfo(null);
    setModalOpen(false);
    setModalRegionInfo(null);
    // `/mapdata/` is regenerated from today's data and has no per-day variant,
    // so a stored day must not download it — the effect below paints the pick
    // canvas from that day's own ownership instead.
    if (day === null) void drawImage();

    return () => {
      cancelled = true;
      cancelAnimationFrame(retryId);
      revokeMapBlobUrl(blobUrl);
    };
  }, [
    mapId,
    mapType,
    accessChecked,
    gateReason,
    authToken,
    maps,
    mapCanvasMounted,
    day,
  ]);

  /**
   * Chronicle mode's pick canvas.
   *
   * Painted from `directOwnership` — every region in its *own* colour over its
   * *own* provinces — because that is what `/mapdata/{mode}` is: coloured by
   * direct owner, which is why `getHoverRegion` walks up the `overlord` chain
   * to find a visible ancestor. Since `useMapHover`'s `rgbToId` is built from
   * the same day's `regionData`, this makes hover, click, nation details and
   * drill-down day-correct with no change to any hover code.
   *
   * The canvas is 1600x1600 here rather than the live 6400x6400, so a pick can
   * disagree with the drawn border by up to 4 map pixels at the very edge of a
   * nation. That is the same 16x memory trade `ChronicleOwnershipLayer` makes,
   * and the two layers agree with each other because they read the same grid.
   */
  useEffect(() => {
    if (day === null) return;
    if (!accessChecked || gateReason || !mapCanvasMounted) return;
    if (!chronicleGrid || !regionData) return;

    let cancelled = false;
    let retryId = 0;
    let retries = 0;

    const paintPickCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        // Same wait as the live path: the node lives inside MapCanvas and is
        // not attached on this effect's first run.
        if (retries++ > 60) return;
        retryId = requestAnimationFrame(() => {
          if (!cancelled) paintPickCanvas();
        });
        return;
      }

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      if (
        canvas.width !== chronicleGrid.width ||
        canvas.height !== chronicleGrid.height
      ) {
        canvas.width = chronicleGrid.width;
        canvas.height = chronicleGrid.height;
      }

      const imageData = ctx.createImageData(
        chronicleGrid.width,
        chronicleGrid.height
      );
      paintChronicleFrameToImageData(
        imageData,
        chronicleGrid,
        buildNationColorLut(directOwnership(regionData))
      );
      ctx.putImageData(imageData, 0, 0);
    };

    paintPickCanvas();

    return () => {
      cancelled = true;
      cancelAnimationFrame(retryId);
    };
  }, [
    day,
    accessChecked,
    gateReason,
    mapCanvasMounted,
    chronicleGrid,
    regionData,
  ]);

  const { onMouseMove, onMouseLeave: onHoverLeave, isHoveringClickable, pickRegionAtEvent } = useMapHover({
    mapId,
    mapType,
    loading,
    regionData,
    canvasRef,
    viewportCoordsRef,
    guildNameCacheRef,
    sessionToken: authToken,
    setCursorTooltip,
    setHoveredOverlay,
    setHoveredFortZoc,
    setRegionInfo,
    setSelectedRegionId,
    getHoverRegion,
    mapDisplayName: displayName,
    mapObjects,
    markers: mapMarkers,
    forts,
    setHoveredMarkerId,
    day,
    chronicleGrid,
  });

  // Paint mode owns left-click and pointer tracking; the pick canvas is
  // pointer-events-none while it is on, but guard here too so no stale hover
  // state survives the switch.
  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (paint.enabled) return;
    onMouseMove(event);
  };

  useEffect(() => {
    if (!paint.enabled) return;
    onHoverLeave();
    setHoveredMarkerId(null);
    setCursorTooltip(null);
    setHoveredOverlay(null);
    setHoveredFortZoc(null);
    setRegionInfo(null);
    lastProvinceIdRef.current = null;
    // onHoverLeave is stable enough for this one-shot cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint.enabled]);

  function handleMapTypeChange(mode: MapMode) {
    // Re-selecting the active mode would clear the map objects without the
    // mode-data effect re-running to repaint them.
    if (mode === mapType) return;
    resetMapObjects();
    setMapType(mode);
  }

  function handleResetDrill() {
    setDrillStack([]);
    if (regionData) resetDrillVisibility(regionData);
  }

  function handleDrillToLayer(index: number) {
    if (!regionData || index < 0 || index >= drillStack.length) return;

    const nextStack = drillStack.slice(0, index + 1);
    applyDrillStack(
      nextStack,
      regionData,
      resetDrillVisibility,
      drillDownRegion
    );
    setDrillStack(nextStack);
  }

  const handleDrill = (regionId: string) => {
    if (!regionData) return;

    const nextTargetId = getNextDrillTarget(
      regionId,
      regionData,
      drillStack
    );
    if (!nextTargetId) return;

    const region = regionData[nextTargetId];
    if (!region?.subjects?.length) return;

    const ancestry = getAncestryChain(regionId, regionData);
    const stackNames = drillStackNames(drillStack);
    const isInsideStack = ancestry.some((id) =>
      stackNames.includes(regionData[id]?.name ?? "")
    );

    if (!isInsideStack) {
      setDrillStack([]);
      resetDrillVisibility(regionData);
      setPendingDrillId(nextTargetId);
      return;
    }

    drillDownRegion(nextTargetId, regionData);

    const layer: DrillLayer = {
      regionId: nextTargetId,
      name: region.name || nextTargetId,
      rgb: region.rgb ?? "128,128,128",
    };
    setDrillStack((prev) =>
      prev.some((entry) => entry.regionId === layer.regionId)
        ? prev
        : [...prev, layer]
    );
  };

  const handleMapClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (paint.enabled) return;
    if (event.button !== 0) return;
    if (!regionData) return;

    const regionId = pickRegionAtEvent(event);
    if (!regionId) return;

    if (event.ctrlKey || event.metaKey) {
      handleDrill(regionId);
      return;
    }

    const region = regionData[regionId];
    if (!region) return;

    setModalRegionInfo(
      buildRegionInfo(
        regionId,
        region,
        mapType,
        displayName,
        regionData
      )
    );
    setModalOpen(true);
  };

  const handleMouseLeave = () => {
    onHoverLeave();
    setHoveredMarkerId(null);
    setCursorTooltip(null);
    setHoveredOverlay(null);
    setHoveredFortZoc(null);
    setRegionInfo(null);
    setSelectedRegionId(null);
    lastProvinceIdRef.current = null;
  };

  if (!accessChecked) {
    return (
      <div className="flex min-h-[calc(100dvh-var(--tfmc-header-h))] items-center justify-center bg-[var(--tfmc-forest-deep)]">
        <p className="text-lg font-medium text-[var(--tfmc-cream)]">
          Loading map…
        </p>
      </div>
    );
  }

  if (gateReason || accessError || provincePaint.accessError) {
    return (
      <MapAccessGate
        reason={
          gateReason ?? accessError ?? provincePaint.accessError ?? "unknown"
        }
        mapDisplayName={displayName}
      />
    );
  }

  /**
   * The toolbar now offers every mode on a stored day, so this is no longer a
   * belt-and-braces guard for an unreachable option: it is the answer for any
   * mode that is neither classified as static nor present in
   * `CHRONICLE_MODE_SOURCE` — a future mode nobody has classified yet, or a
   * bookmarked URL from before one was. `notCapturedForDay` is only ever set
   * from `MapModeNotCapturedError`, which `mapModeDataSource` only throws for
   * a non-null day, so this branch is unreachable on the live map.
   */
  if (notCapturedForDay) {
    return (
      <div className="flex min-h-[calc(100dvh-var(--tfmc-header-h))] flex-col items-center justify-center gap-3 bg-[var(--tfmc-forest-deep)] px-6 text-center">
        <p className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
          Not recorded for {day}
        </p>
        <p className="max-w-md text-sm leading-snug text-[var(--tfmc-stone)]">
          Nothing in this day&rsquo;s capture answers for this map mode, and it
          is not one of the modes that stays the same on every day, so showing
          today&rsquo;s would be a lie about the past.
        </p>
        <button
          type="button"
          onClick={() => handleMapTypeChange("nation")}
          className={editTitlesLinkClass}
        >
          Back to the nation map
        </button>
      </div>
    );
  }

  /**
   * The mode *is* captured for chronicle days, but this day's snapshot is
   * missing that source file. Kept separate from `notCapturedForDay` above
   * because the fact differs: nothing was ever recorded there, whereas here
   * the recording exists and lost a piece. Falling through to the map instead
   * would render bare terrain with no nations under a banner asserting a real
   * date — an empty world that reads as a real historical state.
   */
  /**
   * Either the region source for this mode is missing from the day, or (for
   * `prosperity`/`infestation`) the raster source is. `main` has no
   * `infestation_data.json` at all, so that mode lands here on every day —
   * which is the honest answer, not an error.
   */
  if (dayFileMissing || provincePaint.dayFileMissing) {
    return (
      <div className="flex min-h-[calc(100dvh-var(--tfmc-header-h))] flex-col items-center justify-center gap-3 bg-[var(--tfmc-forest-deep)] px-6 text-center">
        <p className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
          Missing from the {day} capture
        </p>
        <p className="max-w-md text-sm leading-snug text-[var(--tfmc-stone)]">
          This day was recorded, but the file behind this map mode is not in
          its snapshot. Nothing is shown rather than an empty world under a
          real date. Another mode, or a nearby day, may still have it.
        </p>
        <button
          type="button"
          onClick={() => handleMapTypeChange("nation")}
          className={editTitlesLinkClass}
        >
          Back to the nation map
        </button>
      </div>
    );
  }

  // Do not render the map until region data is in hand. Mounting MapCanvas
  // early (to start the base-map download sooner) meant the region overlays
  // rendered before regionData settled, and a failed overlay request is made
  // permanent by MapCanvas's onError handler setting display:none — borders
  // then stay invisible until something forces a remount.
  if (!mapCanvasMounted) {
    return (
      <div className="flex min-h-[calc(100dvh-var(--tfmc-header-h))] items-center justify-center bg-[var(--tfmc-forest-deep)]">
        <p className="text-lg font-medium text-[var(--tfmc-cream)]">
          Loading map…
        </p>
      </div>
    );
  }

  return (
    <>
      <MapPageLayout
        mapDisplayName={displayName}
        headerAction={
          chronicle ? null : (
            <div className="flex shrink-0 flex-col items-start gap-2">
              {isArchivedMap(mapId, maps) ? (
                <div className="flex shrink-0 flex-wrap items-center justify-start gap-2">
                  <Link href={liveMapHref("main")} className={reviewHistoryLinkClass}>
                    Live map
                  </Link>
                  {showReviewHistory(mapId, maps) ? (
                    <ReviewHistoryLink mapId={mapId} />
                  ) : null}
                </div>
              ) : (
                <div className="flex shrink-0 flex-wrap items-center justify-start gap-2">
                  {/* Shown to everyone, and shown even when this map has captured
                      no days yet — the studio says so itself, which is a better
                      answer than an entry point that silently is not there. Costs
                      no request: the live map must not pay for the chronicle. */}
                  <ReviewHistoryLink mapId={mapId} />
                  <MapArchiveMenu maps={maps} linkClass={reviewHistoryLinkClass} />
                </div>
              )}
              {/* The editor writes to the *live* map. Reaching it from a stored
                  day would invite editing today's titles while looking at last
                  year's — hence the whole block being hidden in chronicle mode. */}
              {canEdit && !canEditLoading ? (
                <Link href={editorUrl(mapId)} className={editTitlesLinkClass}>
                  Edit titles
                </Link>
              ) : null}
            </div>
          )
        }
        mapModeSelectorMobile={
          <MapToolbar
            mapId={mapId}
            mapType={mapType}
            onMapTypeChange={handleMapTypeChange}
            variant="bar"
          />
        }
        mapModeSelectorDesktop={
          <MapToolbar
            mapId={mapId}
            mapType={mapType}
            onMapTypeChange={handleMapTypeChange}
            variant="sidebar"
          />
        }
        drillStackBar={
          <MapDrillStackBar
            drillStack={drillStack}
            onSelectLayer={handleDrillToLayer}
            onResetDrill={handleResetDrill}
          />
        }
        desktopSidePanel={
          <MapDesktopSidePanel
            mapId={mapId}
            mapType={mapType}
            regionInfo={regionInfo}
            regionData={regionData}
            sessionToken={authToken}
          />
        }
        fitModeToggle={
          <div className="flex items-center gap-1.5">
            <span className={fitModeLabelClass(fitMode === "cover")}>Width</span>
            <button
              type="button"
              role="switch"
              aria-checked={fitMode === "contain"}
              aria-label="Toggle between filling the width and fitting the height"
              onClick={() =>
                setFitMode((mode) => (mode === "cover" ? "contain" : "cover"))
              }
              className="relative h-4 w-8 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--tfmc-forest)_60%,transparent)] transition-colors"
            >
              <span
                className="absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-[var(--tfmc-cream)]"
                style={{
                  transform: `translateX(${fitMode === "contain" ? 16 : 0}px)`,
                  transition: "transform 150ms ease",
                }}
              />
            </button>
            <span className={fitModeLabelClass(fitMode === "contain")}>Height</span>
          </div>
        }
        paintPanel={chronicle ? null : <PaintToolbar paint={paint} />}
      >
        <MapCanvas
          mapId={mapId}
          mapType={mapType}
          sessionToken={authToken}
          canvasRef={canvasRef}
          viewportCoordsRef={viewportCoordsRef}
          mapObjects={mapObjects}
          hoveredOverlay={hoveredOverlay}
          hoveredFortZoc={hoveredFortZoc}
          cursorTooltip={cursorTooltip}
          labels={regionLabels}
          markers={mapMarkers}
          wars={wars}
          centroids={centroids}
          hoveredMarkerId={hoveredMarkerId}
          hoveredNationId={selectedRegionId}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleMapClick}
          isHoveringClickable={isHoveringClickable}
          fill
          fitMode={fitMode}
          day={day}
          paint={chronicle ? undefined : paint}
          provinceOverlay={
            usesChronicleProvincePaint(mapType, day) ? (
              <ChronicleProvincePaintLayer
                grid={chronicleGrid}
                lut={provincePaint.lut}
              />
            ) : undefined
          }
          regionOverlay={
            chronicle ? (
              <ChronicleOwnershipLayer
                grid={chronicleGrid}
                regionData={regionData}
                mapObjects={mapObjects}
                // `selectedRegionId` is the region the pick canvas resolved,
                // but it is not cleared on a miss — `hoveredOverlay` is, and it
                // is set from the same resolution, so it is the honest gate for
                // "is something hovered right now".
                hoveredRegionId={hoveredOverlay ? selectedRegionId : null}
                mapW={mapFallbackSize(mapId)}
                mapH={mapFallbackSize(mapId)}
              />
            ) : undefined
          }
        />
      </MapPageLayout>

      <NationDetailModal
        open={modalOpen}
        mapId={mapId}
        mapType={mapType}
        regionInfo={modalRegionInfo}
        regionData={regionData}
        sessionToken={authToken}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
};

export default MapViewer;
