import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getMapCoords,
  mapPixelToPickCanvas,
  type MapPickViewport,
} from "./useMapCoords";
import { useProvinceHover } from "./useProvinceHover";
import { useRegionHover } from "./useRegionHover";
import {
  provinceHoverBlocksRegionPick,
  resolveRegionAtPickPixel,
} from "./regionPick";
import type { MapId, MapMode, MapObject, RegionInfo, RegionRecord, FortMarker } from "../components/map/types";
import type { HoverOverlay } from "../components/map/types";
import type { MapMarker } from "../lib/mapMarkers";
import { filterVisibleMapMarkers, isMarkerMapMode, pickMapMarkerAt } from "../lib/mapMarkers";
import { lookupFortZocOverlay } from "../lib/fortZoc";
import type { ProvinceIdGrid } from "../lib/map/chroniclePaint";

type UseMapHoverProps = {
  mapId: MapId;
  mapType: MapMode;
  loading: boolean;
  regionData: RegionRecord | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  viewportCoordsRef: React.MutableRefObject<MapPickViewport | null>;
  guildNameCacheRef: React.MutableRefObject<Record<string, string>> | null;
  sessionToken?: string | null;
  setCursorTooltip: (tooltip: { x: number; y: number; text: string; hint?: string } | null) => void;
  setHoveredOverlay: (overlay: HoverOverlay | null) => void;
  setRegionInfo: (info: RegionInfo | null) => void;
  setSelectedRegionId: (id: string | null) => void;
  getHoverRegion: (
    mapType: string,
    mapId: string,
    regionId: string,
    regionData: RegionRecord
  ) => {
    regionId: string | null;
    imagePath: string | null;
    region: Record<string, unknown> | null;
    overlay?: HoverOverlay["overlay"];
  };
  mapDisplayName: string;
  mapObjects: MapObject[];
  markers?: MapMarker[];
  forts?: FortMarker[];
  setHoveredMarkerId?: (id: string | null) => void;
  setHoveredFortZoc?: (overlay: HoverOverlay | null) => void;
  /**
   * A chronicle day, or `null` for the live map. Passed straight through to
   * `useProvinceHover`, which uses it to stay off the live province endpoints.
   */
  day?: string | null;
  /**
   * The quarter-scale province id grid the chronicle already fetches. It is
   * the day path's replacement for `/province/{x},{y}/meta`: same grid the
   * pick canvas is painted from, so hover and pick cannot disagree.
   */
  chronicleGrid?: ProvinceIdGrid | null;
};

type PointerPosition = {
  clientX: number;
  clientY: number;
};

/**
 * Identity of the *drawn* state: which overlays are on, in order. Repaint keys
 * off this rather than the `mapObjects` array itself, which is rebuilt (new
 * object identities, same visibility) on every drill reset.
 *
 * Exported for the chronicle's client-painted ownership layer, which needs the
 * exact same "did what is visible change?" question answered.
 */
export function mapObjectsVisibilityKey(mapObjects: MapObject[]): string {
  return mapObjects
    .map((obj) => `${obj.id}:${obj.visible ? 1 : 0}`)
    .join("|");
}

export function useMapHover(props: UseMapHoverProps) {
  const {
    canvasRef,
    viewportCoordsRef,
    mapId,
    mapType,
    loading,
    regionData,
    setCursorTooltip,
    guildNameCacheRef,
    mapObjects,
    markers,
    forts,
  } = props;

  const propsRef = useRef(props);
  propsRef.current = props;

  const rgbToId = useMemo(() => {
    // `Object.create(null)` for consistency with every other wire-keyed map in
    // this feature. Not exploitable today — every read is a
    // `` `${r},${g},${b}` `` built from `getImageData`, which can never spell
    // `__proto__` — so this is hygiene, not a fix.
    const map: Record<string, string> = Object.create(null);
    if (!regionData) return map;

    for (const [id, region] of Object.entries(regionData)) {
      if (region.rgb) map[region.rgb] = id;
    }
    return map;
  }, [regionData]);

  /**
   * Map pixel -> stored province id, read from the chronicle's own grid.
   * Stable identity (reads through `propsRef`) so it never re-creates the
   * hover handler.
   */
  const resolveProvinceId = useCallback((x: number, y: number) => {
    const grid = propsRef.current.chronicleGrid;
    if (!grid) return null;
    const point = mapPixelToPickCanvas(
      x,
      y,
      propsRef.current.viewportCoordsRef.current?.mapSize,
      grid
    );
    if (!point) return null;
    const id = grid.ids[point.y * grid.width + point.x];
    // Id 0 is ocean / no province.
    return id ? id : null;
  }, []);

  const { handleProvinceHover } = useProvinceHover({
    mapId,
    mapType,
    setCursorTooltip,
    guildNameCacheRef,
    sessionToken: props.sessionToken,
    day: props.day ?? null,
    resolveProvinceId,
  });

  const { handleRegionHover, resetHoverCache } = useRegionHover({
    ...props,
    rgbToId,
  });

  const handleRegionHoverRef = useRef(handleRegionHover);
  const resetHoverCacheRef = useRef(resetHoverCache);
  handleRegionHoverRef.current = handleRegionHover;
  resetHoverCacheRef.current = resetHoverCache;

  const handleProvinceHoverRef = useRef(handleProvinceHover);
  handleProvinceHoverRef.current = handleProvinceHover;

  const rafRef = useRef<number | null>(null);
  const pendingEventRef = useRef<React.MouseEvent<HTMLCanvasElement> | null>(null);
  const lastPointerRef = useRef<PointerPosition | null>(null);
  const [isHoveringClickable, setIsHoveringClickable] = useState(false);

  const processHover = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const current = propsRef.current;
    if (current.loading) return;

    const canvas = current.canvasRef.current;
    if (!canvas) return;

    // Must match the pick canvas' own getContext options; this path calls
    // getImageData once per hover frame.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const coords = getMapCoords(
      event,
      canvas,
      current.mapId,
      current.viewportCoordsRef.current
    );
    if (!coords) {
      current.setCursorTooltip(null);
      current.setHoveredMarkerId?.(null);
      current.setHoveredFortZoc?.(null);
      current.setSelectedRegionId(null);
      setIsHoveringClickable(false);
      return;
    }

    const displayScale = current.viewportCoordsRef.current?.displayScale ?? 0;
    const visibleMarkers = current.markers?.length
      ? filterVisibleMapMarkers(current.markers, displayScale)
      : [];
    const markerHit = visibleMarkers.length
      ? pickMapMarkerAt(visibleMarkers, coords.x, coords.y)
      : null;
    current.setHoveredMarkerId?.(markerHit?.id ?? null);
    if (markerHit) {
      current.setCursorTooltip(null);
      current.setHoveredOverlay(null);
      current.setSelectedRegionId(null);
      resetHoverCacheRef.current();
      if (isMarkerMapMode(current.mapType)) {
        current.setHoveredFortZoc?.(
          lookupFortZocOverlay(markerHit, current.forts ?? [])
        );
      } else {
        current.setHoveredFortZoc?.(null);
      }
      setIsHoveringClickable(true);
      return;
    }

    current.setHoveredFortZoc?.(null);

    if (
      handleProvinceHoverRef.current(
        coords.x,
        coords.y,
        coords.screenX,
        coords.screenY
      )
    ) {
      if (provinceHoverBlocksRegionPick(current.mapType)) {
        current.setSelectedRegionId(null);
      }
      setIsHoveringClickable(false);
      return;
    }

    const pickPixel = mapPixelToPickCanvas(
      coords.x,
      coords.y,
      current.viewportCoordsRef.current?.mapSize,
      canvas
    );
    if (!pickPixel) {
      current.setCursorTooltip(null);
      current.setHoveredOverlay(null);
      current.setSelectedRegionId(null);
      setIsHoveringClickable(false);
      return;
    }

    const clickable = handleRegionHoverRef.current(
      ctx,
      pickPixel.x,
      pickPixel.y,
      coords.screenX,
      coords.screenY,
      current.setCursorTooltip
    );
    setIsHoveringClickable(clickable);
  }, []);

  const mapObjectsVisibility = useMemo(
    () => mapObjectsVisibilityKey(mapObjects),
    [mapObjects]
  );

  const fortsKey = useMemo(
    () => (forts ?? []).map((fort) => fort.id).join("|"),
    [forts]
  );

  useEffect(() => {
    if (loading) return;

    const pointer = lastPointerRef.current;
    if (!pointer) return;

    resetHoverCacheRef.current();
    processHover({
      clientX: pointer.clientX,
      clientY: pointer.clientY,
    } as React.MouseEvent<HTMLCanvasElement>);
  }, [loading, mapObjectsVisibility, fortsKey, markers?.length, processHover]);

  const onMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (loading) return;

    lastPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
    pendingEventRef.current = event;

    if (rafRef.current !== null) return;

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pendingEvent = pendingEventRef.current;
      if (!pendingEvent) return;
      processHover(pendingEvent);
    });
  };

  const onMouseLeave = () => {
    // Forget the pointer so the layer-change replay above cannot resurrect
    // hover for a cursor that is no longer over the map, and drop any frame
    // still queued from the last move.
    lastPointerRef.current = null;
    pendingEventRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    propsRef.current.setHoveredMarkerId?.(null);
    propsRef.current.setHoveredFortZoc?.(null);
    propsRef.current.setSelectedRegionId(null);
    setIsHoveringClickable(false);
  };

  const pickRegionAtEvent = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>): string | null => {
      const current = propsRef.current;
      if (current.loading || !current.regionData) return null;

      const canvas = current.canvasRef.current;
      if (!canvas) return null;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      const coords = getMapCoords(
        event,
        canvas,
        current.mapId,
        current.viewportCoordsRef.current
      );
      if (!coords) return null;

      const displayScale = current.viewportCoordsRef.current?.displayScale ?? 0;
      const visibleMarkers = current.markers?.length
        ? filterVisibleMapMarkers(current.markers, displayScale)
        : [];
      if (
        visibleMarkers.length &&
        pickMapMarkerAt(visibleMarkers, coords.x, coords.y)
      ) {
        return null;
      }

      if (provinceHoverBlocksRegionPick(current.mapType)) {
        return null;
      }

      const pickPixel = mapPixelToPickCanvas(
        coords.x,
        coords.y,
        current.viewportCoordsRef.current?.mapSize,
        canvas
      );
      if (!pickPixel) return null;

      const picked = resolveRegionAtPickPixel(
        ctx,
        pickPixel.x,
        pickPixel.y,
        rgbToId,
        current.getHoverRegion,
        current.mapType,
        current.mapId,
        current.regionData
      );
      return picked?.regionId ?? null;
    },
    [rgbToId]
  );

  return { onMouseMove, onMouseLeave, isHoveringClickable, pickRegionAtEvent };
}
