import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { RefObject, MutableRefObject } from "react";
import type {
  CursorTooltip,
  HoverOverlay,
  MapId,
  MapMode,
  MapObject,
  OverlayBBox,
  WarExport,
} from "./types";
import { mapFallbackSize } from "./types";
import { REGION_TILE_MODES } from "./mapModes";
import type { MapMarker } from "../../lib/mapMarkers";
import { isMarkerMapMode } from "../../lib/mapMarkers";
import {
  HOVER_OVERLAY_EXPAND,
  overlayPathFromHoverUrl,
  overlayStyle,
} from "./overlayStyle";
import LabelLayer from "./LabelLayer";
import MapMarkerLayer from "./MapMarkerLayer";
import PaintLayer from "./PaintLayer";
import PaintTextEditor from "./PaintTextEditor";
import type { UseMapPaintResult } from "../../hooks/useMapPaint";
import WarCampaignLineLayer from "./WarCampaignLineLayer";
import MapAuthImage from "./MapAuthImage";
import MapViewport from "./MapViewport";
import { provinceHoverBlocksRegionPick } from "../../hooks/regionPick";
import TileLayer from "./TileLayer";
import {
  tileUrl,
  useTileManifest,
} from "../../hooks/useTileManifest";
import { overlayLod, tilePixelRatio } from "../../lib/map/tilePyramid";
import {
  mapFiltersSupportedHere,
  unzoomedLabelsSupported,
} from "../../lib/map/mapFilters";
import {
  useMapViewport,
  type MapFocusInset,
} from "../../hooks/useMapViewport";
import type { FitMode, MapRect } from "../../lib/mapViewportMath";
import { useMapAssetUrl } from "../../hooks/useMapAssetUrl";
import type { MapPickViewport } from "../../hooks/useMapCoords";
import type { NationLabelSpec, ProvinceCentroids } from "../../lib/mapLabels";
import { mapApiPathFromUrl, mapApiUrl } from "@/lib/map/api";
import {
  PROVINCE_RASTER_MODES,
  showsLiveProvinceRaster,
} from "@/app/lib/map/chronicleDayModes";

const panelClass =
  "rounded-lg border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-moss)_35%,var(--tfmc-forest-deep))] shadow-lg";

/**
 * Exported so the chronicle's client-painted ownership layer can match the live
 * look exactly rather than re-typing the numbers and drifting from it.
 */
export const HOVER_OVERLAY_OPACITY = 0.72;
export const DRILL_STACK_OVERLAY_OPACITY = 0.88;
export const PROVINCE_MODE_OVERLAY_OPACITY = 0.72;
const OVERLAY_TRANSITION_CLASS =
  "pointer-events-none absolute transition-[left,top,width,height,opacity] duration-150 ease-out";

/**
 * Camera controls the map shell drives from outside the canvas: the zoom
 * buttons, "zoom to realm", and search results.
 */
export type MapViewportControls = {
  zoomBy: (factor: number) => void;
  reset: () => void;
  focusMapRect: (rect: MapRect, inset?: MapFocusInset) => void;
};

function mapInteractionCursor(
  isPanning: boolean,
  isHoveringClickable: boolean
): string {
  if (isPanning) return "cursor-grabbing";
  if (isHoveringClickable) return "cursor-pointer";
  return "cursor-grab";
}

function paintToolCursor(tool: UseMapPaintResult["tool"]): string {
  if (tool === "eraser") return "cursor-cell";
  if (tool === "move") return "cursor-move";
  if (tool === "text") return "cursor-text";
  return "cursor-crosshair";
}


/**
 * The highlight drawn over a region: its own shape, a little brighter, with a
 * light rim `rimPx` screen pixels wide. The overlay sits inside the scaled
 * map, so the rim is sized in map pixels divided by the scale to stay
 * constant on screen. Hover gets a thin rim, the region whose details are
 * open a thicker one; both stand down mid-gesture (`.map-selected-region`).
 */
function regionHighlightStyle(
  displayScale: number,
  rimPx: number,
  rimAlpha: number
): React.CSSProperties {
  // Safari would draw the highlighted region not at all (see mapFilters).
  // Unfiltered, it still stands out: drawn again over its own colour, and,
  // when selected, over the faded rest of the world.
  if (!mapFiltersSupportedHere()) return {};
  const px = displayScale > 0 ? rimPx / displayScale : 0;
  const rim = `rgb(232 228 217 / ${rimAlpha})`;
  return {
    filter: [
      "brightness(1.18) saturate(1.08)",
      `drop-shadow(${px}px 0 0 ${rim})`,
      `drop-shadow(-${px}px 0 0 ${rim})`,
      `drop-shadow(0 ${px}px 0 ${rim})`,
      `drop-shadow(0 -${px}px 0 ${rim})`,
    ].join(" "),
  };
}

/**
 * What the map is focused on: a selected region, or a realm opened to show
 * its subjects. Every other region's colour fades; the focus keeps its own,
 * drawn over the faded layer from `shapePath` (a region crop, as an API path)
 * or, for an opened realm, from its own layers in `objects`.
 */
export type MapFocus = {
  shapePath: string;
  overlay?: OverlayBBox;
  objects: MapObject[];
  /**
   * The focus is itself the selection, and gets the selection's rim. An
   * opened realm with one of its subjects selected keeps a thinner one.
   */
  lit: boolean;
};

/**
 * The flattened colours' opacity while something is focused. Low enough that
 * the rest of the world reads as background, and that what shows through
 * under the focus (drawn at full strength over it) tints it by only a few
 * per cent.
 */
const FOCUS_MUTED_OPACITY = 0.3;

/** The realm names: over the region overlays (10), under the pins (16, 17). */
const LABEL_LAYER_Z = 15;

/**
 * A map image's URL without the reduction it asks for (`?lod=`): the same
 * shape at any zoom.
 */
function shapeOfUrl(url: string): string {
  return url.replace(/[?&]lod=\d+$/, "");
}

/**
 * Whether a copy of the shape at `url` has loaded since the shape was last
 * switched to. Another reduction of it (a zoom) keeps it ready: the copy on
 * screen stays up until the new one has loaded. `mark` records a copy's
 * load, or its failure, which leaves nothing drawn.
 */
function useShapeLoaded(
  url: string | null
): [boolean, (url: string, loaded: boolean) => void] {
  const shape = url ? shapeOfUrl(url) : null;
  const [state, setState] = useState({ shape, loaded: false });
  if (state.shape !== shape) setState({ shape, loaded: false });
  const mark = useCallback((copy: string, loaded: boolean) => {
    const copyShape = shapeOfUrl(copy);
    setState((current) =>
      current.shape === copyShape && current.loaded !== loaded ? { shape: copyShape, loaded } : current
    );
  }, []);
  return [shape !== null && state.shape === shape && state.loaded, mark];
}

/**
 * Whether the shape at `url` is ready to draw, so the colours fade only once
 * what replaces them is (see `useShapeLoaded`).
 */
function useImageLoaded(url: string | null): boolean {
  const [loaded, mark] = useShapeLoaded(url);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!cancelled) mark(url, true);
    };
    image.onerror = () => {
      if (!cancelled) mark(url, false);
    };
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [url, mark]);
  return loaded;
}

/**
 * Where the pointer's tooltip goes: below and to the right of it, flipped to
 * the other side near the window's right or bottom edge so it is never cut off
 * (on a phone the finger is often near the edge).
 */
function tooltipPosition(x: number, y: number): React.CSSProperties {
  const gap = 14;
  const width = typeof window === "undefined" ? Infinity : window.innerWidth;
  const height = typeof window === "undefined" ? Infinity : window.innerHeight;
  return {
    ...(x + gap + 240 > width ? { right: Math.max(8, width - x + gap) } : { left: x + gap }),
    ...(y + gap + 110 > height ? { bottom: Math.max(8, height - y + gap) } : { top: y + gap }),
  };
}

function pixelatedClass(displayScale: number): string {
  return displayScale >= 1 ? "[image-rendering:pixelated]" : "";
}

function applyNaturalMapSize(
  img: HTMLImageElement,
  setMapSize: Dispatch<SetStateAction<{ w: number; h: number }>>
) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w <= 0 || h <= 0) return;

  setMapSize((current) =>
    current.w === w && current.h === h ? current : { w, h }
  );
}

function HoverOverlayImage({
  mapId,
  sessionToken,
  overlay,
  mapW,
  mapH,
  opacity = HOVER_OVERLAY_OPACITY,
  alt = "Hovered region",
  imageClassName = "",
  imageStyle,
  lod = 0,
  ownShape = false,
}: {
  mapId: MapId;
  sessionToken?: string | null;
  overlay: HoverOverlay;
  mapW: number;
  mapH: number;
  opacity?: number;
  alt?: string;
  imageClassName?: string;
  imageStyle?: React.CSSProperties;
  /** Reduced copy to ask for; only region crops have them. */
  lod?: number;
  /**
   * Draw the region's own overlay rather than its `_hover` variant: the same
   * colours as the map under it, so a highlight reads as that realm lit up,
   * not swapped for a paler copy.
   */
  ownShape?: boolean;
}) {
  const hoverPath = mapApiPathFromUrl(overlay.url);
  const basePath =
    ownShape && hoverPath.endsWith("_hover") ? hoverPath.slice(0, -"_hover".length) : hoverPath;
  const path =
    lod > 0 && basePath.includes("/regions/") ? `${basePath}?lod=${lod}` : basePath;
  const { url } = useMapAssetUrl(mapId, path, sessionToken, Boolean(path));

  // Another reduction of the same shape (a zoom) swaps the source on the same
  // element, and the old copy stays up, lit, until the new one has loaded
  // rather than dimming and growing again.
  const shape = url ? shapeOfUrl(url) : null;
  const [ready, mark] = useShapeLoaded(url);

  const markLoaded = useCallback(() => {
    if (url) mark(url, true);
  }, [url, mark]);
  const positioned = overlayStyle(overlay.overlay, mapW, mapH, {
    expand: ready ? HOVER_OVERLAY_EXPAND : 0,
  });
  const show =
    Boolean(url) && positioned.visibility !== "hidden" && mapW > 0 && mapH > 0;
  const imageOpacity = show ? (ready ? opacity : opacity * 0.35) : 0;

  if (!url) return null;

  return (
    <img
      key={shape}
      src={url}
      alt={alt}
      ref={(node) => {
        if (node?.complete && node.naturalWidth > 0) markLoaded();
      }}
      className={`${OVERLAY_TRANSITION_CLASS} z-10 ${imageClassName}`.trim()}
      style={{
        ...positioned,
        ...imageStyle,
        opacity: imageOpacity,
      }}
      onLoad={markLoaded}
      onError={() => {
        if (url) mark(url, false);
      }}
    />
  );
}

type MapCanvasProps = {
  mapId: MapId;
  mapType: MapMode;
  sessionToken?: string | null;
  mapObjects: MapObject[];
  hoveredOverlay: HoverOverlay | null;
  /**
   * The region whose details panel is open, kept lit after the pointer moves
   * on. Live map only: like `hoveredOverlay` it is a server PNG of today's
   * borders, so a stored day must not pass one.
   */
  selectedOverlay?: HoverOverlay | null;
  hoveredFortZoc?: HoverOverlay | null;
  cursorTooltip: CursorTooltip | null;
  labels?: NationLabelSpec[];
  markers?: MapMarker[];
  wars?: WarExport[];
  centroids?: ProvinceCentroids | null;
  hoveredMarkerId?: string | null;
  hoveredNationId?: string | null;
  viewportCoordsRef?: MutableRefObject<MapPickViewport | null>;
  onMouseMove: (e: React.MouseEvent<Element>) => void;
  onMouseLeave: () => void;
  onClick: (e: React.MouseEvent<Element>) => void;
  isHoveringClickable?: boolean;
  /**
   * Live map only: the selected region or opened realm. Every other region's
   * colour fades, and an opened realm's own layers are drawn over the
   * flattened tiles, which otherwise stay as first shown.
   */
  focus?: MapFocus | null;
  /** Filled with the camera controls once the viewport is mounted. */
  controlsRef?: MutableRefObject<MapViewportControls | null>;
  /** Full-bleed mode: fills its container instead of sizing to the map itself
   * as a bordered card. See `MapViewport`'s `fill` prop. */
  fill?: boolean;
  /** "cover" (default) fills the viewport, cropping the map; "contain" shows
   * the whole map, leaving empty space on the shorter axis. */
  fitMode?: FitMode;
  /** War-planning annotation layer. See `useMapPaint`. */
  paint?: UseMapPaintResult;
  /**
   * Chronicle mode only. When provided, this node replaces *both* server-
   * rendered nation layers: the per-`MapObject` `/regions/...` overlays and the
   * hovered-region `_hover` highlight. Those PNGs are regenerated from today's
   * data and have no per-day variant, so a historical day has to paint its own
   * borders client-side or it would show today's under a past date.
   *
   * Undefined on the live map, where the two blocks below render exactly as
   * they always have.
   */
  regionOverlay?: React.ReactNode;
  /**
   * A chronicle day, or `null` for the live map. Read only by
   * `showsLiveProvinceRaster` below, which is what stops a stored day from
   * showing today's prosperity or infestation raster.
   */
  day?: string | null;
  /**
   * Chronicle mode only. Replaces the `/{mapId}/mapdata/{mode}` image for the
   * raster modes that vary per day. Undefined on the live map and for the
   * static rasters (`terrain`, `fertility`), which keep the server image.
   */
  provinceOverlay?: React.ReactNode;
};

export default function MapCanvas({
  mapId,
  mapType,
  sessionToken,
  mapObjects,
  hoveredOverlay,
  selectedOverlay = null,
  hoveredFortZoc = null,
  cursorTooltip,
  labels = [],
  markers = [],
  wars = [],
  centroids = null,
  hoveredMarkerId = null,
  hoveredNationId = null,
  viewportCoordsRef,
  onMouseMove,
  onMouseLeave,
  onClick,
  isHoveringClickable = false,
  focus = null,
  controlsRef,
  fill = false,
  fitMode = "cover",
  paint,
  regionOverlay,
  day = null,
  provinceOverlay,
}: MapCanvasProps) {
  const [mapSize, setMapSize] = useState({
    w: mapFallbackSize(mapId),
    h: mapFallbackSize(mapId),
  });

  const paintEnabled = paint?.enabled ?? false;
  // Paint mode owns the left button and single-finger drags; middle-drag and
  // the wheel still move the map underneath the brush.
  const viewport = useMapViewport({
    mapSize,
    fitMode,
    dragPan: !paintEnabled,
    keyboard: true,
    // Safari would otherwise back the scaled-down 6400 px map with a
    // full-size layer and run out of memory (see restingZoom).
    restingZoom: true,
    // Mid-gesture the transform runs ahead of React; keep hover picking on
    // what is actually on screen.
    onLiveTransform: (live) => {
      if (!viewportCoordsRef?.current) return;
      viewportCoordsRef.current.displayScale = live.displayScale;
      viewportCoordsRef.current.translateX = live.translateX;
      viewportCoordsRef.current.translateY = live.translateY;
    },
  });

  /**
   * Tiles for the base map and the raster modes, Google Maps style: only the
   * tiles on screen, at the level the zoom needs. Public maps only — a staff
   * map's assets need a bearer token per request, so it keeps the single
   * images. Wait for the manifest before deciding a full image is needed.
   */
  const tilesAllowed = !sessionToken;
  const baseTileState = useTileManifest(mapId, "base", tilesAllowed);
  const baseTiles = baseTileState.manifest;
  const rasterLayer =
    PROVINCE_RASTER_MODES.has(mapType) && showsLiveProvinceRaster(mapType, day)
      ? `mapdata-${mapType}`
      : null;
  const rasterTileState = useTileManifest(mapId, rasterLayer, tilesAllowed);
  const rasterTiles = rasterTileState.manifest;

  /**
   * A region mode's overlays as first shown, flattened and tiled by the
   * backend. Switching mode then loads a few tiles instead of one image per
   * region (85 for counties). They stay up when a realm is opened: only that
   * realm's own layers are drawn separately, over them.
   */
  const regionLayer =
    regionOverlay === undefined && REGION_TILE_MODES.has(mapType)
      ? `regions-${mapType}`
      : null;
  const regionTiles = useTileManifest(mapId, regionLayer, tilesAllowed);
  const useRegionTiles = regionTiles.manifest !== null;
  // Until the first answer, draw neither: guessing "no tiles" would start
  // dozens of overlay downloads that the tiles make pointless.
  const holdRegionOverlays = regionLayer !== null && regionTiles.status === "loading";

  // The layers panel requests previews when opened. Warming unopened modes
  // here would compete with the visible map, even if the reader never switches.

  // Names wait for the colour under them, so a mode switch does not show
  // floating text over bare terrain for the moment the shapes take to land.
  const [regionTilesReadyKey, setRegionTilesReadyKey] = useState<string | null>(null);
  const regionTilesKey = regionTiles.manifest
    ? `${mapType}:${regionTiles.manifest.version}`
    : null;
  const labelsShown =
    !regionLayer ||
    (useRegionTiles
      ? regionTilesReadyKey === regionTilesKey
      : regionTiles.status !== "loading");

  // The settled view the tile layers fetch for. A new object only when the
  // committed transform changes, so mid-gesture the tile layers do not
  // re-render at all.
  const tileView = useMemo(
    () => ({
      displayScale: viewport.displayScale,
      translateX: viewport.translateX,
      translateY: viewport.translateY,
      viewportW: viewport.viewportSize.w,
      viewportH: viewport.viewportSize.h,
    }),
    [
      viewport.displayScale,
      viewport.translateX,
      viewport.translateY,
      viewport.viewportSize.w,
      viewport.viewportSize.h,
    ]
  );

  // Decided after mount: the server has no user agent, and the first render
  // must match its HTML.
  const [labelsUnzoomed, setLabelsUnzoomed] = useState(false);
  useEffect(() => {
    setLabelsUnzoomed(unzoomedLabelsSupported(navigator.userAgent));
  }, []);

  const devicePixelRatio = tilePixelRatio();
  // Zoomed out, realm overlays come as reduced copies: decoding a crop at
  // full size only to draw it a few pixels across is what the tiles fix for
  // the base map.
  const lod = overlayLod(viewport.displayScale, devicePixelRatio);
  /** The last press on the map was a finger (see the hit target below). */
  const touchPointerRef = useRef(false);

  // The focus. Its shape is the same crop the selection highlight draws, so
  // once it has loaded the highlight is ready to stand in for the faded
  // colour under it.
  const focusShapePath =
    focus && regionOverlay === undefined
      ? lod > 0 && focus.shapePath.includes("/regions/")
        ? `${focus.shapePath}?lod=${lod}`
        : focus.shapePath
      : "";
  const { url: focusShapeUrl } = useMapAssetUrl(
    mapId,
    focusShapePath,
    sessionToken,
    Boolean(focusShapePath)
  );
  const focusShapeLoaded = useImageLoaded(focusShapeUrl);
  // An opened realm draws its own layers instead; the colours fade once they
  // have all loaded, so the realm never shows faded in between.
  const focusObjects = useRegionTiles && focus ? focus.objects : [];
  const focusObjectsKey = focusObjects.map((obj) => obj.id).join("|");
  const [focusLoaded, setFocusLoaded] = useState<{ key: string; ids: Set<string> }>({
    key: "",
    ids: new Set(),
  });
  const markFocusObjectLoaded = useCallback(
    (id: string) =>
      setFocusLoaded((current) => {
        const ids = current.key === focusObjectsKey ? current.ids : new Set<string>();
        if (ids.has(id)) return current;
        return { key: focusObjectsKey, ids: new Set(ids).add(id) };
      }),
    [focusObjectsKey]
  );
  const focusReady =
    focusObjects.length > 0
      ? focusLoaded.key === focusObjectsKey &&
        focusObjects.every((obj) => focusLoaded.ids.has(obj.id))
      : focusShapeLoaded;

  if (controlsRef) {
    controlsRef.current = {
      zoomBy: viewport.zoomBy,
      reset: () => viewport.resetViewport({ animated: true }),
      focusMapRect: viewport.focusMapRect,
    };
  }
  const appliedNaturalSizeRef = useRef<{ w: number; h: number } | null>(null);

  const syncNaturalMapSize = (img: HTMLImageElement) => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w <= 0 || h <= 0) return;

    const applied = appliedNaturalSizeRef.current;
    if (applied?.w === w && applied?.h === h) return;

    appliedNaturalSizeRef.current = { w, h };
    applyNaturalMapSize(img, setMapSize);
  };

  if (viewportCoordsRef) {
    viewportCoordsRef.current = {
      displayScale: viewport.displayScale,
      translateX: viewport.translateX,
      translateY: viewport.translateY,
      viewportElement: viewport.viewportRef.current,
      mapSize,
    };
  }

  useEffect(() => {
    appliedNaturalSizeRef.current = null;
    setMapSize({ w: mapFallbackSize(mapId), h: mapFallbackSize(mapId) });
  }, [mapId]);

  // With tiles there is no single base image to read a natural size from.
  useEffect(() => {
    if (!baseTiles) return;
    setMapSize((current) =>
      current.w === baseTiles.width && current.h === baseTiles.height
        ? current
        : { w: baseTiles.width, h: baseTiles.height }
    );
  }, [baseTiles]);

  // A different map opens on its whole-world view. A mode change is only a
  // new overlay on the same map, so the camera stays where the reader left it.
  const previousMapIdRef = useRef(mapId);
  useEffect(() => {
    if (previousMapIdRef.current === mapId) return;
    previousMapIdRef.current = mapId;
    viewport.resetViewport({ animated: false });
  }, [mapId, viewport.resetViewport]);

  /**
   * The province modes drawn as a full-map raster over the base map rather than as
   * region shapes. `showsLiveProvinceRaster` then decides *which* raster: the
   * server's, or — for `prosperity` and `infestation` under a stored day —
   * `provinceOverlay`, painted from that day's capture.
   *
   * This `<img>` had no notion of a day, so widening the day page's mode list
   * without this split would have shown today's prosperity under a past date.
   * `terrain` and `fertility` keep the live image on purpose: they are province
   * geometry, identical on every day.
   */
  const showProvinceOverlay = PROVINCE_RASTER_MODES.has(mapType);
  const liveProvinceRaster = showsLiveProvinceRaster(mapType, day);

  const handleBaseMapLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    syncNaturalMapSize(e.currentTarget);
  };

  const hoveredPath = hoveredOverlay
    ? overlayPathFromHoverUrl(hoveredOverlay.url)
    : null;

  const interactionCursor =
    paintEnabled && !viewport.isPanning
      ? paintToolCursor(paint!.tool)
      : mapInteractionCursor(viewport.isPanning, isHoveringClickable);
  // The viewport's own cursor leaves out hovering: `cursor` is inherited, so
  // each change on the viewport restyles, and lays out again, everything on
  // the map, names included. The hit target below carries the pointer.
  const viewportCursor =
    paintEnabled && !viewport.isPanning
      ? paintToolCursor(paint!.tool)
      : mapInteractionCursor(viewport.isPanning, false);

  const labelLayer = (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        zIndex: LABEL_LAYER_Z,
        opacity: labelsShown ? 1 : 0,
        transition: "opacity 200ms ease-out",
      }}
    >
      <LabelLayer
        labels={labels}
        mapW={mapSize.w}
        mapH={mapSize.h}
        displayScale={viewport.displayScale}
        hoveredNationId={hoveredNationId}
      />
    </div>
  );

  return (
    <div
      className={
        fill
          ? "relative h-full w-full overflow-hidden"
          : `relative max-w-full overflow-hidden ${panelClass}`
      }
    >
      {cursorTooltip?.text && !viewport.isPanning && (
        <div
          className="map-tooltip pointer-events-none fixed z-50 max-w-[min(20rem,calc(100vw-1.5rem))] px-3 py-1.5"
          style={tooltipPosition(cursorTooltip.x, cursorTooltip.y)}
        >
          <p className="whitespace-pre-line font-[family-name:var(--font-fraunces)] text-sm text-[var(--tfmc-cream)]">
            {cursorTooltip.text}
          </p>
          {cursorTooltip.hint && (
            <p className="mt-1 whitespace-pre-line text-xs leading-snug text-[var(--tfmc-stone)]">
              {cursorTooltip.hint}
            </p>
          )}
        </div>
      )}
      <MapViewport
        mapSize={mapSize}
        viewportRef={viewport.viewportRef}
        contentRef={viewport.contentRef}
        transformStyle={viewport.transformStyle}
        zoom={viewport.zoom}
        transformTransition={viewport.transformTransition}
        cursorClassName={viewportCursor}
        isPanning={viewport.isPanning}
        unzoomed={labelsUnzoomed ? labelLayer : undefined}
        unzoomedZIndex={LABEL_LAYER_Z}
        fill={fill}
        capturesTouch
      >
        {baseTiles ? (
          <TileLayer
            manifest={baseTiles}
            onTileError={baseTileState.refresh}
            tileUrl={(level, x, y) => tileUrl(mapId, "base", baseTiles, level, x, y)}
            view={tileView}
            // Past one screen pixel per map pixel, show the map's own pixels
            // sharp rather than smeared.
            className={pixelatedClass(viewport.displayScale)}
          />
        ) : baseTileState.status === "loading" ? (
          <img
            src={mapApiUrl(`/${mapId}/map/preview`)}
            alt="Map preview"
            className="pointer-events-none block h-full w-full"
          />
        ) : (
          <MapAuthImage
            mapId={mapId}
            path={`/${mapId}/map`}
            sessionToken={sessionToken}
            alt="Map"
            className={`pointer-events-none block h-full w-full ${pixelatedClass(
              viewport.displayScale
            )}`}
            imgRef={(node) => {
              if (node?.complete) {
                syncNaturalMapSize(node);
              }
            }}
            onLoad={handleBaseMapLoad}
          />
        )}
        {showProvinceOverlay &&
          (liveProvinceRaster && rasterTiles ? (
            <TileLayer
              key={`${mapType}:${rasterTiles.version}`}
              manifest={rasterTiles}
              tileUrl={(level, x, y) =>
                tileUrl(mapId, `mapdata-${mapType}`, rasterTiles, level, x, y)
              }
              view={tileView}
              className={pixelatedClass(viewport.displayScale)}
              style={{ opacity: PROVINCE_MODE_OVERLAY_OPACITY }}
              // A newer pyramid replaced the one this manifest names (the
              // server hands out the last finished one while it builds).
              onTileError={rasterTileState.refresh}
            />
          ) : liveProvinceRaster && rasterTileState.status === "loading" ? null : liveProvinceRaster ? (
            <MapAuthImage
              mapId={mapId}
              path={`/${mapId}/mapdata/${mapType}`}
              sessionToken={sessionToken}
              alt={`${mapType} overlay`}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{ opacity: PROVINCE_MODE_OVERLAY_OPACITY }}
            />
          ) : (
            provinceOverlay ?? null
          ))}
        {regionOverlay === undefined && useRegionTiles && regionTiles.manifest ? (
          <TileLayer
            // One instance per mode and version: what was loaded or held for
            // the last mode says nothing about this one.
            key={regionTilesKey ?? undefined}
            manifest={regionTiles.manifest}
            tileUrl={(level, x, y) =>
              tileUrl(mapId, `regions-${mapType}`, regionTiles.manifest!, level, x, y)
            }
            view={tileView}
            className="transition-opacity duration-200 ease-out"
            style={{
              opacity: focusReady ? FOCUS_MUTED_OPACITY : DRILL_STACK_OVERLAY_OPACITY,
            }}
            onReady={() => setRegionTilesReadyKey(regionTilesKey)}
            onTileError={regionTiles.refresh}
          />
        ) : regionOverlay === undefined && holdRegionOverlays ? null : regionOverlay === undefined
          ? mapObjects
              .filter((obj) => obj.visible)
              .map((obj) => (
                <MapAuthImage
                  // Keyed by mode too: the map stays mounted across mode
                  // changes, and a region id shared by two modes must not
                  // inherit the other mode's image (or its failed-load
                  // `display: none`).
                  key={`${mapType}:${obj.id}`}
                  mapId={mapId}
                  path={`/${mapId}/regions/${mapType}/${obj.path}${
                    lod > 0 ? `?lod=${lod}` : ""
                  }`}
                  sessionToken={sessionToken}
                  crossOrigin="anonymous"
                  alt={`Overlay ${obj.id}`}
                  // A zoom that changes the reduction swaps the source on the
                  // same element, so the old copy stays up until the new one
                  // has loaded rather than the overlay blinking out.
                  replaceInPlace
                  className={OVERLAY_TRANSITION_CLASS}
                  style={{
                    ...overlayStyle(obj.overlay, mapSize.w, mapSize.h, {
                      expand:
                        hoveredPath && obj.path === hoveredPath
                          ? HOVER_OVERLAY_EXPAND
                          : 0,
                    }),
                    opacity: DRILL_STACK_OVERLAY_OPACITY,
                  }}
                  onLoad={(e) => {
                    e.currentTarget.style.display = "";
                  }}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ))
          : regionOverlay}
        {focusObjects.length > 0 && (
          // One group, so the rim follows the realm's outer edge rather than
          // every subject's, and the opacity applies once over the lot.
          <div
            className="map-selected-region pointer-events-none absolute inset-0"
            style={{
              opacity: DRILL_STACK_OVERLAY_OPACITY,
              ...(focusReady
                ? focus?.lit
                  ? regionHighlightStyle(viewport.displayScale, 2.5, 0.95)
                  : regionHighlightStyle(viewport.displayScale, 1.25, 0.6)
                : {}),
            }}
          >
            {focusObjects.map((obj) => (
              <MapAuthImage
                key={`focus:${mapType}:${obj.id}`}
                mapId={mapId}
                path={`/${mapId}/regions/${mapType}/${obj.path}${lod > 0 ? `?lod=${lod}` : ""}`}
                sessionToken={sessionToken}
                crossOrigin="anonymous"
                alt={`Overlay ${obj.id}`}
                replaceInPlace
                className={OVERLAY_TRANSITION_CLASS}
                style={overlayStyle(obj.overlay, mapSize.w, mapSize.h, {
                  expand: hoveredPath && obj.path === hoveredPath ? HOVER_OVERLAY_EXPAND : 0,
                })}
                onLoad={() => markFocusObjectLoaded(obj.id)}
              />
            ))}
          </div>
        )}
        {/*
          `regionOverlay` is only ever passed by the chronicle. Fort ZoC is a
          server-rendered `/zoc/{id}.png` regenerated from *today's* state, so
          a stored day must not show it — same guard the `hoveredOverlay` block
          below already carries. Live behaviour is unchanged.
        */}
        {regionOverlay === undefined && isMarkerMapMode(mapType) && hoveredFortZoc && (
          <HoverOverlayImage
            mapId={mapId}
            sessionToken={sessionToken}
            overlay={hoveredFortZoc}
            mapW={mapSize.w}
            mapH={mapSize.h}
            opacity={0.85}
            alt="Fort zone of control"
          />
        )}
        {regionOverlay === undefined && selectedOverlay && (
          <HoverOverlayImage
            mapId={mapId}
            sessionToken={sessionToken}
            overlay={selectedOverlay}
            mapW={mapSize.w}
            mapH={mapSize.h}
            // Same opacity as the colours under it, so terrain still shows
            // through and the highlight is the brightening, not a flat fill.
            opacity={DRILL_STACK_OVERLAY_OPACITY}
            alt="Selected region"
            lod={lod}
            ownShape
            imageClassName="map-selected-region"
            imageStyle={regionHighlightStyle(viewport.displayScale, 2.5, 0.95)}
          />
        )}
        {regionOverlay === undefined && hoveredOverlay && (
          <HoverOverlayImage
            mapId={mapId}
            sessionToken={sessionToken}
            overlay={hoveredOverlay}
            mapW={mapSize.w}
            mapH={mapSize.h}
            lod={lod}
            ownShape
            opacity={DRILL_STACK_OVERLAY_OPACITY}
            imageClassName="map-selected-region"
            imageStyle={regionHighlightStyle(viewport.displayScale, 1.25, 0.75)}
          />
        )}
        {isMarkerMapMode(mapType) && wars.length > 0 && (
          <WarCampaignLineLayer
            wars={wars}
            centroids={centroids}
            mapW={mapSize.w}
            mapH={mapSize.h}
          />
        )}
        <MapMarkerLayer
          markers={markers}
          hoveredMarkerId={hoveredMarkerId}
          mapW={mapSize.w}
          mapH={mapSize.h}
          mapType={mapType}
          displayScale={viewport.displayScale}
          layer="base"
        />
        {labelsUnzoomed ? null : labelLayer}
        <MapMarkerLayer
          markers={markers}
          hoveredMarkerId={hoveredMarkerId}
          mapW={mapSize.w}
          mapH={mapSize.h}
          mapType={mapType}
          displayScale={viewport.displayScale}
          layer="hovered"
        />
        <div
          className={`${
            paintEnabled ? "pointer-events-none" : "pointer-events-auto"
          } absolute inset-0 z-20 h-full w-full opacity-0 ${interactionCursor}`}
          // Touch has no hover. A press clears whatever the last tap showed
          // (it would stand at a stale spot once the map moved). In the raster
          // modes a tap then shows that province's details, as hovering does
          // with a mouse (see onClick); elsewhere a tap opens a card, and a
          // hover tooltip at the finger would only sit over the sheet.
          onPointerDown={(event) => {
            touchPointerRef.current = event.pointerType === "touch";
            if (touchPointerRef.current) onMouseLeave();
          }}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse") touchPointerRef.current = false;
          }}
          onMouseMove={(event) => {
            if (touchPointerRef.current && !provinceHoverBlocksRegionPick(mapType)) {
              onMouseLeave();
              return;
            }
            onMouseMove(event);
          }}
          onMouseLeave={onMouseLeave}
          onClick={(event) => {
            if (viewport.consumeDragClick()) return;
            // A tap's own click, not the mouse move a browser may or may not
            // send before it, is what shows a raster mode's province.
            if (touchPointerRef.current && provinceHoverBlocksRegionPick(mapType)) {
              onMouseMove(event);
            }
            onClick(event);
          }}
        />
        {paint ? (
          <PaintLayer
            enabled={paint.enabled}
            visible={paint.visible}
            shapes={paint.shapes}
            draft={paint.draft}
            selectedId={paint.selectedId}
            handlers={paint.handlers}
            mapW={mapSize.w}
            mapH={mapSize.h}
            displayScale={viewport.displayScale}
            cursorClassName={interactionCursor}
          />
        ) : null}
        {paint?.textEditor ? (
          <PaintTextEditor
            editor={paint.textEditor}
            onChange={paint.setTextValue}
            onCommit={paint.commitText}
            onCancel={paint.cancelText}
          />
        ) : null}
      </MapViewport>
    </div>
  );
}
