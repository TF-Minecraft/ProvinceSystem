"use client";

import { useCallback, useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useMapEngine } from "../core/MapEngineContext";
import { useMapHover } from "../hooks/useMapHover";
import type { MapPickViewport } from "../hooks/useMapCoords";
import useMapPaint from "../hooks/useMapPaint";
import { useMapModeData } from "../hooks/useMapModeData";
import { useMapGeometry } from "../hooks/useMapGeometry";
import { useMapMarkers } from "../hooks/useMapMarkers";
import { isMarkerMapMode } from "../lib/mapMarkers";
import {
  installationToMapMarker,
} from "../lib/installationMarkers";
import { addInstallationLinkDetails } from "../lib/supplyLinks";
import {
  buildTradeEdgeGeometry,
  EMPTY_TRADE_EDGE_GEOMETRY,
} from "../lib/tradeEdges";
import { warBattleMarkersFromWars } from "../lib/warBattleMarkers";
import {
  settlementToMapMarker,
  visibleSettlementKind,
} from "../lib/settlementMarkers";
import { useGuildCache } from "../hooks/useGuildCache";
import { useTitleLayerData } from "../hooks/useTitleLayerData";
import {
  computeRegionLabelGeometrySteps,
  filterRegionLabelsForMapObjects,
  LABEL_MAP_MODES,
  type RegionLabelGeometryCache,
} from "../lib/mapLabels";
import {
  applyDrillStack,
  drillStackNames,
  getAncestryChain,
  getNextDrillTarget,
  hasLandSubjects,
  type DrillLayer,
} from "./map/drillUtils";
import MapAccessGate, {
  type MapAccessGateReason,
} from "./map/MapAccessGate";
import { provinceHoverBlocksRegionPick } from "../hooks/regionPick";
import MapCanvas, { type MapFocus, type MapViewportControls } from "./map/MapCanvas";
import PaintToolbar from "./map/PaintToolbar";
import { mapModeLabel } from "./map/mapModes";
import MapShell from "./map/shell/MapShell";
import MapPlaque from "./map/shell/MapPlaque";
import MapSearch from "./map/shell/MapSearch";
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
import { BrushIcon, FortIcon, HistoryIcon, RouteIcon } from "./map/shell/MapIcons";
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
import {
  pickSurfaceFromImage,
  pickSurfaceFromImageData,
  type PickSurface,
} from "@/app/lib/map/pickSurface";
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
  mapApiPathFromUrl,
  mapApiUrl,
  mapRequiresAuth,
  revokeMapBlobUrl,
  staffMapAccessReason,
} from "@/lib/map/api";
import { editorUrl } from "@/lib/map/editorAccess";
import { chronicleStudioHref, liveMapHref } from "@/app/lib/map/chronicleDayRoute";
import { useResponsiveFitMode } from "@/app/hooks/useResponsiveFitMode";
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
      {/* The icon alone on a phone, where the top row is the search box's. */}
      <span className="max-md:sr-only">History</span>
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

/** Room the desktop details panel, layers button and zoom take from a "zoom to". */
const DESKTOP_FOCUS_INSET: MapFocusInset = { left: 400, bottom: 24, top: 64, right: 80 };

function focusInset(): MapFocusInset {
  if (typeof window === "undefined") return {};
  if (window.matchMedia("(min-width: 48rem)").matches) return DESKTOP_FOCUS_INSET;
  // Phone: search and the layers row above, the details sheet below.
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
  /** A stored day's date and day-to-day navigation, over the plaque. */
  dayBar?: ReactNode;
  /** Beside the search on a stored day: the way back to the live map. */
  dayActions?: ReactNode;
};

/**
 * Name layouts already worked out this page view, by map, mode and the data
 * they were laid out from. A handful: one per mode a reader flips between.
 */
const labelGeometryCache = new Map<string, RegionLabelGeometryCache | null>();
const LABEL_GEOMETRY_CACHE_SIZE = 8;
/** How long one slice of name layout may hold the page. */
const LABEL_LAYOUT_SLICE_MS = 8;

/**
 * Phones and tablets: a touch screen as the main pointer. They pick on tap,
 * where the half-size pick map's 2 px steps do not show, and they are the
 * devices short of memory.
 */
function prefersSmallPickMap(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}

const MapViewer = ({ mapId, day = null, dayBar, dayActions }: MapViewerProps) => {
  const chronicle = day !== null;
  /*
   * A stored day offers the *same* mode list as the live map, with no
   * filtering. Every mode now has an honest day answer: the day-varying ones
   * (`nation`, `trade`, `empire`, `prosperity`, `infrastructure`, `infestation`) come out of that
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
  const accessKey = JSON.stringify([mapId, authToken]);
  const [checkedAccessKey, setCheckedAccessKey] = useState<string | null>(
    () => mapId === "main" ? accessKey : null
  );
  const accessChecked = checkedAccessKey === accessKey;

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

  const pickSurfaceRef = useRef<PickSurface | null>(null);
  const viewportControlsRef = useRef<MapViewportControls | null>(null);
  const viewportCoordsRef = useRef<MapPickViewport | null>(null);
  const lastProvinceIdRef = useRef<number | null>(null);

  const displayName = mapDisplayName(mapId, maps);

  useEffect(() => {
    if (!mapRequiresAuth(mapId, maps)) {
      setGateReason(null);
      setCheckedAccessKey(accessKey);
      return;
    }

    let cancelled = false;
    setCheckedAccessKey(null);
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
        if (!cancelled) setCheckedAccessKey(accessKey);
      });

    return () => {
      cancelled = true;
    };
  }, [mapId, authToken, maps, accessKey]);

  const guildNameCacheRef = useGuildCache(mapId, authToken, day);
  const paint = useMapPaint({ mapId, viewportCoordsRef });
  // War planning's switch and toolbar are desktop-only. Crossing to a phone
  // width turns it off, so the paint layer does not go on taking the map's
  // touches with no control left to stop it.
  const setPaintEnabled = paint.setEnabled;
  useEffect(() => {
    const query = window.matchMedia("(max-width: 47.99rem)");
    const apply = () => {
      if (query.matches) setPaintEnabled(false);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [setPaintEnabled]);

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
   * `prosperity`, `infrastructure` and `infestation` under a stored day. These are drawn on the
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
  } = useMapGeometry(mapId, authToken);
  const markersEnabled = accessChecked && gateReason === null;
  const {
    settlements,
    installations,
    forts,
    wars,
    hubLinks,
    tradeNetworks,
    tradeEdges,
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

  // Same gate as the hub-link layer: the live map, installations on, and the
  // supply-links toggle on. Only the nation map draws them. The polyline and
  // the hover grid are built once per payload, not per frame.
  const supplyRoutesShown =
    day === null && installationsVisible && supplyLinksVisible;
  const tradeGeometry = useMemo(
    () =>
      supplyRoutesShown && isMarkerMapMode(mapType)
        ? buildTradeEdgeGeometry(tradeEdges, tradeNetworks)
        : EMPTY_TRADE_EDGE_GEOMETRY,
    [supplyRoutesShown, mapType, tradeEdges, tradeNetworks]
  );

  /**
   * What the current mode's names are laid out from, and the content key a
   * finished layout is cached under; null while something is still loading.
   */
  const labelJob = useMemo(() => {
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
    // Switching back to a mode fetches the same data again as a new object;
    // keyed by content, a mode already seen this page view reuses its layout.
    const key = [
      mapId,
      mapType,
      labelGrid ? "grid" : "",
      labelNeighbors ? "label-neighbours" : "",
      JSON.stringify(regionData),
      needsTitleLayers ? JSON.stringify(titleLayers) : "",
    ].join("\u0000");
    const start = () =>
      computeRegionLabelGeometrySteps(mapType, regionData, titleLayers, neighbors, centroids, {
        grid: labelGrid ?? undefined,
        labelNeighbors: labelNeighbors ?? neighbors,
      });
    return { key, start };
  }, [
    mapId,
    mapType,
    regionData,
    titleLayers,
    neighbors,
    labelNeighbors,
    centroids,
    labelGrid,
  ]);

  // A layout not yet cached is worked out in slices of a few milliseconds,
  // with the browser free between them: done in one go, a first visit to the
  // counties froze the page for a quarter of a second.
  const [laidOut, setLaidOut] = useState<{
    key: string;
    geometry: RegionLabelGeometryCache | null;
  } | null>(null);
  useEffect(() => {
    if (!labelJob || labelGeometryCache.has(labelJob.key)) return;
    const steps = labelJob.start();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const slice = () => {
      const until = performance.now() + LABEL_LAYOUT_SLICE_MS;
      let step = steps.next();
      while (!step.done && performance.now() < until) step = steps.next();
      if (!step.done) {
        timer = setTimeout(slice, 0);
        return;
      }
      labelGeometryCache.set(labelJob.key, step.value);
      if (labelGeometryCache.size > LABEL_GEOMETRY_CACHE_SIZE) {
        labelGeometryCache.delete(labelGeometryCache.keys().next().value!);
      }
      setLaidOut({ key: labelJob.key, geometry: step.value });
    };
    slice();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [labelJob]);
  const labelGeometry = !labelJob
    ? null
    : labelGeometryCache.has(labelJob.key)
      ? labelGeometryCache.get(labelJob.key)!
      : laidOut?.key === labelJob.key
        ? laidOut.geometry
        : null;

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
  const [chronicleGridState, setChronicleGrid] = useState<{
    key: string;
    grid: ProvinceIdGrid;
  } | null>(null);
  // A map or account switch can finish its metadata before the new grid.
  // Never paint the new ownership onto pixels retained from the old view.
  const chronicleGrid =
    day !== null && chronicleGridState?.key === accessKey
      ? chronicleGridState.grid
      : null;

  useEffect(() => {
    if (day === null) {
      setChronicleGrid(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void fetchProvinceIdGridQ4(mapId, authToken, controller.signal)
      .then((grid) => {
        if (!cancelled) setChronicleGrid({ key: accessKey, grid });
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
  }, [mapId, authToken, day, accessKey]);

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

  // Terrain does not depend on geometry or region metadata. Let its manifest
  // start as soon as access is established; names arrive with their geometry.
  const mapCanvasMounted = accessChecked && !gateReason;
  const pickKey = JSON.stringify([mapId, mapType, day, authToken]);
  const [pickReadyFor, setPickReadyFor] = useState<string | null>(null);

  // A new mode must not read the previous mode's pixels, nor a half-painted
  // image while the copy yields between bands.
  useEffect(() => {
    if (!accessChecked || gateReason || !mapCanvasMounted) {
      return;
    }

    setPickReadyFor(null);
    // Nothing (a pin's realm lookup) may read the last mode's regions.
    pickSurfaceRef.current = null;
    let blobUrl: string | null = null;
    let cancelled = false;

    const drawImage = async () => {
      // The raster modes (prosperity, terrain, ...) hover provinces from the
      // province grid and never pick a region, so their full-size image would
      // be downloaded and decoded only to sit unread.
      if (provinceHoverBlocksRegionPick(mapType)) return;

      // Phones get a half-size pick map: decoding the full one, with the map,
      // was enough for iOS Safari to run out of memory and reload the page
      // over and over.
      const pickScale = prefersSmallPickMap() ? 1 : 0;
      const path = `/${mapId}/mapdata/${mapType}${pickScale ? `?scale=${pickScale}` : ""}`;
      let src = mapApiUrl(path);
      if (authToken) {
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

      const read = async (source: CanvasImageSource, width: number, height: number) => {
        const surface = await pickSurfaceFromImage(source, width, height, () => cancelled);
        if (!surface || cancelled) return;
        pickSurfaceRef.current = surface;
        setPickReadyFor(pickKey);
      };

      // Decoded off the main thread. Drawn straight from an <img>, the 6400 px
      // pick map was decoded inside drawImage, holding the page for about a
      // third of a second on every switch to a region mode. Colours exactly as
      // stored: they are read back as region ids.
      try {
        const res = await fetch(src, { credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Premultiplied, as a canvas stores it anyway (pick pixels are fully
        // opaque or fully transparent, so no region's colour changes): left
        // unpremultiplied, the copy into a canvas took nearly three times as long.
        const bitmap = await createImageBitmap(await res.blob(), {
          colorSpaceConversion: "none",
        });
        if (cancelled) {
          bitmap.close();
          return;
        }
        await read(bitmap, bitmap.width, bitmap.height);
        bitmap.close();
        return;
      } catch {
        if (cancelled) return;
        // Fall through to the plain image path below.
      }

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      img.onload = () => {
        if (cancelled) return;
        void read(img, img.width, img.height);
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
      revokeMapBlobUrl(blobUrl);
    };
  }, [
    mapId,
    mapType,
    accessChecked,
    gateReason,
    authToken,
    mapCanvasMounted,
    day,
    pickKey,
  ]);

  /**
   * Chronicle mode's pick map.
   *
   * Painted from `directOwnership` — every region in its *own* colour over its
   * *own* provinces — because that is what `/mapdata/{mode}` is: coloured by
   * direct owner, which is why `getHoverRegion` walks up the `overlord` chain
   * to find a visible ancestor. Since `useMapHover`'s `rgbToId` is built from
   * the same day's `regionData`, this makes hover, click, nation details and
   * drill-down day-correct with no change to any hover code.
   *
   * It is 1600x1600 here rather than the live 6400x6400, so a pick can
   * disagree with the drawn border by up to 4 map pixels at the very edge of a
   * nation. That is the same 16x memory trade `ChronicleOwnershipLayer` makes,
   * and the two layers agree with each other because they read the same grid.
   */
  useEffect(() => {
    if (day === null) return;
    setPickReadyFor(null);
    pickSurfaceRef.current = null;
    if (!accessChecked || gateReason || !mapCanvasMounted) return;
    if (!chronicleGrid || !regionData) return;

    const width = chronicleGrid.width;
    const height = chronicleGrid.height;
    const imageData = {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: "srgb",
    } as ImageData;
    paintChronicleFrameToImageData(
      imageData,
      chronicleGrid,
      buildNationColorLut(directOwnership(regionData))
    );
    pickSurfaceRef.current = pickSurfaceFromImageData(imageData);
    setPickReadyFor(pickKey);
  }, [
    day,
    accessChecked,
    gateReason,
    mapCanvasMounted,
    chronicleGrid,
    regionData,
    pickKey,
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
    loading:
      loading || (!provinceHoverBlocksRegionPick(mapType) && pickReadyFor !== pickKey),
    regionData,
    pickSurfaceRef,
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
    labels: regionLabels,
    forts,
    tradeGeometry,
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
        clearSelection();
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
    focusOnRegion(regionId);
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

  /**
   * Focus the map on a selected region, as CK3 does with a realm: one with
   * subjects opens to show them, anything else opens the realms above it so
   * it is drawn as itself. The canvas dims the rest of the world.
   */
  const focusOnRegion = useCallback(
    (regionId: string) => {
      if (!regionData?.[regionId]) return;
      const chain = getAncestryChain(regionId, regionData);
      const open = hasLandSubjects(regionId, regionData) ? chain : chain.slice(1);
      const stack: DrillLayer[] = open.reverse().map((id) => ({
        regionId: id,
        name: regionData[id]?.name || id,
        rgb: regionData[id]?.rgb ?? "128,128,128",
      }));
      const unchanged =
        stack.length === drillStack.length &&
        stack.every((layer, index) => layer.regionId === drillStack[index].regionId);
      if (unchanged) return;
      applyDrillStack(stack, regionData, resetDrillVisibility, drillDownRegion);
      setDrillStack(stack);
    },
    [regionData, drillStack, resetDrillVisibility, drillDownRegion]
  );

  /** Close the details and put the map back as it was. */
  const clearSelection = useCallback(() => {
    select();
    setDrillStack([]);
    if (regionData) resetDrillVisibility(regionData);
  }, [select, regionData, resetDrillVisibility]);

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
        select({ region: regionId });
        focusOnRegion(regionId);
      }
      if (options.focus ?? true) focusRegion(regionId);
    },
    [regionData, focusOnRegion, focusRegion, mapType, guildData, select]
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
    // Wait for the realm map's layers too: the data lands first, and opening
    // a realm's subjects before its layers exist would open nothing.
    if (!mapObjects.some((obj) => (obj.baseId ?? obj.id) === pendingRealmId)) return;
    selectRegion(pendingRealmId);
    setPendingRealmId(null);
  }, [pendingRealmId, mapType, regionData, mapObjects, selectRegion]);

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
    [selectRegion, focusPoint, select, guildData, settlements]
  );

  /**
   * The selected region's `_hover` crop, kept lit under the details panel.
   * Resolved like hover is, through the visible ancestor, so a subject inside
   * a closed realm lights its overlord until its layer is opened.
   */
  const focusRealmId = drillStack[drillStack.length - 1]?.regionId ?? null;
  /**
   * The region kept lit for the open card. On the trade map a click opens the
   * card of the guild that dominates the area, and the areas are keyed by
   * that guild's id, so the guild's card lights its areas.
   */
  const litRegionId =
    selectedId ??
    (mapType === "trade" && selectedGuildKey
      ? selectedGuildKey.slice(selectedGuildKey.indexOf("/") + 1)
      : null);
  const selectedOverlay = useMemo<HoverOverlay | null>(() => {
    if (chronicle || !litRegionId || !regionData?.[litRegionId]) return null;
    // An opened realm is lit by the focus itself; its own crop would cover
    // the subjects it was opened to show.
    if (litRegionId === focusRealmId) return null;
    const target = getHoverRegion(mapType, mapId, litRegionId, regionData);
    return target.imagePath
      ? { url: target.imagePath, overlay: target.overlay }
      : null;
    // mapObjects: the visible ancestor changes when layers open and close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chronicle, litRegionId, regionData, getHoverRegion, mapType, mapId, mapObjects, focusRealmId]);

  /**
   * What the canvas keeps lit. An opened realm: its whole shape, with its own
   * layers drawn inside. Otherwise the selected region alone.
   */
  const mapFocus = useMemo<MapFocus | null>(() => {
    if (chronicle || !regionData) return null;
    if (focusRealmId) {
      const shape = mapObjects.find(
        (obj) => !obj.nested && (obj.baseId ?? obj.id) === focusRealmId
      );
      if (!shape) return null;
      const objects = mapObjects.filter(
        (obj) =>
          obj.visible &&
          getAncestryChain(obj.baseId ?? obj.id, regionData).includes(focusRealmId)
      );
      return {
        shapePath: `/${mapId}/regions/${mapType}/${shape.path}`,
        overlay: shape.overlay,
        objects,
        lit: selectedId === focusRealmId,
      };
    }
    if (!selectedOverlay) return null;
    const path = mapApiPathFromUrl(selectedOverlay.url);
    return {
      shapePath: path.endsWith("_hover") ? path.slice(0, -"_hover".length) : path,
      overlay: selectedOverlay.overlay,
      objects: [],
      lit: true,
    };
  }, [chronicle, regionData, focusRealmId, mapObjects, mapId, mapType, selectedOverlay, selectedId]);

  // Escape puts the details away, unless it is closing something in a field.
  useEffect(() => {
    if (!selectedId && !selectedPlaceId && !selectedGuildKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isTypingTarget(event.target)) return;
      clearSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, selectedPlaceId, selectedGuildKey, clearSelection]);

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
   * `prosperity`/`infrastructure`/`infestation`) the raster source is. `main` has no
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

  const archived = isArchivedMap(mapId, maps);
  const markerLayers = day === null && isMarkerMapMode(mapType);
  const layerToggles: MapLayerToggle[] = [];
  if (markerLayers) {
    layerToggles.push(
      {
        id: "installations",
        label: "Installations",
        hint: "Forts, ports, airfields and stations",
        icon: FortIcon,
        checked: installationsVisible,
        onChange: setInstallationsVisible,
      },
      {
        id: "supply-links",
        label: "Supply links",
        hint: "Trade routes between supply hubs",
        icon: RouteIcon,
        checked: supplyLinksVisible,
        onChange: setSupplyLinksVisible,
      }
    );
  }
  if (!chronicle) {
    layerToggles.push({
      id: "paint",
      label: "War planning",
      hint: "Draw arrows, labels and objects over the map",
      icon: BrushIcon,
      // Its toolbar is desktop-only.
      desktopOnly: true,
      checked: paint.enabled,
      onChange: paint.setEnabled,
    });
  }

  const plaqueActions = chronicle ? (dayActions ?? null) : (
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
      regionData={guildData}
      seat={guildSeat(selectedGuild, settlements)}
      tradeProvinces={
        mapType === "trade" ? regionData?.[selectedGuild.id]?.size ?? null : null
      }
      onSelectRegion={openRealm}
      onSelectPlace={(markerId) => select({ place: markerId })}
      onFocusPoint={focusPoint}
      onClose={clearSelection}
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
      onClose={clearSelection}
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
        onClose={clearSelection}
        onSelectGuild={(key) => select({ guild: key })}
      />
    ) : null;

  return (
    <MapShell
      banner={dayBar}
      plaque={
        <MapPlaque
          eyebrow={archived ? "Archived chapter" : "World map"}
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
      onDetailsClose={clearSelection}
      status={loading ? `Loading ${mapModeLabel(mapType).toLowerCase()}…` : null}
      zoomControls={zoomControls}
      layers={
        <MapLayersMenu
          mapType={mapType}
          onMapTypeChange={handleMapTypeChange}
          toggles={layerToggles}
          footer={archiveFooter}
          mapId={mapId}
          // Live tiles would show today's colours beside a stored day, and a
          // staff map's images need a token each: both keep the icons.
          previews={!authToken && day === null}
        />
      }
      paintPanel={!chronicle && paint.enabled ? <PaintToolbar paint={paint} /> : null}
    >
      <MapCanvas
        mapId={mapId}
        mapType={mapType}
        sessionToken={authToken}
        viewportCoordsRef={viewportCoordsRef}
        controlsRef={viewportControlsRef}
        mapObjects={loading ? [] : mapObjects}
        hoveredOverlay={hoveredOverlay}
        selectedOverlay={selectedOverlay}
        hoveredFortZoc={hoveredFortZoc}
        cursorTooltip={cursorTooltip}
        labels={regionLabels}
        markers={mapMarkers}
        wars={wars}
        hubLinks={supplyRoutesShown ? hubLinks : []}
        tradeGeometry={tradeGeometry}
        centroids={centroids}
        hoveredMarkerId={hoveredMarkerId ?? selectedPlaceId}
        hoveredNationId={hoveredRegionId ?? litRegionId}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleMapClick}
        isHoveringClickable={isHoveringClickable}
        focus={mapFocus}
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
