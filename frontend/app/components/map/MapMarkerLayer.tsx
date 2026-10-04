import { memo, useMemo } from "react";

import type { MapMode } from "./types";
import {
  MARKER_HOVER_SCALE,
  MARKER_HOVER_TRANSITION,
  MARKER_ICON_HOVER_GLOW,
  MARKER_LABEL_GAP,
  MARKER_LAYER_Z_ABOVE_LABELS,
  MARKER_LAYER_Z_HOVERED,
  MARKER_VISIBILITY_TRANSITION,
  isMarkerMapMode,
  markerLabelTextStyle,
  markerLayout,
  markerZoomScale,
  hiddenMarkerLabels,
  resolveMarkerImageSrc,
  shouldShowMapMarker,
  type MapMarker,
} from "../../lib/mapMarkers";

type MapMarkerLayerProps = {
  markers: MapMarker[];
  hoveredMarkerId?: string | null;
  mapW: number;
  mapH: number;
  mapType: MapMode;
  displayScale: number;
  /** Base pins render above faction labels; hovered pin renders above those. */
  layer: "base" | "hovered";
  /**
   * Skips the zoom-size gate and draws every entry at full opacity.
   *
   * For the timelapse studio, where every layer on screen is one the user
   * ticked on: a layer that hides itself at the zoom they are viewing at is
   * simply the layer they asked for not being there. The live map passes
   * nothing — it has no layer toggles, so the gate is the only thing keeping
   * several hundred chips off a world-zoom view, and its hover picking filters
   * on the same predicate.
   */
  alwaysVisible?: boolean;
};

export default memo(MapMarkerLayer);

function MapMarkerLayer({
  markers,
  hoveredMarkerId = null,
  mapW,
  mapH,
  mapType,
  displayScale,
  layer,
  alwaysVisible = false,
}: MapMarkerLayerProps) {
  const layerMarkers = useMemo(() => {
    if (layer === "hovered") {
      if (!hoveredMarkerId) return [];
      const hovered = markers.find((marker) => marker.id === hoveredMarkerId);
      return hovered ? [hovered] : [];
    }
    if (!hoveredMarkerId) return markers;
    return markers.filter((marker) => marker.id !== hoveredMarkerId);
  }, [markers, hoveredMarkerId, layer]);

  if (!isMarkerMapMode(mapType) || !layerMarkers.length || !mapW || !mapH) {
    return null;
  }

  // Over the full list, not this layer's slice, so both layers (and hover)
  // agree on which names were thinned out.
  const hiddenLabels = alwaysVisible
    ? new Set<string>()
    : hiddenMarkerLabels(markers, displayScale);

  const layerZ =
    layer === "hovered" ? MARKER_LAYER_Z_HOVERED : MARKER_LAYER_Z_ABOVE_LABELS;

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 h-full w-full overflow-visible"
      style={{ zIndex: layerZ }}
      aria-hidden
    >
      {layerMarkers.map((marker) => {
        const layout = markerLayout(
          marker.mapX,
          marker.mapY,
          marker.markerSize,
          marker.kind,
          markerZoomScale(displayScale)
        );
        const visible =
          alwaysVisible || shouldShowMapMarker(marker, displayScale);
        const hovered = hoveredMarkerId === marker.id;
        const baseScale = marker.baseScale ?? 1;
        const scale = baseScale * (hovered ? MARKER_HOVER_SCALE : 1);
        const src = resolveMarkerImageSrc(marker.kind, marker.markerSize);
        // Hover always names a pin, even one whose label gave way to a
        // more prominent neighbour.
        const showLabel =
          hovered || (!marker.showLabelOnlyOnHover && !hiddenLabels.has(marker.id));
        const iconOffset = (layout.size - layout.iconSize) / 2;
        const ringSize = layout.iconSize * 1.2;

        return (
          <div
            key={marker.id}
            title={marker.title}
            className="absolute overflow-visible"
            style={{
              left: layout.imageX,
              top: layout.imageY,
              width: layout.size,
              opacity: visible ? 1 : 0,
              transform: `scale(${scale})`,
              transformOrigin: `${layout.size / 2}px ${layout.size / 2}px`,
              transition: `${MARKER_VISIBILITY_TRANSITION}, ${MARKER_HOVER_TRANSITION}`,
            }}
          >
            {marker.highlightRing ? (
              <div
                className="absolute rounded-full"
                style={{
                  left: iconOffset + (layout.iconSize - ringSize) / 2,
                  top: iconOffset + (layout.iconSize - ringSize) / 2,
                  width: ringSize,
                  height: ringSize,
                  border: "3px solid color-mix(in srgb, #3dff3d 70%, transparent)",
                  boxShadow:
                    "0 0 8px color-mix(in srgb, #3dff3d 35%, transparent)",
                }}
              />
            ) : null}
            <img
              src={src}
              alt=""
              width={layout.iconSize}
              height={layout.iconSize}
              className="absolute block"
              style={{
                left: iconOffset,
                top: iconOffset,
                // Marker assets are 16x16 Minecraft textures blown up to
                // iconSize and then scaled again by the hover transform.
                // Smooth upscaling turns them to mush, so scale them
                // nearest-neighbour like the paint stamps do.
                imageRendering: "pixelated",
                // Hover feedback lives on the icon, not the label, so the
                // pixel art keeps its edges instead of being washed out.
                filter: hovered ? MARKER_ICON_HOVER_GLOW : undefined,
                transition: "filter 150ms ease-out",
              }}
              draggable={false}
            />
            {showLabel ? (
              <p
                className="absolute m-0 whitespace-nowrap"
                style={{
                  left: layout.size / 2,
                  top: layout.size + MARKER_LABEL_GAP,
                  transform: "translateX(-50%)",
                  ...markerLabelTextStyle({
                    fontSize: layout.fontSize,
                    highlighted: hovered,
                  }),
                }}
              >
                {marker.label}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
