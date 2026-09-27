import type { NationLabelSpec } from "../mapLabels";
import { markerLayout, type MapMarker } from "../mapMarkers";

/**
 * The geometry half of the GIF rasterizer: everything that decides *where* a
 * thing lands in an exported frame, with nothing that touches a canvas.
 *
 * It lives apart from `chronicleGifExport.ts` because that module is pure DOM —
 * images, contexts, `getImageData` — and the vitest environment is node, so a
 * bug in this arithmetic would otherwise only ever be found by looking at a
 * finished GIF. The layout maths is exactly the part that fails silently: a
 * watermark half off the canvas or a marker drawn at map coordinates on an
 * export-sized canvas both produce a file, just the wrong one.
 *
 * The on-screen layers work in *map* pixels (6400x6400) and let the browser
 * scale them — SVG through a `viewBox`, markers through the viewport
 * transform. The GIF has no viewport, so every one of those coordinates has to
 * be pushed through one transform here.
 */

/** Square export edges offered in the playback panel. */
export const CHRONICLE_GIF_SIZES = [480, 720, 1080] as const;
export const DEFAULT_CHRONICLE_GIF_SIZE = 720;

/**
 * A marker icon shrunk by the same ratio as the map is a 7-px smudge at a
 * 480 export, and its name chip is smaller than the halo around it. The
 * on-screen layers solve this by hiding markers below `MARKER_LABEL_MIN_
 * SCREEN_PX`; a timelapse cannot hide the pins the user ticked on, so the
 * export floors them instead and accepts that the smallest size is drawn
 * slightly large relative to the map.
 */
export const MIN_GIF_MARKER_ICON_PX = 7;
export const MIN_GIF_MARKER_FONT_PX = 8;

/**
 * Below this a realm name is two or three ink-coloured pixels, which after GIF
 * colour quantisation is indistinguishable from dirt on the parchment. Such a
 * label is dropped rather than drawn as noise.
 */
export const MIN_GIF_LABEL_FONT_PX = 5;

/** GIF stores frame delays in hundredths of a second, so 10 ms is the quantum. */
export const GIF_DELAY_QUANTUM_MS = 10;

/**
 * Most decoders (and every browser) silently promote a 0 or 10 ms delay to
 * 100 ms, which would turn a 16x timelapse into a slideshow. 20 ms is the
 * fastest delay that is honoured, so that is the floor.
 */
export const MIN_GIF_DELAY_MS = 20;

export type ChronicleGifTransform = {
  /** Square edge of the export canvas. */
  size: number;
  /** Map pixels -> export pixels. */
  scale: number;
  offsetX: number;
  offsetY: number;
  drawWidth: number;
  drawHeight: number;
};

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Fits the whole map square into the export square, letterboxing whatever is
 * left over. This is `preserveAspectRatio="xMidYMid meet"` — the same rule the
 * label and war-line SVGs use — restated in numbers, so a map that is not
 * exactly square keeps its proportions instead of being stretched to fill.
 *
 * Degenerate map dimensions fall back to the export size rather than throwing:
 * `mapSize` starts at `MAP_BOUNDS` and is overwritten from the base image's
 * `naturalWidth`, so a base image that failed to load can legitimately leave a
 * zero here, and an export that comes out letterboxed beats a blank page.
 */
export function chronicleGifTransform(
  mapW: number,
  mapH: number,
  size: number
): ChronicleGifTransform {
  const edge = Math.max(1, Math.round(finite(size, DEFAULT_CHRONICLE_GIF_SIZE)));
  const w = finite(mapW, 0) > 0 ? mapW : edge;
  const h = finite(mapH, 0) > 0 ? mapH : edge;
  const scale = Math.min(edge / w, edge / h);
  const drawWidth = w * scale;
  const drawHeight = h * scale;
  return {
    size: edge,
    scale,
    offsetX: (edge - drawWidth) / 2,
    offsetY: (edge - drawHeight) / 2,
    drawWidth,
    drawHeight,
  };
}

export function chronicleGifMapX(
  transform: ChronicleGifTransform,
  x: number
): number {
  return transform.offsetX + x * transform.scale;
}

export function chronicleGifMapY(
  transform: ChronicleGifTransform,
  y: number
): number {
  return transform.offsetY + y * transform.scale;
}

export type ChronicleGifMarkerLayout = {
  iconX: number;
  iconY: number;
  iconSize: number;
  /** Chip text is centred on the pin, as `translateX(-50%)` does on screen. */
  labelCenterX: number;
  labelBaselineY: number;
  fontSize: number;
  haloWidth: number;
};

/**
 * One pin's export-space box, derived from `markerLayout` so the icon/label
 * split, the installation icon shrink and the label gap all come from the live
 * map's own rules rather than being restated here.
 *
 * Returns null for a marker whose coordinates are not finite. Marker payloads
 * are unvalidated day files, and `drawImage` with a NaN destination throws —
 * which, with no error boundary under `app/`, would take the studio down
 * mid-export.
 */
export function chronicleGifMarkerLayout(
  transform: ChronicleGifTransform,
  marker: MapMarker
): ChronicleGifMarkerLayout | null {
  if (!Number.isFinite(marker.mapX) || !Number.isFinite(marker.mapY)) {
    return null;
  }
  const layout = markerLayout(
    marker.mapX,
    marker.mapY,
    marker.markerSize,
    marker.kind
  );

  const iconSize = Math.max(
    MIN_GIF_MARKER_ICON_PX,
    layout.iconSize * transform.scale
  );
  const centerX = chronicleGifMapX(transform, layout.mapX);
  const centerY = chronicleGifMapY(transform, layout.mapY);
  const fontSize = Math.max(
    MIN_GIF_MARKER_FONT_PX,
    layout.fontSize * transform.scale
  );

  // `textY` is the *top* of the chip on screen. Canvas text is positioned from
  // its baseline, and the chip's own vertical padding sits above the glyphs, so
  // one font-size below the top lands the name where the chip's text sits.
  const labelTopY = chronicleGifMapY(transform, layout.textY);

  return {
    iconX: centerX - iconSize / 2,
    iconY: centerY - iconSize / 2,
    iconSize,
    labelCenterX: centerX,
    labelBaselineY: labelTopY + fontSize,
    fontSize,
    haloWidth: Math.max(2, fontSize * 0.28),
  };
}

export type ChronicleGifLabelLayout = {
  text: string;
  centerX: number;
  centerY: number;
  fontSize: number;
  angleRad: number;
  haloWidth: number;
};

/**
 * A realm name reduced to a straight rotated baseline.
 *
 * On screen the name is set along `pathD` with a `<textPath>`, which arches it
 * over the landmass; canvas has no equivalent and reimplementing glyph-by-glyph
 * arc placement for a 480-px GIF would cost far more than it shows. The chord
 * the arc was built around — `angleDeg` through `cx`/`cy` — is where the name
 * reads anyway, so the export sets it flat along that chord. Long names over
 * strongly curved territory drift a few pixels from where the preview put them;
 * nothing lands outside the realm.
 */
export function chronicleGifLabelLayout(
  transform: ChronicleGifTransform,
  label: NationLabelSpec
): ChronicleGifLabelLayout | null {
  if (
    !label.text ||
    !Number.isFinite(label.cx) ||
    !Number.isFinite(label.cy) ||
    !Number.isFinite(label.fontSize)
  ) {
    return null;
  }
  const fontSize = label.fontSize * transform.scale;
  if (fontSize < MIN_GIF_LABEL_FONT_PX) return null;

  const angleDeg = Number.isFinite(label.angleDeg) ? label.angleDeg : 0;
  return {
    text: label.text,
    centerX: chronicleGifMapX(transform, label.cx),
    centerY: chronicleGifMapY(transform, label.cy),
    fontSize,
    angleRad: (angleDeg * Math.PI) / 180,
    haloWidth: Math.max(1, fontSize * 0.16),
  };
}

export type ChronicleWatermarkDateLayout = {
  fontSize: number;
  /** Left edge of the date text — shares the link's `textX`. */
  textX: number;
  textBaselineY: number;
  haloWidth: number;
};

export type ChronicleWatermarkLayout = {
  logoX: number;
  logoY: number;
  logoSize: number;
  fontSize: number;
  textX: number;
  textBaselineY: number;
  haloWidth: number;
  scrim: { x: number; y: number; width: number; height: number; radius: number };
  /**
   * Second line inside the same box, directly below the link. Null when the
   * caller passed no `dateWidth` — the box then matches the link-only layout
   * exactly, with no reserved space for a line that is not being drawn.
   */
  date: ChronicleWatermarkDateLayout | null;
};

export const CHRONICLE_WATERMARK_TEXT = "discord.gg/tfmc";

/** Which pieces of the corner mark to reserve space for. Omitted means shown. */
export type ChronicleWatermarkParts = {
  /** The TFMC logo. */
  logo?: boolean;
  /** The discord.gg/tfmc line. */
  link?: boolean;
};

/**
 * The TFMC mark, bottom-left, sized as a fraction of the export edge so it
 * reads at 480 without swallowing the corner at 1080. Both the fraction and the
 * clamps matter: pure proportion makes the 480 logo 48 px (fine) but the 1080
 * one 108 px (a quarter of the visible coast), while a fixed size disappears at
 * the top end. The clamps are what keep it in the same *apparent* place at every
 * size.
 *
 * `textWidth` is measured by the caller — only a canvas context can measure a
 * font — and feeds the scrim only. Passing 0 (nothing measured yet) still
 * yields a valid box around the logo alone.
 *
 * `dateWidth` is optional: pass `null` or omit it (the "stamp the date"
 * checkbox off) and the box is exactly the link-only layout, unchanged from
 * before the date line existed. Pass a measured width to grow the box
 * downward-in-content-but-anchored-in-place — the whole block shifts up so its
 * bottom still sits `margin` above the edge, the same anchor the link-only box
 * uses — and add a second, smaller line below the link sharing its left edge.
 *
 * `parts` drops the logo, the Discord line, or both. A dropped piece takes no
 * column, so the scrim closes around whatever remains (including a date on its
 * own). Omitting `parts` is the full mark.
 */
export function chronicleWatermarkLayout(
  size: number,
  textWidth: number,
  dateWidth?: number | null,
  parts?: ChronicleWatermarkParts
): ChronicleWatermarkLayout {
  const showLogo = parts?.logo !== false;
  const showLink = parts?.link !== false;
  if (showLogo && showLink) {
    return chronicleFullWatermarkLayout(size, textWidth, dateWidth);
  }
  return chronicleReducedWatermarkLayout(
    size,
    textWidth,
    dateWidth,
    showLogo,
    showLink
  );
}

function chronicleFullWatermarkLayout(
  size: number,
  textWidth: number,
  dateWidth?: number | null
): ChronicleWatermarkLayout {
  const edge = Math.max(1, Math.round(finite(size, DEFAULT_CHRONICLE_GIF_SIZE)));
  const measured = Math.max(0, finite(textWidth, 0));

  const margin = Math.round(clamp(edge * 0.028, 10, 32));
  const logoSize = Math.round(clamp(edge * 0.1, 40, 100));
  const gap = Math.round(clamp(edge * 0.018, 6, 18));
  const fontSize = Math.round(clamp(edge * 0.034, 13, 32));

  // `dateWidth` being present (even 0, even junk) is the "on" signal — the
  // same probe-then-measure pattern the link text uses, where a caller passes
  // 0 before anything has been measured. Only `null`/`undefined` means off.
  const hasDate = dateWidth != null;
  // Smaller than the link so it reads as subordinate, but never so small the
  // quantiser eats it — the same floor the watermark's own font uses.
  const dateFontSize = hasDate ? Math.max(11, Math.round(fontSize * 0.68)) : 0;
  const lineGap = hasDate ? Math.round(clamp(fontSize * 0.28, 3, 10)) : 0;

  const logoX = margin;
  // Two columns, not three rows: the logo sits to the LEFT of a text column
  // that holds the link and, when stamping is on, the date directly beneath
  // it. The date's baseline therefore hangs off the link's, never off the
  // logo's bottom edge — that mistake is what pushed the date away from the
  // link and stretched the box. The row's bottom is anchored `margin` above
  // the canvas edge whatever it contains, and the row is as tall as its
  // tallest column; at every real export size the logo out-measures the
  // two-line stack, so turning the date on fills space beside the logo that
  // already existed rather than growing the scrim.
  const blockBottom = edge - margin;
  const textStackHeight = hasDate ? fontSize + lineGap + dateFontSize : fontSize;
  const rowHeight = Math.max(logoSize, textStackHeight);
  const rowTop = blockBottom - rowHeight;
  const logoY = rowTop + (rowHeight - logoSize) / 2;
  const textX = logoX + logoSize + gap;
  const dateMeasured = hasDate ? Math.max(0, finite(dateWidth, 0)) : 0;

  // Optical centring on the logo box: half a font size is the cap height's
  // midpoint closely enough, and 0.36 nudges for the descender-free text.
  // With a date the whole two-line stack is centred against the row instead,
  // so the pair reads as one block beside the logo.
  const stackTop = rowTop + (rowHeight - textStackHeight) / 2;
  const textBaselineY = hasDate
    ? stackTop + fontSize
    : logoY + logoSize / 2 + fontSize * 0.36;
  const dateTextBaselineY = hasDate ? textBaselineY + lineGap + dateFontSize : 0;

  const pad = Math.round(fontSize * 0.5);
  const scrimX = Math.max(0, logoX - pad);
  const scrimY = Math.max(0, Math.min(logoY, hasDate ? stackTop : logoY) - pad);
  const widestLine = Math.max(measured, hasDate ? dateMeasured : 0);
  const scrimRight = Math.min(edge, textX + widestLine + pad);
  const contentBottom = Math.max(
    logoY + logoSize,
    hasDate ? dateTextBaselineY + dateFontSize * 0.3 : 0
  );
  const scrimBottom = Math.min(edge, contentBottom + pad);

  return {
    logoX,
    logoY,
    logoSize,
    fontSize,
    textX,
    textBaselineY,
    haloWidth: Math.max(2, fontSize * 0.3),
    scrim: {
      x: scrimX,
      y: scrimY,
      width: Math.max(0, scrimRight - scrimX),
      height: Math.max(0, scrimBottom - scrimY),
      radius: Math.round(logoSize * 0.16),
    },
    date: hasDate
      ? {
          fontSize: dateFontSize,
          textX,
          textBaselineY: dateTextBaselineY,
          haloWidth: Math.max(1.5, dateFontSize * 0.3),
        }
      : null,
  };
}

/**
 * The same corner, with the logo, the Discord line, or both left out.
 *
 * A missing column is not an empty gap: the text starts at the margin when
 * there is no logo, and the scrim hugs the logo when there is no text. The
 * date, when stamped, stays the second line under a remaining Discord link
 * and becomes the only text line when that link is gone.
 */
function chronicleReducedWatermarkLayout(
  size: number,
  textWidth: number,
  dateWidth: number | null | undefined,
  showLogo: boolean,
  showLink: boolean
): ChronicleWatermarkLayout {
  const edge = Math.max(1, Math.round(finite(size, DEFAULT_CHRONICLE_GIF_SIZE)));
  const margin = Math.round(clamp(edge * 0.028, 10, 32));
  const fontSize = Math.round(clamp(edge * 0.034, 13, 32));
  const hasDate = dateWidth != null;
  const empty: ChronicleWatermarkLayout = {
    logoX: margin,
    logoY: edge - margin,
    logoSize: 0,
    fontSize,
    textX: margin,
    textBaselineY: edge - margin,
    haloWidth: Math.max(2, fontSize * 0.3),
    scrim: { x: 0, y: 0, width: 0, height: 0, radius: 0 },
    date: null,
  };
  if (!showLogo && !showLink && !hasDate) return empty;

  const dateFontSize = hasDate ? Math.max(11, Math.round(fontSize * 0.68)) : 0;
  const lineGap =
    showLink && hasDate ? Math.round(clamp(fontSize * 0.28, 3, 10)) : 0;
  const fullLogo = Math.round(clamp(edge * 0.1, 40, 100));
  const logoSize = showLogo ? fullLogo : 0;
  const hasText = showLink || hasDate;
  const gap =
    showLogo && hasText ? Math.round(clamp(edge * 0.018, 6, 18)) : 0;

  const logoX = margin;
  const blockBottom = edge - margin;
  const linkLine = showLink ? fontSize : 0;
  const textStackHeight = linkLine + lineGap + dateFontSize;
  const rowHeight = Math.max(logoSize, textStackHeight);
  const rowTop = blockBottom - rowHeight;
  const logoY = showLogo ? rowTop + (rowHeight - logoSize) / 2 : rowTop;
  const textX = logoX + (showLogo ? logoSize + gap : 0);
  const stackTop = rowTop + (rowHeight - textStackHeight) / 2;

  let textBaselineY: number;
  let dateTextBaselineY = 0;
  if (showLink && hasDate) {
    textBaselineY = stackTop + fontSize;
    dateTextBaselineY = textBaselineY + lineGap + dateFontSize;
  } else if (showLink && showLogo) {
    textBaselineY = logoY + logoSize / 2 + fontSize * 0.36;
  } else if (showLink) {
    textBaselineY = stackTop + fontSize * 0.8;
  } else if (hasDate && showLogo) {
    dateTextBaselineY = logoY + logoSize / 2 + dateFontSize * 0.36;
    textBaselineY = dateTextBaselineY;
  } else {
    dateTextBaselineY = stackTop + dateFontSize * 0.8;
    textBaselineY = dateTextBaselineY;
  }

  const measured = showLink ? Math.max(0, finite(textWidth, 0)) : 0;
  const dateMeasured = hasDate ? Math.max(0, finite(dateWidth, 0)) : 0;
  const pad = Math.round(fontSize * 0.5);
  const contentTop = showLogo
    ? hasText
      ? Math.min(logoY, stackTop)
      : logoY
    : stackTop;
  const contentRight =
    hasText
      ? textX + Math.max(measured, dateMeasured)
      : logoX + logoSize;
  const contentBottom = Math.max(
    showLogo ? logoY + logoSize : 0,
    showLink ? textBaselineY + fontSize * 0.25 : 0,
    hasDate ? dateTextBaselineY + dateFontSize * 0.3 : 0
  );
  const scrimX = Math.max(0, (showLogo ? logoX : textX) - pad);
  const scrimY = Math.max(0, contentTop - pad);
  const scrimRight = Math.min(edge, contentRight + pad);
  const scrimBottom = Math.min(edge, contentBottom + pad);

  return {
    logoX,
    logoY,
    logoSize,
    fontSize,
    textX,
    textBaselineY,
    haloWidth: Math.max(2, fontSize * 0.3),
    scrim: {
      x: scrimX,
      y: scrimY,
      width: Math.max(0, scrimRight - scrimX),
      height: Math.max(0, scrimBottom - scrimY),
      radius: Math.round((logoSize || fontSize) * 0.16),
    },
    date: hasDate
      ? {
          fontSize: dateFontSize,
          textX,
          textBaselineY: dateTextBaselineY,
          haloWidth: Math.max(1.5, dateFontSize * 0.3),
        }
      : null,
  };
}

/**
 * Playback speed (days per second) -> per-frame delay, in the 10 ms units GIF
 * actually stores. Rounding here rather than inside the encoder means the
 * number the panel could quote is the number the file holds.
 */
export function chronicleGifDelayMs(speed: number): number {
  const fps = finite(speed, 1);
  if (fps <= 0) return 1000;
  const raw = 1000 / fps;
  const quantised =
    Math.round(raw / GIF_DELAY_QUANTUM_MS) * GIF_DELAY_QUANTUM_MS;
  return Math.max(MIN_GIF_DELAY_MS, quantised);
}

/**
 * `adavaar-timelapse-2026-08-15-to-2026-08-26.gif`. The display name is
 * slugified rather than trusted: it is a lookup value today, but a filename
 * carrying a slash or a colon is silently rejected by the download on Windows.
 */
export function chronicleGifFilename(
  mapDisplayName: string,
  firstDay: string | null | undefined,
  lastDay: string | null | undefined
): string {
  const slug =
    (mapDisplayName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "map";
  const clean = (day: string | null | undefined) =>
    (day || "").replace(/[^0-9a-zA-Z-]/g, "");
  const start = clean(firstDay);
  const end = clean(lastDay);
  const span = start && end && start !== end ? `${start}-to-${end}` : start || end;
  return span ? `${slug}-timelapse-${span}.gif` : `${slug}-timelapse.gif`;
}
