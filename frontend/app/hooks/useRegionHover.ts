import { useCallback, useRef } from "react";
import { buildRegionInfo } from "../components/map/regionInfo";
import { canDrillIntoRegion } from "../components/map/drillUtils";
import { resolveRegionAtPickPixel, resolveRegionById } from "./regionPick";
import type { PickSurface } from "../lib/map/pickSurface";
import type { HoverOverlay, MapMode, MapObject, RegionRecord } from "../components/map/types";

export function useRegionHover({
  mapId,
  mapType,
  regionData,
  rgbToId,
  getHoverRegion,
  setHoveredOverlay,
  setSelectedRegionId,
  mapDisplayName,
  mapObjects,
}: {
  mapId: string;
  mapType: MapMode;
  regionData: RegionRecord | null;
  rgbToId: Record<string, string>;
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
  setHoveredOverlay: (overlay: HoverOverlay | null) => void;
  setSelectedRegionId: (id: string | null) => void;
  mapDisplayName: string;
  mapObjects: MapObject[];
}) {
  const lastHoverKeyRef = useRef<string | null>(null);

  const resetHoverCache = useCallback(() => {
    lastHoverKeyRef.current = null;
  }, []);

  const clearHover = (
    setCursorTooltip: (tooltip: { x: number; y: number; text: string; hint?: string } | null) => void
  ) => {
    lastHoverKeyRef.current = null;
    setHoveredOverlay(null);
    setSelectedRegionId(null);
    setCursorTooltip(null);
  };

  const handleRegionHover = (
    surface: PickSurface,
    x: number,
    y: number,
    screenX: number,
    screenY: number,
    setCursorTooltip: (tooltip: { x: number; y: number; text: string; hint?: string } | null) => void,
    /** Hover this region rather than what the pick canvas has at (x, y). */
    regionIdOverride?: string
  ): boolean => {
    const picked = regionIdOverride
      ? resolveRegionById(regionIdOverride, getHoverRegion, mapType, mapId, regionData)
      : resolveRegionAtPickPixel(
          surface,
          x,
          y,
          rgbToId,
          getHoverRegion,
          mapType,
          mapId,
          regionData
        );

    if (!picked) {
      clearHover(setCursorTooltip);
      return false;
    }

    const { pickId, regionId, imagePath, overlay } = picked;

    setSelectedRegionId(regionId);

    const info = buildRegionInfo(
      regionId,
      regionData![regionId],
      mapType,
      mapDisplayName,
      regionData!
    );

    const tooltipText =
      mapType === "nation"
        ? info.title
        : `${info.title} · ${info.tier}`;

    const hintLines = [
      canDrillIntoRegion(regionId, regionData!, mapObjects)
        ? "Click for details and subjects"
        : "Click for details",
    ];

    setCursorTooltip({
      x: screenX,
      y: screenY,
      text: tooltipText,
      hint: hintLines.join("\n"),
    });

    const hoverKey = `${pickId}:${regionId}`;
    if (hoverKey !== lastHoverKeyRef.current) {
      lastHoverKeyRef.current = hoverKey;
      setHoveredOverlay(imagePath ? { url: imagePath, overlay } : null);
    }

    return true;
  };

  return { handleRegionHover, resetHoverCache };
}
