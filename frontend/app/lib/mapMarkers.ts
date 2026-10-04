import type { CSSProperties } from "react";

import type { MapMode } from "../components/map/types";

export const MARKER_HOVER_EXPAND = 0.05;
export const MARKER_HOVER_SCALE = 1 + MARKER_HOVER_EXPAND;
export const MARKER_HOVER_TRANSITION = "transform 150ms ease-out";
export const MARKER_VISIBILITY_TRANSITION = "opacity 200ms ease-out";

export const MARKER_SMALL_PX = 100;
export const MARKER_LARGE_PX = 90;
export const MARKER_LABEL_FONT_SMALL = 48;
/** Guild seats: between a plain settlement and a realm capital. */
export const MARKER_LABEL_FONT_MEDIUM = 58;
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

/**
 * Markers are sized in map pixels, so they grow as the map zooms in. Past
 * this display scale they stop growing and hold their screen size, the way
 * map pins do on Google Maps: at 0.35 a small marker's icon is 35 px across.
 */
export const MARKER_MAX_DISPLAY_SCALE = 0.35;

/** Factor to shrink a marker's map-pixel size by so it holds its screen size. */
export function markerZoomScale(displayScale: number): number {
  return displayScale > MARKER_MAX_DISPLAY_SCALE
    ? MARKER_MAX_DISPLAY_SCALE / displayScale
    : 1;
}
export const INSTALLATION_ICON_SCALE = 0.75;
export const BATTLE_ICON_SCALE = INSTALLATION_ICON_SCALE;
// Marker chips sit above the serif nation labels (z-15) so a settlement name is
// never swallowed by the faction name painted across the same landmass.
export const MARKER_LAYER_Z_ABOVE_LABELS = 16;
export const MARKER_LAYER_Z_HOVERED = 17;

/**
 * How prominent a pin is. Settlements are sized by what they are, not by
 * population: realm capitals `large`, guild seats `medium`, everything else
 * `small`. Prominence also decides which label wins when two would overlap.
 */
export type MapMarkerSize = "small" | "medium" | "large";

export const INSTALLATION_MARKER_KINDS = new Set([
  "fort",
  "port",
  "airport",
  "train_station",
]);
export const BATTLE_MARKER_KIND = "battle";

export type MapMarker = {
  id: string;
  /** Tie-break between equally prominent labels; higher wins (population). */
  weight?: number;
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
  if (kind === "train_station") return "/train_station.png";
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
  if (markerSize === "medium") {
    return {
      size: MARKER_SMALL_PX,
      fontSize: MARKER_LABEL_FONT_MEDIUM,
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
  kind?: string,
  zoomScale = 1
): MapMarkerLayout {
  const dimensions = markerDimensions(markerSize);
  const size = dimensions.size * zoomScale;
  const fontSize = dimensions.fontSize * zoomScale;
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
    textY: imageY + size + MARKER_LABEL_GAP * zoomScale,
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
  y: number,
  displayScale = 0,
  /** Labels decluttered away: only their pins can be pointed at. */
  hiddenLabels: ReadonlySet<string> = EMPTY_SET
): MapMarker | null {
  // Hit-test the marker at the size it is drawn, not its map-pixel size.
  const zoomScale = markerZoomScale(displayScale);
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i];
    const layout = markerLayout(
      marker.mapX,
      marker.mapY,
      marker.markerSize,
      marker.kind,
      zoomScale
    );
    const bounds = markerHitBounds(
      layout,
      marker.label,
      !marker.showLabelOnlyOnHover && !hiddenLabels.has(marker.id)
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

const EMPTY_SET: ReadonlySet<string> = new Set();

const SIZE_RANK: Record<MapMarkerSize, number> = { large: 0, medium: 1, small: 2 };

/** Screen gap kept between labels, in pixels. */
const LABEL_CLEARANCE_PX = 3;

type Rect = { x: number; y: number; w: number; h: number };

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function iconRect(layout: MapMarkerLayout): Rect {
  const offset = (layout.size - layout.iconSize) / 2;
  return {
    x: layout.imageX + offset,
    y: layout.imageY + offset,
    w: layout.iconSize,
    h: layout.iconSize,
  };
}

/** Where a marker's name chip is drawn, in map pixels. */
export function markerLabelRect(layout: MapMarkerLayout, label: string): Rect {
  const chipPadX = layout.fontSize * (MARKER_CHIP_PAD_X_EM + MARKER_CHIP_BORDER_EM) * 2;
  const chipPadY = layout.fontSize * (MARKER_CHIP_PAD_Y_EM + MARKER_CHIP_BORDER_EM) * 2;
  const w = label.length * layout.fontSize * 0.55 + chipPadX;
  return {
    x: layout.mapX - w / 2,
    y: layout.textY,
    w,
    h: layout.fontSize + chipPadY,
  };
}

const declutterCache = new WeakMap<MapMarker[], { scale: number; hidden: Set<string> }>();

/**
 * Which visible markers' names to leave off so that no two overlap, the way
 * map sites thin labels out as you zoom out.
 *
 * Labels are placed most prominent first (capital, guild seat, settlement;
 * then the larger population), and a label that would cross a name already
 * placed, or another pin, is dropped. Its pin stays, and zooming in brings the
 * name back once there is room. Cached per marker list and scale so the layer
 * that draws the labels and the hover that hit-tests them always agree.
 */
export function hiddenMarkerLabels(markers: MapMarker[], displayScale: number): Set<string> {
  const cached = declutterCache.get(markers);
  if (cached && cached.scale === displayScale) return cached.hidden;

  const hidden = new Set<string>();
  if (displayScale > 0) {
    const zoomScale = markerZoomScale(displayScale);
    const pad = LABEL_CLEARANCE_PX / displayScale;
    const visible = filterVisibleMapMarkers(markers, displayScale);
    const layouts = new Map(
      visible.map((marker) => [
        marker.id,
        markerLayout(marker.mapX, marker.mapY, marker.markerSize, marker.kind, zoomScale),
      ])
    );
    const ordered = [...visible].sort(
      (a, b) =>
        // Hover-only pins (installations, battles) carry no label to place;
        // their icons go first so no name is laid over them.
        Number(!a.showLabelOnlyOnHover) - Number(!b.showLabelOnlyOnHover) ||
        SIZE_RANK[a.markerSize ?? "small"] - SIZE_RANK[b.markerSize ?? "small"] ||
        (b.weight ?? 0) - (a.weight ?? 0) ||
        a.label.localeCompare(b.label)
    );

    // A label gives way only to names and pins placed before it, i.e. ones at
    // least as prominent. A capital's name may run over a hamlet's pin; a
    // hamlet's name never covers the capital.
    const placedLabels: Rect[] = [];
    const placedIcons: Rect[] = [];
    for (const marker of ordered) {
      const layout = layouts.get(marker.id)!;
      if (!marker.showLabelOnlyOnHover && marker.label) {
        const base = markerLabelRect(layout, marker.label);
        const rect = { x: base.x - pad, y: base.y - pad, w: base.w + pad * 2, h: base.h + pad * 2 };
        const blocked =
          placedLabels.some((other) => overlaps(rect, other)) ||
          placedIcons.some((icon) => overlaps(rect, icon));
        if (blocked) hidden.add(marker.id);
        else placedLabels.push(rect);
      }
      placedIcons.push(iconRect(layout));
    }
  }

  declutterCache.set(markers, { scale: displayScale, hidden });
  return hidden;
}

