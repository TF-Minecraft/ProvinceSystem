import {
  useCallback,
  useEffect,
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
import {
  useMapViewport,
  type MapFocusInset,
} from "../../hooks/useMapViewport";
import type { FitMode, MapRect } from "../../lib/mapViewportMath";
import { useMapAssetUrl } from "../../hooks/useMapAssetUrl";
import type { MapPickViewport } from "../../hooks/useMapCoords";
import type { NationLabelSpec, ProvinceCentroids } from "../../lib/mapLabels";
import { mapApiPathFromUrl } from "@/lib/map/api";
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
 * A gilt rim around the selected region. The overlay sits inside the scaled
 * map, so the glow is sized in map pixels divided by the current scale to stay
 * a constant couple of screen pixels at every zoom.
 */
function selectedOutlineStyle(displayScale: number): React.CSSProperties {
  const px = displayScale > 0 ? 2 / displayScale : 0;
  const gilt = "#f5d27a";
  // Four unblurred offsets trace a crisp rim; the last, blurred and dark,
  // lifts it off light terrain.
  return {
    filter: [
      `drop-shadow(${px}px 0 0 ${gilt})`,
      `drop-shadow(-${px}px 0 0 ${gilt})`,
      `drop-shadow(0 ${px}px 0 ${gilt})`,
      `drop-shadow(0 -${px}px 0 ${gilt})`,
      `drop-shadow(0 0 ${px * 1.5}px rgb(0 0 0 / 0.8))`,
    ].join(" "),
  };
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
}) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const path = mapApiPathFromUrl(overlay.url);
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
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave: () => void;
  onClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  isHoveringClickable?: boolean;
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
  });

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

  useEffect(() => {
    viewport.resetViewport({ animated: true });
  }, [mapId, mapType, viewport.resetViewport]);

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
          <p className="whitespace-pre-line font-[family-name:var(--font-fraunces)] text-sm text-[var(--tfmc-parchment)]">
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
        transformStyle={viewport.transformStyle}
        transformTransition={viewport.transformTransition}
        cursorClassName={interactionCursor}
        isPanning={viewport.isPanning}
        fill={fill}
        capturesTouch
      >
        <MapAuthImage
          mapId={mapId}
          path={`/${mapId}/map`}
          sessionToken={sessionToken}
          alt="Map"
          className="pointer-events-none block h-full w-full"
          imgRef={(node) => {
            if (node?.complete) {
              syncNaturalMapSize(node);
            }
          }}
          onLoad={handleBaseMapLoad}
        />
        {showProvinceOverlay &&
          (liveProvinceRaster ? (
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
        {regionOverlay === undefined
          ? mapObjects
              .filter((obj) => obj.visible)
              .map((obj) => (
                <MapAuthImage
                  key={obj.id}
                  mapId={mapId}
                  path={`/${mapId}/regions/${mapType}/${obj.path}`}
                  sessionToken={sessionToken}
                  crossOrigin="anonymous"
                  alt={`Overlay ${obj.id}`}
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
        <LabelLayer
          labels={labels}
          mapW={mapSize.w}
          mapH={mapSize.h}
          displayScale={viewport.displayScale}
          hoveredNationId={hoveredNationId}
        />
        <MapMarkerLayer
          markers={markers}
          hoveredMarkerId={hoveredMarkerId}
          mapW={mapSize.w}
          mapH={mapSize.h}
          mapType={mapType}
          displayScale={viewport.displayScale}
          layer="hovered"
        />
        <canvas
          ref={canvasRef}
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
