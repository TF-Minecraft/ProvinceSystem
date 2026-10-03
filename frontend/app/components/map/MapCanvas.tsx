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
  WarExport,
  HubLink,
} from "./types";
import { mapFallbackSize } from "./types";
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
import SupplyLinkLayer from "./SupplyLinkLayer";
import MapAuthImage from "./MapAuthImage";
import MapViewport from "./MapViewport";
import TileLayer from "./TileLayer";
import { useTileManifest } from "../../hooks/useTileManifest";
import { overlayLod } from "../../lib/map/tilePyramid";
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
const PROVINCE_MODE_OVERLAY_OPACITY = 0.72;
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
 * A light rim around the selected region. The overlay sits inside the scaled
 * map, so the glow is sized in map pixels divided by the current scale to stay
 * a constant couple of screen pixels at every zoom.
 */
function selectedOutlineStyle(displayScale: number): React.CSSProperties {
  const px = displayScale > 0 ? 2 / displayScale : 0;
  const rim = "#e8e4d9";
  // Four unblurred offsets trace a crisp rim; the last, blurred and dark,
  // lifts it off light terrain.
  return {
    filter: [
      `drop-shadow(${px}px 0 0 ${rim})`,
      `drop-shadow(-${px}px 0 0 ${rim})`,
      `drop-shadow(0 ${px}px 0 ${rim})`,
      `drop-shadow(0 -${px}px 0 ${rim})`,
      `drop-shadow(0 0 ${px * 1.5}px rgb(0 0 0 / 0.8))`,
    ].join(" "),
  };
}

/** Region modes the backend can flatten and tile (`regions-{mode}`). */
const REGION_TILE_MODES = new Set<MapMode>([
  "nation",
  "county",
  "duchy",
  "kingdom",
  "empire",
  "trade",
]);

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
}) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const basePath = mapApiPathFromUrl(overlay.url);
  const path =
    lod > 0 && basePath.includes("/regions/") ? `${basePath}?lod=${lod}` : basePath;
  const { url } = useMapAssetUrl(mapId, path, sessionToken, Boolean(path));

  useEffect(() => {
    setLoadedUrl(null);
  }, [url]);

  const markLoaded = useCallback(() => {
    if (url) setLoadedUrl(url);
  }, [url]);

  const ready = Boolean(url) && loadedUrl === url;
  const positioned = overlayStyle(overlay.overlay, mapW, mapH, {
    expand: ready ? HOVER_OVERLAY_EXPAND : 0,
  });
  const show =
    Boolean(url) && positioned.visibility !== "hidden" && mapW > 0 && mapH > 0;
  const imageOpacity = show ? (ready ? opacity : opacity * 0.35) : 0;

  if (!url) return null;

  return (
    <img
      key={url}
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
        setLoadedUrl(null);
      }}
    />
  );
}

type MapCanvasProps = {
  mapId: MapId;
  mapType: MapMode;
  sessionToken?: string | null;
  canvasRef: RefObject<HTMLCanvasElement | null>;
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
  hubLinks?: HubLink[];
  centroids?: ProvinceCentroids | null;
  hoveredMarkerId?: string | null;
  hoveredNationId?: string | null;
  viewportCoordsRef?: MutableRefObject<MapPickViewport | null>;
  onMouseMove: (e: React.MouseEvent<Element>) => void;
  onMouseLeave: () => void;
  onClick: (e: React.MouseEvent<Element>) => void;
  isHoveringClickable?: boolean;
  /**
   * No subject layers are open, so the mode's overlays are exactly as first
   * shown and can come from the flattened tiles.
   */
  regionsAtDefault?: boolean;
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
  canvasRef,
  mapObjects,
  hoveredOverlay,
  selectedOverlay = null,
  hoveredFortZoc = null,
  cursorTooltip,
  labels = [],
  markers = [],
  wars = [],
  hubLinks = [],
  centroids = null,
  hoveredMarkerId = null,
  hoveredNationId = null,
  viewportCoordsRef,
  onMouseMove,
  onMouseLeave,
  onClick,
  isHoveringClickable = false,
  regionsAtDefault = false,
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
   * images. Until a pyramid is ready the single image is drawn as before.
   */
  const tilesAllowed = !sessionToken;
  const baseTiles = useTileManifest(mapId, "base", tilesAllowed).manifest;
  const rasterLayer =
    PROVINCE_RASTER_MODES.has(mapType) && showsLiveProvinceRaster(mapType, day)
      ? `mapdata-${mapType}`
      : null;
  const rasterTiles = useTileManifest(mapId, rasterLayer, tilesAllowed).manifest;

  /**
   * A region mode's overlays as first shown, flattened and tiled by the
   * backend. Switching mode then loads a few tiles instead of one image per
   * region (85 for counties). Once subject layers are open the per-region
   * images take over again, since the flattened picture no longer matches.
   */
  const regionLayer =
    regionOverlay === undefined && REGION_TILE_MODES.has(mapType)
      ? `regions-${mapType}`
      : null;
  const regionTiles = useTileManifest(mapId, regionLayer, tilesAllowed);
  const useRegionTiles = regionsAtDefault && regionTiles.manifest !== null;
  // Until the first answer, draw neither: guessing "no tiles" would start
  // dozens of overlay downloads that the tiles make pointless.
  const holdRegionOverlays =
    regionsAtDefault && regionLayer !== null && regionTiles.status === "loading";

  // Names wait for the colour under them, so a mode switch does not show
  // floating text over bare terrain for the moment the shapes take to land.
  const [regionTilesReadyKey, setRegionTilesReadyKey] = useState<string | null>(null);
  const regionTilesKey = regionTiles.manifest
    ? `${mapType}:${regionTiles.manifest.version}`
    : null;
  const labelsShown =
    !regionLayer ||
    !regionsAtDefault ||
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

  const devicePixelRatio =
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  // Zoomed out, realm overlays come as reduced copies: decoding a crop at
  // full size only to draw it a few pixels across is what the tiles fix for
  // the base map.
  const lod = overlayLod(viewport.displayScale, devicePixelRatio);

  /**
   * The pick canvas is read with `getImageData`, never seen. It used to sit
   * in the map layer at full map size (6400 px square, transparent), where
   * the browser still had to composite it at every zoom step. Detached, it is
   * just memory; a plain div takes its pointer events.
   */
  useLayoutEffect(() => {
    const canvas = document.createElement("canvas");
    (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = canvas;
    return () => {
      const ref = canvasRef as React.MutableRefObject<HTMLCanvasElement | null>;
      if (ref.current === canvas) ref.current = null;
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [canvasRef]);

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
   * The four modes drawn as a full-map raster over the base map rather than as
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
          className="map-tooltip pointer-events-none fixed z-50 max-w-xs px-3 py-1.5"
          style={{
            left: cursorTooltip.x + 14,
            top: cursorTooltip.y + 14,
          }}
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
        transformTransition={viewport.transformTransition}
        cursorClassName={interactionCursor}
        isPanning={viewport.isPanning}
        fill={fill}
        capturesTouch
      >
        {baseTiles ? (
          <TileLayer
            manifest={baseTiles}
            tileUrl={(level, x, y) =>
              mapApiUrl(`/${mapId}/tiles/base/${baseTiles.version}/${level}/${x}/${y}.webp`)
            }
            view={tileView}
            // Past one screen pixel per map pixel, show the map's own pixels
            // sharp rather than smeared.
            className={pixelatedClass(viewport.displayScale)}
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
              manifest={rasterTiles}
              tileUrl={(level, x, y) =>
                mapApiUrl(
                  `/${mapId}/tiles/mapdata-${mapType}/${rasterTiles.version}/${level}/${x}/${y}.webp`
                )
              }
              view={tileView}
              className={pixelatedClass(viewport.displayScale)}
              style={{ opacity: PROVINCE_MODE_OVERLAY_OPACITY }}
            />
          ) : liveProvinceRaster ? (
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
            manifest={regionTiles.manifest}
            tileUrl={(level, x, y) =>
              mapApiUrl(
                `/${mapId}/tiles/regions-${mapType}/${regionTiles.manifest!.version}/${level}/${x}/${y}.webp`
              )
            }
            view={tileView}
            style={{ opacity: DRILL_STACK_OVERLAY_OPACITY }}
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
            opacity={0.8}
            alt="Selected region"
            lod={lod}
            imageClassName="map-selected-region"
            imageStyle={selectedOutlineStyle(viewport.displayScale)}
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
        {isMarkerMapMode(mapType) && hubLinks.length > 0 && (
          <SupplyLinkLayer
            links={hubLinks}
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
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            zIndex: 15,
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
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onClick={(event) => {
            if (viewport.consumeDragClick()) return;
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
