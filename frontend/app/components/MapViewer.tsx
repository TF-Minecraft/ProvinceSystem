"use client";

import { useCallback, useState, useEffect, useRef, useMemo } from "react";
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
import { addInstallationLinkDetails } from "../lib/supplyLinks";
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
import MapCanvas, { type MapViewportControls } from "./map/MapCanvas";
import PaintToolbar from "./map/PaintToolbar";
import { mapModeLabel } from "./map/mapModes";
import MapShell from "./map/shell/MapShell";
import MapPlaque from "./map/shell/MapPlaque";
import MapSearch from "./map/shell/MapSearch";
import { MapModeBar, MapModeChips } from "./map/shell/MapModeBar";
import MapZoomControls from "./map/shell/MapZoomControls";
import MapLayersMenu, { type MapLayerToggle } from "./map/shell/MapLayersMenu";
import MapDrillBreadcrumb from "./map/shell/MapDrillBreadcrumb";
import { RealmPanelContent } from "./map/shell/RealmPanel";
import { PlacePanelContent } from "./map/shell/PlacePanel";
import { GuildPanelContent } from "./map/shell/GuildPanel";
import {
  allGuilds,
  findGuild,
  guildKeyForId,
  guildSeat,
} from "@/app/lib/map/guildProfile";
import { buildPlaceProfile, placeMarkerIdForSearchKey } from "@/app/lib/map/placeProfile";
import { HistoryIcon } from "./map/shell/MapIcons";
import type {
  CursorTooltip,
  HoverOverlay,
  MapId,
  MapMode,
  RegionInfo,
  RegionRecord,
} from "./map/types";
import { mapFallbackSize, mapDisplayName } from "./map/types";
import { buildMapSearchIndex, type MapSearchEntry } from "@/app/lib/map/mapSearch";
import type { MapFocusInset } from "../hooks/useMapViewport";
import type { MapRect } from "../lib/mapViewportMath";
import { isTypingTarget } from "../lib/mapGestures";
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

const actionLinkClass = "map-control h-9 px-2.5 text-xs no-underline";

/**
 * The chronicle is the one feature nothing else on the map hints at, so it
 * keeps its own button on the name plate rather than hiding in the Layers
 * menu. Without it a viewer has no way to discover the map has any history.
 */
function ReviewHistoryLink({ mapId }: { mapId: MapId }) {
  return (
    <Link
      href={chronicleStudioHref(mapId)}
      className={actionLinkClass}
      title="Review the map's history"
    >
      <HistoryIcon size={15} className="text-[var(--tfmc-stone)]" />
      History
    </Link>
  );
}

/** Modes whose tooltip describes the province under the pointer. */
const PROVINCE_TOOLTIP_MODES = new Set<MapMode>([
  "trade",
  "prosperity",
  "terrain",
  "fertility",
  "infestation",
  "province",
]);

/**
 * Desktop opens on the whole world. A phone held upright would show that as a
 * small square with the screen empty below it, so there the map fills the
 * screen top to bottom instead and the sides are a drag away.
 */
function useResponsiveFitMode(): FitMode {
  const [fitMode, setFitMode] = useState<FitMode>("contain");
  useEffect(() => {
    const query = window.matchMedia("(max-width: 47.99rem)");
    const apply = () => setFitMode(query.matches ? "cover" : "contain");
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return fitMode;
}

/** Room the desktop details panel and mode tray take from a "zoom to". */
const DESKTOP_FOCUS_INSET: MapFocusInset = { left: 400, bottom: 110, top: 16, right: 80 };

function focusInset(): MapFocusInset {
  if (typeof window === "undefined") return {};
  if (window.matchMedia("(min-width: 48rem)").matches) return DESKTOP_FOCUS_INSET;
  // Phone: search and chips above, the details sheet below.
  return { top: 150, bottom: Math.round(window.innerHeight * 0.45) };
}

/** Hover feeds a details card that no longer exists; selection replaced it. */
const ignoreHoverRegionInfo = (_info: RegionInfo | null) => {};

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
  const fitMode = useResponsiveFitMode();
  const [installationsVisible, setInstallationsVisible] = useState(true);
  const [supplyLinksVisible, setSupplyLinksVisible] = useState(true);
  const [hoveredOverlay, setHoveredOverlay] = useState<HoverOverlay | null>(
    null
  );
  const [hoveredFortZoc, setHoveredFortZoc] = useState<HoverOverlay | null>(
    null
  );
  /** The region under the pointer. Cleared as soon as the pointer leaves it. */
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  /**
   * The region whose details are open. Separate from hover on purpose: it
   * survives the pointer moving on, and only an explicit choice (another
   * click, a link in the panel, search, Escape, a mode change) replaces it.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** A clicked marker (settlement, installation, battle); exclusive with `selectedId`. */
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  /** A guild's card, `factionId/guildId`; exclusive with the two above. */
  const [selectedGuildKey, setSelectedGuildKey] = useState<string | null>(null);
  /** One card at a time: whatever opens clears the rest. */
  const select = useCallback(
    (next: { region?: string; place?: string; guild?: string } = {}) => {
      setSelectedId(next.region ?? null);
      setSelectedPlaceId(next.place ?? null);
      setSelectedGuildKey(next.guild ?? null);
    },
    []
  );
  const [drillStack, setDrillStack] = useState<DrillLayer[]>([]);
  const [pendingDrillId, setPendingDrillId] = useState<string | null>(null);
  const [cursorTooltip, setCursorTooltip] = useState<CursorTooltip | null>(
    null
  );
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportControlsRef = useRef<MapViewportControls | null>(null);
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
   * Guilds are described in the realm data (`/data/nation`), which only the
   * realm map loads. Other modes that show guilds (the Guilds map, a guild
   * card opened from search) read it from here, fetched once per map.
   */
  const [guildRealmData, setGuildRealmData] = useState<{
    mapId: MapId;
    data: RegionRecord;
  } | null>(null);
  const needsGuildRealmData = day === null && mapType !== "nation";
  useEffect(() => {
    if (!needsGuildRealmData || guildRealmData?.mapId === mapId) return;
    let cancelled = false;
    void fetchMapJson<RegionRecord>(`/${mapId}/data/nation`, { sessionToken: authToken })
      .then((data) => {
        if (!cancelled) setGuildRealmData({ mapId, data });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [needsGuildRealmData, guildRealmData, mapId, authToken]);
  const guildData: RegionRecord | null =
    mapType === "nation"
      ? regionData
      : guildRealmData?.mapId === mapId
        ? guildRealmData.data
        : null;

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
  const {
    settlements,
    installations,
    forts,
    wars,
    hubLinks,
  } = useMapMarkers(mapId, authToken, markersEnabled, day);

  const mapMarkers = useMemo(() => {
    if (!isMarkerMapMode(mapType)) return [];
    const battleMarkers = warBattleMarkersFromWars(wars);
    // Provinces a guild (not a realm's own) is based in: their settlements
    // are guild seats.
    const guildSeatProvinces = new Set(
      allGuilds(regionData)
        .map((guild) => guild.homeProvince)
        .filter((province): province is number => province !== null)
    );
    return [
      ...settlements.map((settlement) => {
        const kind = visibleSettlementKind(
          settlement.kind,
          settlement.faction_id,
          mapObjects
        );
        // Sized by what the place is, not how many live there: a big
        // village no longer outshouts a small capital.
        const markerSize =
          kind === "faction_capital"
            ? "large"
            : kind === "guild_capital" ||
                (typeof settlement.province_id === "number" &&
                  guildSeatProvinces.has(settlement.province_id))
              ? "medium"
              : "small";
        return {
          ...settlementToMapMarker({ ...settlement, kind }),
          markerSize,
          weight: settlement.population ?? 0,
        } as const;
      }),
      ...(installationsVisible
        ? installations.map((installation) =>
            addInstallationLinkDetails(
              installationToMapMarker(installation),
              installation,
              hubLinks
            )
          )
        : []),
      ...battleMarkers,
    ];
  }, [
    settlements,
    installations,
    wars,
    hubLinks,
    installationsVisible,
    mapType,
    mapObjects,
    regionData,
  ]);

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

  /**
   * The same quarter-scale province grid on the live map, for the modes whose
   * tooltip describes the province under the pointer. Hover then reads the id
   * locally instead of asking the server on every mouse move, which made the
   * trade tooltip flicker between the region and the province as answers
   * landed. Fetched on first use and kept for the map.
   */
  const [liveProvinceGrid, setLiveProvinceGrid] = useState<{
    mapId: MapId;
    grid: ProvinceIdGrid;
  } | null>(null);
  const needsProvinceGrid = day === null && PROVINCE_TOOLTIP_MODES.has(mapType);
  useEffect(() => {
    if (!needsProvinceGrid || liveProvinceGrid?.mapId === mapId) return;
    const controller = new AbortController();
    void fetchProvinceIdGridQ4(mapId, authToken, controller.signal)
      .then((grid) => setLiveProvinceGrid({ mapId, grid }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error("Failed to load province grid:", err);
        }
      });
    return () => controller.abort();
  }, [needsProvinceGrid, liveProvinceGrid, mapId, authToken]);
  const hoverProvinceGrid =
    chronicleGrid ?? (liveProvinceGrid?.mapId === mapId ? liveProvinceGrid.grid : null);

  const mapCanvasMounted =
    !loading && geometryReady;

  /**
   * Once a map has been shown it stays on screen. Switching mode only swaps
   * its overlays: `useMapModeData` empties the region data while the next
   * mode loads, so nothing stale is drawn meanwhile, and the camera keeps its
   * place. Only the first load of a map waits behind "Loading map…".
   */
  const [mapShownFor, setMapShownFor] = useState<MapId | null>(null);
  useEffect(() => {
    if (mapCanvasMounted) setMapShownFor(mapId);
  }, [mapCanvasMounted, mapId]);
  const mapShown = mapCanvasMounted || mapShownFor === mapId;

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
    setSelectedId(null);
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

  const {
    onMouseMove,
    onMouseLeave: onHoverLeave,
    isHoveringClickable,
    pickRegionAtEvent,
    pickMarkerAtEvent,
  } = useMapHover({
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
    setRegionInfo: ignoreHoverRegionInfo,
    setSelectedRegionId: setHoveredRegionId,
    getHoverRegion,
    mapDisplayName: displayName,
    mapObjects,
    markers: mapMarkers,
    forts,
    setHoveredMarkerId,
    day,
    chronicleGrid: hoverProvinceGrid,
  });

  // Paint mode owns left-click and pointer tracking; the pick canvas is
  // pointer-events-none while it is on, but guard here too so no stale hover
  // state survives the switch.
  const handleCanvasMouseMove = (event: React.MouseEvent<Element>) => {
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
    lastProvinceIdRef.current = null;
    // onHoverLeave is stable enough for this one-shot cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint.enabled]);

  function handleMapTypeChange(mode: MapMode) {
    // Re-selecting the active mode would clear the map objects without the
    // mode-data effect re-running to repaint them.
    if (mode === mapType) return;
    resetMapObjects();
    select();
    // The map stays mounted across modes, so hover from the old mode has to
    // be cleared here rather than by a remount.
    setHoveredOverlay(null);
    setHoveredFortZoc(null);
    setCursorTooltip(null);
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

  const handleMapClick = (event: React.MouseEvent<Element>) => {
    if (paint.enabled) return;
    if (event.button !== 0) return;
    if (!regionData) return;

    // Pins sit above the land: a click on one opens its place card.
    const marker = event.ctrlKey || event.metaKey ? null : pickMarkerAtEvent(event);
    if (marker) {
      select({ place: marker.id });
      return;
    }

    const regionId = pickRegionAtEvent(event);
    if (!regionId) {
      // Clicking open sea or unclaimed land puts the details away, as on any
      // map site; Ctrl-click there is still a no-op.
      if (!event.ctrlKey && !event.metaKey) {
        select();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      handleDrill(regionId);
      return;
    }

    if (!regionData[regionId]) return;
    // The Guilds map's areas are keyed by the guild that dominates them.
    const guildKey = mapType === "trade" ? guildKeyForId(guildData, regionId) : null;
    if (guildKey) {
      select({ guild: guildKey });
      return;
    }
    select({ region: regionId });
  };

  const handleMouseLeave = () => {
    onHoverLeave();
    setHoveredMarkerId(null);
    setCursorTooltip(null);
    setHoveredOverlay(null);
    setHoveredFortZoc(null);
    setHoveredRegionId(null);
    lastProvinceIdRef.current = null;
  };

  /**
   * Open the subject layers above `regionId` so it is drawn as itself rather
   * than inside its overlord's colour. Needed when a panel link or search
   * picks a subject that the current drill state hides.
   */
  const revealRegion = useCallback(
    (regionId: string) => {
      if (!regionData) return;
      const ownObject = mapObjects.find(
        (obj) => !obj.nested && obj.baseId === regionId
      );
      if (!ownObject || ownObject.visible) return;

      const ancestors = getAncestryChain(regionId, regionData).slice(1).reverse();
      if (ancestors.length === 0) return;
      const stack: DrillLayer[] = ancestors.map((id) => ({
        regionId: id,
        name: regionData[id]?.name || id,
        rgb: regionData[id]?.rgb ?? "128,128,128",
      }));
      applyDrillStack(stack, regionData, resetDrillVisibility, drillDownRegion);
      setDrillStack(stack);
    },
    [regionData, mapObjects, resetDrillVisibility, drillDownRegion]
  );

  /** Open `regionId`'s own subject layer, and every layer above it. */
  const openSubjects = useCallback(
    (regionId: string) => {
      if (!regionData?.[regionId]?.subjects?.length) return;
      const stack: DrillLayer[] = getAncestryChain(regionId, regionData)
        .reverse()
        .map((id) => ({
          regionId: id,
          name: regionData[id]?.name || id,
          rgb: regionData[id]?.rgb ?? "128,128,128",
        }));
      applyDrillStack(stack, regionData, resetDrillVisibility, drillDownRegion);
      setDrillStack(stack);
    },
    [regionData, resetDrillVisibility, drillDownRegion]
  );

  const focusRect = useCallback((rect: MapRect) => {
    viewportControlsRef.current?.focusMapRect(rect, focusInset());
  }, []);

  const focusRegion = useCallback(
    (regionId: string) => {
      const box = regionData?.[regionId]?.overlay;
      if (box) focusRect(box);
    },
    [regionData, focusRect]
  );

  const focusPoint = useCallback(
    (mapX: number, mapY: number) => {
      focusRect({ x: mapX - 80, y: mapY - 80, w: 160, h: 160 });
    },
    [focusRect]
  );

  /** A panel link or search result: show it, select it, frame it. */
  const selectRegion = useCallback(
    (regionId: string, options: { focus?: boolean } = {}) => {
      if (!regionData?.[regionId]) return;
      const guildKey = mapType === "trade" ? guildKeyForId(guildData, regionId) : null;
      if (guildKey) {
        select({ guild: guildKey });
      } else {
        revealRegion(regionId);
        select({ region: regionId });
      }
      if (options.focus ?? true) focusRegion(regionId);
    },
    [regionData, revealRegion, focusRegion, mapType, guildData, select]
  );

  /**
   * A realm, from a guild card or a place card in any mode: the realm card
   * only exists on the realm map, so switch to it first and open the realm
   * once its data has loaded.
   */
  const [pendingRealmId, setPendingRealmId] = useState<string | null>(null);
  const openRealm = useCallback(
    (regionId: string) => {
      if (mapType === "nation") {
        selectRegion(regionId);
        return;
      }
      setPendingRealmId(regionId);
      handleMapTypeChange("nation");
    },
    // handleMapTypeChange is redefined each render but only reads current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapType, selectRegion]
  );
  useEffect(() => {
    if (!pendingRealmId || mapType !== "nation" || !regionData?.[pendingRealmId]) return;
    selectRegion(pendingRealmId);
    setPendingRealmId(null);
  }, [pendingRealmId, mapType, regionData, selectRegion]);

  const searchEntries = useMemo(
    () =>
      buildMapSearchIndex({
        regionData,
        tierLabel: mapModeLabel(mapType),
        settlements,
        installations,
      }),
    [regionData, mapType, settlements, installations]
  );

  const handleSearchSelect = useCallback(
    (entry: MapSearchEntry) => {
      if (entry.kind === "region") {
        selectRegion(entry.regionId);
      } else if (entry.kind === "guild") {
        select({ guild: entry.guildKey });
        const guild = findGuild(guildData, entry.guildKey);
        const seat = guild ? guildSeat(guild, settlements) : null;
        if (seat && typeof seat.map_x === "number" && typeof seat.map_y === "number") {
          focusPoint(seat.map_x, seat.map_y);
        }
      } else {
        const markerId = placeMarkerIdForSearchKey(entry.key);
        if (markerId) {
          select({ place: markerId });
        }
        focusPoint(entry.mapX, entry.mapY);
      }
    },
    [selectRegion, focusPoint]
  );

  /**
   * The selected region's `_hover` crop, kept lit under the details panel.
   * Resolved like hover is, through the visible ancestor, so a subject inside
   * a closed realm lights its overlord until its layer is opened.
   */
  const selectedOverlay = useMemo<HoverOverlay | null>(() => {
    if (chronicle || !selectedId || !regionData?.[selectedId]) return null;
    const target = getHoverRegion(mapType, mapId, selectedId, regionData);
    return target.imagePath
      ? { url: target.imagePath, overlay: target.overlay }
      : null;
    // mapObjects: the visible ancestor changes when layers open and close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chronicle, selectedId, regionData, getHoverRegion, mapType, mapId, mapObjects]);

  // Escape puts the details away, unless it is closing something in a field.
  useEffect(() => {
    if (!selectedId && !selectedPlaceId && !selectedGuildKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isTypingTarget(event.target)) return;
      select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, selectedPlaceId, selectedGuildKey, select]);

  const selectedMarker = useMemo(
    () => (selectedPlaceId ? mapMarkers.find((m) => m.id === selectedPlaceId) ?? null : null),
    [selectedPlaceId, mapMarkers]
  );
  // A pin that is no longer drawn (another mode, a stored day without it)
  // closes its card.
  useEffect(() => {
    if (selectedPlaceId && mapMarkers.length > 0 && !selectedMarker) setSelectedPlaceId(null);
  }, [selectedPlaceId, selectedMarker, mapMarkers.length]);
  const selectedPlace = useMemo(
    () =>
      selectedMarker
        ? buildPlaceProfile(selectedMarker, settlements, installations, regionData)
        : null,
    [selectedMarker, settlements, installations, regionData]
  );

  const selectedGuild = useMemo(
    () => (selectedGuildKey ? findGuild(guildData, selectedGuildKey) : null),
    [selectedGuildKey, guildData]
  );
  useEffect(() => {
    if (selectedGuildKey && guildData && !selectedGuild) setSelectedGuildKey(null);
  }, [selectedGuildKey, guildData, selectedGuild]);

  // A selection the current data no longer has (a stored day without that
  // realm, a mode reload) closes rather than showing an empty panel.
  useEffect(() => {
    if (selectedId && regionData && !regionData[selectedId]) setSelectedId(null);
  }, [selectedId, regionData]);

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
          className={actionLinkClass}
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
          className={actionLinkClass}
        >
          Back to the nation map
        </button>
      </div>
    );
  }

  // Do not render the map until region data is first in hand. Mounting
  // MapCanvas early (to start the base-map download sooner) meant the region
  // overlays rendered before regionData settled, and a failed overlay request
  // is made permanent by MapCanvas's onError handler setting display:none —
  // borders then stay invisible until something forces a remount. Later mode
  // changes are safe: overlays are keyed by mode, and the list is empty until
  // the new mode's data lands.
  if (!mapShown) {
    return (
      <div className="flex min-h-[calc(100dvh-var(--tfmc-header-h))] items-center justify-center bg-[var(--tfmc-forest-deep)]">
        <p className="text-lg font-medium text-[var(--tfmc-cream)]">
          Loading map…
        </p>
      </div>
    );
  }

  const archived = isArchivedMap(mapId, maps);
  const markerLayers = day === null && isMarkerMapMode(mapType);
  const layerToggles: MapLayerToggle[] = [];
  if (markerLayers) {
    layerToggles.push(
      {
        id: "installations",
        label: "Installations",
        hint: "Forts, ports, airfields and stations",
        checked: installationsVisible,
        onChange: setInstallationsVisible,
      },
      {
        id: "supply-links",
        label: "Supply links",
        hint: "Trade routes between supply hubs",
        checked: supplyLinksVisible,
        onChange: setSupplyLinksVisible,
      }
    );
  }
  const desktopLayerToggles: MapLayerToggle[] = chronicle
    ? layerToggles
    : [
        ...layerToggles,
        {
          id: "paint",
          label: "War planning",
          hint: "Draw arrows, labels and objects over the map",
          checked: paint.enabled,
          onChange: paint.setEnabled,
        },
      ];

  const plaqueActions = chronicle ? null : (
    <>
      {archived ? (
        <Link href="/map" className={actionLinkClass}>
          Live map
        </Link>
      ) : null}
      {!archived || showReviewHistory(mapId, maps) ? (
        <ReviewHistoryLink mapId={mapId} />
      ) : null}
      {/* The editor writes to the *live* map. Reaching it from a stored day
          would invite editing today's titles while looking at last year's —
          hence the whole block being hidden in chronicle mode. */}
      {canEdit && !canEditLoading ? (
        <Link href={editorUrl(mapId)} className={`${actionLinkClass} max-md:hidden`}>
          Edit titles
        </Link>
      ) : null}
    </>
  );

  const archiveFooter =
    chronicle || archived ? null : (
      <div className="flex items-center justify-between gap-2 text-sm text-[var(--tfmc-stone)]">
        <span>Earlier chapters</span>
        <MapArchiveMenu maps={maps} linkClass={actionLinkClass} />
      </div>
    );

  const zoomControls = (
    <MapZoomControls
      onZoom={(factor) => viewportControlsRef.current?.zoomBy(factor)}
      onReset={() => viewportControlsRef.current?.reset()}
    />
  );

  const selectedRegion = selectedId ? regionData?.[selectedId] : undefined;
  const canShowSubjects =
    selectedId !== null &&
    regionData !== null &&
    (selectedRegion?.subjects?.length ?? 0) > 0 &&
    !drillStack.some((layer) => layer.regionId === selectedId);

  const details = selectedGuild ? (
    <GuildPanelContent
      guild={selectedGuild}
      regionData={regionData}
      seat={guildSeat(selectedGuild, settlements)}
      tradeProvinces={
        mapType === "trade" ? regionData?.[selectedGuild.id]?.size ?? null : null
      }
      onSelectRegion={openRealm}
      onSelectPlace={(markerId) => select({ place: markerId })}
      onFocusPoint={focusPoint}
      onClose={() => select()}
    />
  ) : selectedPlace && selectedMarker ? (
    <PlacePanelContent
      mapId={mapId}
      place={selectedPlace}
      marker={selectedMarker}
      regionData={regionData}
      sessionToken={authToken}
      onSelectRegion={(id) => selectRegion(id)}
      onFocusPoint={focusPoint}
      onClose={() => select()}
      onSelectGuild={(key) => select({ guild: key })}
    />
  ) : selectedId && regionData && selectedRegion ? (
      <RealmPanelContent
        mapId={mapId}
        mapType={mapType}
        regionId={selectedId}
        regionData={regionData}
        mapDisplayName={displayName}
        sessionToken={authToken}
        settlements={settlements}
        onSelectRegion={(id) => selectRegion(id)}
        onFocusPoint={focusPoint}
        onSelectPlace={(markerId) => {
          select({ place: markerId });
        }}
        onFocusRegion={
          selectedRegion.overlay ? () => focusRegion(selectedId) : undefined
        }
        onShowSubjects={
          canShowSubjects ? () => openSubjects(selectedId) : undefined
        }
        onClose={() => select()}
        onSelectGuild={(key) => select({ guild: key })}
      />
    ) : null;

  return (
    <MapShell
      chronicle={chronicle}
      plaque={
        <MapPlaque
          eyebrow={chronicle ? "Stored day" : archived ? "Archived chapter" : "World map"}
          mapDisplayName={displayName}
          actions={plaqueActions}
          search={
            <MapSearch
              entries={searchEntries}
              placeholder={`Search ${displayName}`}
              onSelect={handleSearchSelect}
            />
          }
        />
      }
      modeBar={<MapModeBar mapType={mapType} onMapTypeChange={handleMapTypeChange} />}
      modeChips={<MapModeChips mapType={mapType} onMapTypeChange={handleMapTypeChange} />}
      breadcrumb={
        drillStack.length > 0 ? (
          <MapDrillBreadcrumb
            rootLabel={mapModeLabel(mapType)}
            drillStack={drillStack}
            onSelectLayer={handleDrillToLayer}
            onReset={handleResetDrill}
          />
        ) : null
      }
      details={details}
      detailsKey={
        selectedGuildKey
          ? `guild:${selectedGuildKey}`
          : selectedPlaceId
            ? `place:${selectedPlaceId}`
            : selectedId
      }
      status={loading ? `Loading ${mapModeLabel(mapType).toLowerCase()}…` : null}
      zoomControls={zoomControls}
      layers={<MapLayersMenu toggles={desktopLayerToggles} footer={archiveFooter} />}
      layersMobile={
        layerToggles.length > 0 ? (
          <MapLayersMenu
            toggles={layerToggles}
            align="right"
            triggerClassName="h-10 px-3 text-sm"
          />
        ) : null
      }
      paintPanel={!chronicle && paint.enabled ? <PaintToolbar paint={paint} /> : null}
    >
      <MapCanvas
        mapId={mapId}
        mapType={mapType}
        sessionToken={authToken}
        canvasRef={canvasRef}
        viewportCoordsRef={viewportCoordsRef}
        controlsRef={viewportControlsRef}
        mapObjects={mapObjects}
        hoveredOverlay={hoveredOverlay}
        selectedOverlay={selectedOverlay}
        hoveredFortZoc={hoveredFortZoc}
        cursorTooltip={cursorTooltip}
        labels={regionLabels}
        markers={mapMarkers}
        wars={wars}
        hubLinks={
          day === null && installationsVisible && supplyLinksVisible
            ? hubLinks
            : []
        }
        centroids={centroids}
        hoveredMarkerId={hoveredMarkerId ?? selectedPlaceId}
        hoveredNationId={hoveredRegionId ?? selectedId}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleMapClick}
        isHoveringClickable={isHoveringClickable}
        regionsAtDefault={drillStack.length === 0}
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
              // `hoveredRegionId` is the region the pick canvas resolved, but
              // it is not cleared on a miss — `hoveredOverlay` is, and it is
              // set from the same resolution, so it is the honest gate for
              // "is something hovered right now". With nothing hovered, the
              // open details panel's region stays lit.
              hoveredRegionId={hoveredOverlay ? hoveredRegionId : selectedId}
              mapW={mapFallbackSize(mapId)}
              mapH={mapFallbackSize(mapId)}
            />
          ) : undefined
        }
      />
    </MapShell>
  );
};

export default MapViewer;
