import type { CSSProperties } from "react";

import type { MapMode } from "../components/map/types";

export const MARKER_HOVER_EXPAND = 0.05;
export const MARKER_HOVER_SCALE = 1 + MARKER_HOVER_EXPAND;
export const MARKER_HOVER_TRANSITION = "transform 150ms ease-out";
export const MARKER_VISIBILITY_TRANSITION = "opacity 200ms ease-out";

export const MARKER_SMALL_PX = 100;
/** 75% of the original 160px large settlement icon. */
export const MARKER_LARGE_PX = 120;
export const MARKER_LABEL_FONT_SMALL = 48;
export const MARKER_LABEL_FONT_LARGE = 72;
export const MARKER_LABEL_GAP = 2;
export const MARKER_LABEL_COLOR = "var(--tfmc-cream)";

/**
 * Marker names render as small chips instead of bare map text so they read as a
 * different layer from the serif nation labels they sit on top of. Chip metrics
 * are in `em` because the label font size lives in map space and is scaled by
 * the viewport transform.
 */
export const MARKER_CHIP_BG =
  "color-mix(in srgb, var(--tfmc-forest-deep) 88%, transparent)";
export const MARKER_CHIP_BG_HOVER =
  "color-mix(in srgb, var(--tfmc-forest) 92%, transparent)";
export const MARKER_CHIP_BORDER =
  "color-mix(in srgb, var(--tfmc-stone) 30%, transparent)";
export const MARKER_CHIP_BORDER_HOVER = "var(--tfmc-accent)";
export const MARKER_CHIP_PAD_X_EM = 0.5;
export const MARKER_CHIP_PAD_Y_EM = 0.18;
export const MARKER_CHIP_RADIUS_EM = 0.12;
export const MARKER_CHIP_BORDER_EM = 0.035;
export const MARKER_CHIP_TRANSITION =
  "background-color 150ms ease-out, border-color 150ms ease-out";
export const MARKER_ICON_HOVER_GLOW =
  "drop-shadow(0 0 6px color-mix(in srgb, var(--tfmc-accent) 45%, transparent))";
export const MARKER_LABEL_MIN_SCREEN_PX = 9;
export const INSTALLATION_ICON_SCALE = 0.75;
export const BATTLE_ICON_SCALE = INSTALLATION_ICON_SCALE;
// Marker chips sit above the serif nation labels (z-15) so a settlement name is
// never swallowed by the faction name painted across the same landmass.
export const MARKER_LAYER_Z_ABOVE_LABELS = 16;
export const MARKER_LAYER_Z_HOVERED = 17;

export type MapMarkerSize = "small" | "large";

export const INSTALLATION_MARKER_KINDS = new Set(["fort", "port", "airport"]);
export const BATTLE_MARKER_KIND = "battle";

export type MapMarker = {
  id: string;
  kind: string;
  markerSize?: MapMarkerSize;
  mapX: number;
  mapY: number;
  label: string;
  title: string;
  /** Installation pins hide their label until hovered. */
  showLabelOnlyOnHover?: boolean;
  /** Optional base scale for highlighted pins (e.g. next campaign battle). */
  baseScale?: number;
  /** Optional ring behind icon for next campaign battle. */
  highlightRing?: boolean;
};

export function isBattleMarkerKind(kind: string | undefined): boolean {
  return kind === BATTLE_MARKER_KIND;
}

export function isInstallationMarkerKind(kind: string | undefined): boolean {
  return kind != null && INSTALLATION_MARKER_KINDS.has(kind);
}

export function isMarkerMapMode(mapType: MapMode): boolean {
  return mapType === "nation";
}

export function markerVisibilityScreenPx(
  marker: MapMarker,
  displayScale: number
): number {
  if (displayScale <= 0) return 0;
  const { size, fontSize } = markerDimensions(marker.markerSize);
  if (marker.showLabelOnlyOnHover || isInstallationMarkerKind(marker.kind) || isBattleMarkerKind(marker.kind)) {
    return size * markerIconScale(marker.kind) * displayScale;
  }
  return fontSize * displayScale;
}

export function shouldShowMapMarker(
  marker: MapMarker,
  displayScale: number
): boolean {
  return (
    markerVisibilityScreenPx(marker, displayScale) >= MARKER_LABEL_MIN_SCREEN_PX
  );
}

export function filterVisibleMapMarkers(
  markers: MapMarker[],
  displayScale: number
): MapMarker[] {
  return markers.filter((marker) => shouldShowMapMarker(marker, displayScale));
}

export function markerIconScale(kind: string | undefined): number {
  if (isBattleMarkerKind(kind) || isInstallationMarkerKind(kind)) {
    return BATTLE_ICON_SCALE;
  }
  return 1;
}

export function markerLabelTextStyle(options: {
  fontSize: number;
  highlighted: boolean;
}): CSSProperties {
  const { fontSize, highlighted } = options;
  return {
    fontSize,
    lineHeight: 1,
    // Sans keeps marker names in the site's body voice, so they never read as
    // more nation labels when the two overlap.
    fontFamily: "var(--font-source-sans), system-ui, sans-serif",
    fontWeight: 600,
    color: MARKER_LABEL_COLOR,
    backgroundColor: highlighted ? MARKER_CHIP_BG_HOVER : MARKER_CHIP_BG,
    // Floors keep the chip outline from collapsing to a sub-pixel hairline at
    // the zoom levels where markers are smallest.
    border: `max(1px, ${MARKER_CHIP_BORDER_EM}em) solid ${
      highlighted ? MARKER_CHIP_BORDER_HOVER : MARKER_CHIP_BORDER
    }`,
    borderRadius: `max(2px, ${MARKER_CHIP_RADIUS_EM}em)`,
    padding: `${MARKER_CHIP_PAD_Y_EM}em ${MARKER_CHIP_PAD_X_EM}em`,
    transition: MARKER_CHIP_TRANSITION,
  };
}

export function resolveMarkerImageSrc(
  kind: string | undefined,
  markerSize: MapMarkerSize | undefined
): string {
  if (kind === "fort") return "/fort.png";
  if (kind === "port") return "/port.png";
  if (kind === "airport") return "/airport.png";
  if (kind === BATTLE_MARKER_KIND) return "/battle.png";

  const large = markerSize === "large";
  if (kind === "faction_capital" || kind === "guild_capital") {
    return large ? "/capital_settlement_large.png" : "/capital_settlement_small.png";
  }
  return large ? "/settlement_large.png" : "/settlement_small.png";
}

export function markerDimensions(markerSize: MapMarkerSize | undefined): {
  size: number;
  fontSize: number;
} {
  if (markerSize === "large") {
    return {
      size: MARKER_LARGE_PX,
      fontSize: MARKER_LABEL_FONT_LARGE,
    };
  }
  return {
    size: MARKER_SMALL_PX,
    fontSize: MARKER_LABEL_FONT_SMALL,
  };
}

export type MapMarkerLayout = {
  mapX: number;
  mapY: number;
  imageX: number;
  imageY: number;
  size: number;
  iconSize: number;
  fontSize: number;
  textY: number;
};

export function markerLayout(
  mapX: number,
  mapY: number,
  markerSize: MapMarkerSize | undefined,
  kind?: string
): MapMarkerLayout {
  const { size, fontSize } = markerDimensions(markerSize);
  const iconSize = size * markerIconScale(kind);
  const imageY = mapY - size / 2;
  return {
    mapX,
    mapY,
    imageX: mapX - size / 2,
    imageY,
    size,
    iconSize,
    fontSize,
    textY: imageY + size + MARKER_LABEL_GAP,
  };
}

export function markerHitBounds(
  layout: MapMarkerLayout,
  label: string,
  includeLabel = true
): { x: number; y: number; w: number; h: number } {
  if (!includeLabel) {
    const iconSize = layout.iconSize;
    const offset = (layout.size - iconSize) / 2;
    return {
      x: layout.imageX + offset,
      y: layout.imageY + offset,
      w: iconSize,
      h: iconSize,
    };
  }

  const chipPadX =
    layout.fontSize * (MARKER_CHIP_PAD_X_EM + MARKER_CHIP_BORDER_EM) * 2;
  const chipPadY =
    layout.fontSize * (MARKER_CHIP_PAD_Y_EM + MARKER_CHIP_BORDER_EM) * 2;
  const labelWidth = Math.max(
    layout.size,
    label.length * layout.fontSize * 0.55 + chipPadX
  );
  const labelHeight = layout.fontSize + chipPadY;
  const left = layout.mapX - labelWidth / 2;
  const top = layout.imageY;
  const bottom = Math.max(
    layout.imageY + layout.size,
    layout.textY + labelHeight
  );
  return {
    x: left,
    y: top,
    w: labelWidth,
    h: bottom - top,
  };
}

export function pickMapMarkerAt(
  markers: MapMarker[],
  x: number,
  y: number
): MapMarker | null {
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i];
    const layout = markerLayout(
      marker.mapX,
      marker.mapY,
      marker.markerSize,
      marker.kind
    );
    const bounds = markerHitBounds(
      layout,
      marker.label,
      !marker.showLabelOnlyOnHover
    );
    if (
      x >= bounds.x &&
      x < bounds.x + bounds.w &&
      y >= bounds.y &&
      y < bounds.y + bounds.h
    ) {
      return marker;
    }
  }
  return null;
}

export function markerHoverTransform(
  mapX: number,
  mapY: number,
  hovered: boolean
): string {
  const scale = hovered ? MARKER_HOVER_SCALE : 1;
  return `translate(${mapX} ${mapY}) scale(${scale}) translate(${-mapX} ${-mapY})`;
}
