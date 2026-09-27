/**
 * Paint mode: a per-browser war-planning annotation layer drawn on top of the
 * map. Everything here lives in *map pixel* coordinates — the same space as
 * `marker.mapX/mapY` and `screenToMap`'s output — so painted content stays
 * locked to the terrain through pan and zoom for free.
 *
 * Sizes are fixed in map pixels, authored as screen px at PAINT_REFERENCE_SCALE
 * and converted once (`paintMapPx`). Painted content therefore scales with the
 * map, exactly like the marker and label layers: a stroke always covers the
 * same stretch of terrain, so it reads large when zoomed in and small when
 * pulled back to see more of the world.
 */

export type PaintTool = "brush" | "arrow" | "eraser" | "stamp" | "text" | "move";

export type PaintColorId =
  | "attack"
  | "friendly"
  | "objective"
  | "warning"
  | "naval"
  | "note"
  | "earth";

/**
 * Stroke size, as a continuous value in the same reference screen pixels the
 * other size constants are authored in (see PAINT_REFERENCE_SCALE). Continuous
 * rather than a few named presets so the toolbar can offer a real slider.
 */
export type PaintWidth = number;

export type PaintStampIconId =
  | "fort"
  | "port"
  | "raid"
  | "battle"
  | "airport"
  | "airship_large"
  | "airship_small"
  | "iron_ship_small"
  | "iron_ship_medium"
  | "iron_ship_large"
  | "wood_ship_small"
  | "wood_ship_medium"
  | "wood_ship_large"
  | "settlement_small"
  | "settlement_large"
  | "capital_settlement_small"
  | "capital_settlement_large";

export type PaintPoint = { x: number; y: number };

type PaintShapeBase = {
  id: string;
  color: PaintColorId;
  createdAt: number;
  /**
   * Uniform size multiplier applied by the corner-drag resize. Absent means 1;
   * it is left optional so plans saved before resizing existed still load.
   * Geometry is scaled about the drag anchor at the same time, so a shape's
   * extent and its stroke/glyph size never drift apart.
   */
  scale?: number;
  /**
   * Clockwise rotation in degrees about the shape's own centre, applied at
   * render time. Absent means 0. Stored geometry always stays unrotated, so
   * hit-testing and resizing can work in the shape's local frame and only the
   * pointer has to be transformed.
   */
  rotation?: number;
};

export type PaintBrushShape = PaintShapeBase & {
  type: "brush";
  width: PaintWidth;
  points: PaintPoint[];
};

export type PaintArrowShape = PaintShapeBase & {
  type: "arrow";
  width: PaintWidth;
  from: PaintPoint;
  to: PaintPoint;
};

export type PaintStampShape = PaintShapeBase & {
  type: "stamp";
  icon: PaintStampIconId;
  at: PaintPoint;
  /**
   * Mirrored left-to-right about the stamp's own centre. The icons are
   * directional (ships, raids), so facing one the other way is often all a plan
   * needs. Absent means not mirrored.
   */
  flipX?: boolean;
};

export type PaintFontId = "sans" | "serif" | "mono";

/**
 * Label styling. Bold/italic/underline/strike mirror the game's own §l/§o/§n/§m
 * format codes, so a label reads the same way on the map as it does in chat.
 * All fields are optional: labels saved before styling existed fall back to
 * PAINT_TEXT_STYLE_DEFAULT.
 */
/**
 * Plate colour: "ink" tracks the label's own colour (the default), "dark" uses
 * the backing colour for maximum contrast, or pin it to any palette colour.
 */
export type PaintTextBgId = "ink" | "dark" | PaintColorId;

export type PaintTextStyle = {
  font: PaintFontId;
  bgColor: PaintTextBgId;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Opacity of the plate drawn behind the label, 0 (none) to 1. */
  bgOpacity: number;
};

export type PaintTextShape = PaintShapeBase &
  Partial<PaintTextStyle> & {
    type: "text";
    width: PaintWidth;
    at: PaintPoint;
    text: string;
  };

export type PaintShape =
  | PaintBrushShape
  | PaintArrowShape
  | PaintStampShape
  | PaintTextShape;

/**
 * Planning ink, drawn from the game's own hex palette (the one StringFormatter
 * renders into Minecraft colours) so a plan reads in the same visual language
 * as the campaign UI. Colours are named for what they mean on a war plan, not
 * for the hue, because that is how they get picked while planning.
 *
 * None of these appear in the map's own palette
 * (--tfmc-cream/stone/forest-deep/moss/mist/accent), so painted content still
 * cannot be mistaken for real map data. Drawn strokes are dashed on top of
 * that; placed objects are not, since a dashed ring around a castle icon just
 * reads as clutter.
 */
export const PAINT_COLORS: Record<PaintColorId, string> = {
  attack: "#e85d5d", // REMOVE / negative
  friendly: "#7fbd73", // SELECT / members
  objective: "#c9a0ff", // OBJECTIVE
  warning: "#e6c84a", // STATUS_HIGHLIGHT / WARNING
  naval: "#9ec8ff", // BATTLE_KIND
  note: "#d4c9ae", // VALUE
  earth: "#2a1f14", // dark brown, matches the map's province border ink
};

/** Shown on the swatch tooltips so the meaning is discoverable. */
export const PAINT_COLOR_LABELS: Record<PaintColorId, string> = {
  attack: "Attack",
  friendly: "Friendly",
  objective: "Objective",
  warning: "Warning",
  naval: "Naval",
  note: "Note",
  earth: "Earth",
};

export const PAINT_COLOR_IDS: PaintColorId[] = [
  "attack",
  "friendly",
  "objective",
  "warning",
  "naval",
  "note",
  "earth",
];

export const PAINT_WIDTH_MIN = 1;
export const PAINT_WIDTH_MAX = 5;
export const PAINT_WIDTH_STEP = 0.5;
export const PAINT_WIDTH_DEFAULT = 4;

export function clampPaintWidth(width: number): PaintWidth {
  if (!Number.isFinite(width)) return PAINT_WIDTH_DEFAULT;
  return Math.min(PAINT_WIDTH_MAX, Math.max(PAINT_WIDTH_MIN, width));
}

export const PAINT_STAMP_ICON_IDS: PaintStampIconId[] = [
  "fort",
  "port",
  "raid",
  "battle",
  "airport",
  "settlement_small",
  "settlement_large",
  "capital_settlement_small",
  "capital_settlement_large",
  "wood_ship_small",
  "wood_ship_medium",
  "wood_ship_large",
  "iron_ship_small",
  "iron_ship_medium",
  "iron_ship_large",
  "airship_small",
  "airship_large",
];

/** Dark under-stroke drawn beneath every ink stroke so it reads over sea and land alike. */
export const PAINT_INK_BACKING = "#0a1512";

/**
 * Label text is sized off the same slider as stroke width, so one control
 * covers "how big is this annotation". The ratio keeps the old default pairing
 * (a 4px stroke alongside 16px text).
 */
export const PAINT_TEXT_SIZE_RATIO = 4;

export const PAINT_DASH_SCREEN_PX: readonly number[] = [10, 7];
export const PAINT_BACKING_EXTRA_SCREEN_PX = 3;
export const PAINT_ARROW_HEAD_SCREEN_PX = 16;
export const PAINT_STAMP_SCREEN_PX = 34;
export const PAINT_ERASER_SCREEN_PX = 9;
/** Corner grab targets are chrome, so they keep a constant on-screen size. */
export const PAINT_HANDLE_SCREEN_PX = 9;
export const PAINT_FONTS: Record<PaintFontId, string> = {
  sans: "var(--font-source-sans), ui-sans-serif, system-ui, sans-serif",
  serif: "var(--font-fraunces), ui-serif, Georgia, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

export const PAINT_FONT_IDS: PaintFontId[] = ["sans", "serif", "mono"];

export const PAINT_FONT_LABELS: Record<PaintFontId, string> = {
  sans: "Sans",
  serif: "Serif",
  mono: "Mono",
};

export const PAINT_TEXT_BG_IDS: PaintTextBgId[] = ["ink", "dark", ...PAINT_COLOR_IDS];

export const PAINT_TEXT_BG_LABELS: Record<string, string> = {
  ink: "Match ink",
  dark: "Dark",
};

/** Resolves a plate colour id to a hex value, given the label's ink colour. */
export function paintTextBgColor(bg: PaintTextBgId, ink: PaintColorId): string {
  if (bg === "dark") return PAINT_INK_BACKING;
  if (bg === "ink") return PAINT_COLORS[ink];
  return PAINT_COLORS[bg] ?? PAINT_COLORS[ink];
}

function isTextBgId(value: unknown): value is PaintTextBgId {
  return (
    typeof value === "string" &&
    (value === "ink" || value === "dark" || value in PAINT_COLORS)
  );
}

export const PAINT_TEXT_STYLE_DEFAULT: PaintTextStyle = {
  font: "sans",
  bgColor: "ink",
  bold: true,
  italic: false,
  underline: false,
  strike: false,
  // Kept on a slider step so the thumb doesn't render off-position at rest.
  bgOpacity: 0.15,
};

export const PAINT_BG_OPACITY_MAX = 0.9;
export const PAINT_BG_OPACITY_STEP = 0.05;

export function clampPaintBgOpacity(value: number): number {
  if (!Number.isFinite(value)) return PAINT_TEXT_STYLE_DEFAULT.bgOpacity;
  return Math.min(PAINT_BG_OPACITY_MAX, Math.max(0, value));
}

/** Resolves a label's styling, filling in anything absent with the defaults. */
export function paintTextStyleOf(shape: PaintTextShape): PaintTextStyle {
  return {
    font: shape.font && shape.font in PAINT_FONTS ? shape.font : PAINT_TEXT_STYLE_DEFAULT.font,
    bgColor: isTextBgId(shape.bgColor) ? shape.bgColor : PAINT_TEXT_STYLE_DEFAULT.bgColor,
    bold: shape.bold ?? PAINT_TEXT_STYLE_DEFAULT.bold,
    italic: shape.italic ?? PAINT_TEXT_STYLE_DEFAULT.italic,
    underline: shape.underline ?? PAINT_TEXT_STYLE_DEFAULT.underline,
    strike: shape.strike ?? PAINT_TEXT_STYLE_DEFAULT.strike,
    bgOpacity:
      shape.bgOpacity === undefined
        ? PAINT_TEXT_STYLE_DEFAULT.bgOpacity
        : clampPaintBgOpacity(shape.bgOpacity),
  };
}

/** CSS properties shared by the rendered label and its inline editor. */
export function paintTextCss(style: PaintTextStyle): {
  fontFamily: string;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  textDecoration: string;
} {
  const decorations = [
    style.underline ? "underline" : null,
    style.strike ? "line-through" : null,
  ].filter(Boolean);
  return {
    fontFamily: PAINT_FONTS[style.font],
    fontWeight: style.bold ? 700 : 500,
    fontStyle: style.italic ? "italic" : "normal",
    textDecoration: decorations.length ? decorations.join(" ") : "none",
  };
}

/** Rotation snaps to this many degrees while Shift is held. */
export const PAINT_ROTATION_SNAP_DEGREES = 15;
export const PAINT_MIN_SHAPE_SCALE = 0.15;
export const PAINT_MAX_SHAPE_SCALE = 12;
export const PAINT_BRUSH_MIN_POINT_SCREEN_PX = 3;

export const PAINT_MAX_SHAPES = 2000;
export const PAINT_MAX_BRUSH_POINTS = 4000;
export const PAINT_MAX_TEXT_LENGTH = 120;

export function paintStampSrc(icon: PaintStampIconId): string {
  return `/${icon}.png`;
}

export function paintStampLabel(icon: PaintStampIconId): string {
  return icon.replace(/_/g, " ");
}

/**
 * The zoom level the size constants below are authored against. Painted content
 * is sized once, in map pixels, and then scales with the map like ink drawn
 * onto it — a stroke covers the same stretch of terrain at every zoom level, so
 * it reads large when zoomed in and small when pulled back to see more of the
 * world. This matches how the marker and label layers behave.
 *
 * The value is picked so painted furniture lands beside the real thing: a stamp
 * resolves to ~179 map px against the original 160px large settlement icon, and medium label text
 * to ~84 against MARKER_LABEL_FONT_LARGE (72). Nudge this one constant to scale
 * the whole annotation layer.
 */
export const PAINT_REFERENCE_SCALE = 0.19;

/**
 * Converts a size authored in screen pixels (at PAINT_REFERENCE_SCALE) into the
 * fixed map-pixel dimension actually used for rendering and hit-testing.
 */
export function paintMapPx(referenceScreenPx: number): number {
  return referenceScreenPx / PAINT_REFERENCE_SCALE;
}

export type PaintStrokeStyle = {
  strokeWidth: number;
  backingWidth: number;
  dashArray: string;
  stroke: string;
  backing: string;
};

export function paintStrokeStyle(
  width: PaintWidth,
  color: PaintColorId,
  scale = 1
): PaintStrokeStyle {
  const strokeWidth = paintMapPx(clampPaintWidth(width)) * scale;
  return {
    strokeWidth,
    backingWidth: strokeWidth + paintMapPx(PAINT_BACKING_EXTRA_SCREEN_PX) * scale,
    dashArray: PAINT_DASH_SCREEN_PX.map((d) => paintMapPx(d) * scale).join(" "),
    stroke: PAINT_COLORS[color],
    backing: PAINT_INK_BACKING,
  };
}

/**
 * Map-pixel dimensions that do not depend on a shape's own stroke width, so
 * geometry and rendering share one source of truth. Per-shape stroke and font
 * sizes come from `paintEffectiveSizes`.
 */
export type PaintSizesMapPx = {
  arrowHead: number;
  stamp: number;
};

const PAINT_SIZES_MAP_PX: PaintSizesMapPx = {
  arrowHead: paintMapPx(PAINT_ARROW_HEAD_SCREEN_PX),
  stamp: paintMapPx(PAINT_STAMP_SCREEN_PX),
};

export function paintSizesMapPx(): PaintSizesMapPx {
  return PAINT_SIZES_MAP_PX;
}

export function clampPaintScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(PAINT_MAX_SHAPE_SCALE, Math.max(PAINT_MIN_SHAPE_SCALE, scale));
}

/** A shape's resize multiplier, normalised for shapes saved before resizing existed. */
export function paintShapeScale(shape: PaintShape): number {
  return typeof shape.scale === "number" ? clampPaintScale(shape.scale) : 1;
}

export function normalizePaintRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** A shape's rotation, normalised for shapes saved before rotation existed. */
export function paintShapeRotation(shape: PaintShape): number {
  return typeof shape.rotation === "number" ? normalizePaintRotation(shape.rotation) : 0;
}

export type PaintEffectiveSizes = {
  strokeWidth: number;
  fontSize: number;
  arrowHead: number;
  stamp: number;
};

/**
 * One shape's dimensions after its own resize multiplier. Rendering and
 * hit-testing both go through this so a resized shape stays grabbable exactly
 * where it is drawn.
 */
export function paintEffectiveSizes(
  shape: PaintShape,
  sizes: PaintSizesMapPx = PAINT_SIZES_MAP_PX
): PaintEffectiveSizes {
  const scale = paintShapeScale(shape);
  const width = clampPaintWidth(
    shape.type === "stamp" ? PAINT_WIDTH_DEFAULT : shape.width
  );
  return {
    strokeWidth: paintMapPx(width) * scale,
    fontSize: paintMapPx(width * PAINT_TEXT_SIZE_RATIO) * scale,
    arrowHead: sizes.arrowHead * scale,
    stamp: sizes.stamp * scale,
  };
}

let paintIdCounter = 0;

export function createPaintShapeId(prefix = "s"): string {
  paintIdCounter += 1;
  return `paint-${prefix}-${Date.now().toString(36)}-${paintIdCounter.toString(36)}`;
}

function isPaintPoint(value: unknown): value is PaintPoint {
  const point = value as PaintPoint | null;
  return (
    !!point &&
    typeof point === "object" &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function isColorId(value: unknown): value is PaintColorId {
  return typeof value === "string" && value in PAINT_COLORS;
}

function isWidth(value: unknown): value is PaintWidth {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isStampIconId(value: unknown): value is PaintStampIconId {
  return (
    typeof value === "string" && (PAINT_STAMP_ICON_IDS as string[]).includes(value)
  );
}

/**
 * Narrow type guard used when reading localStorage. Deliberately strict per
 * shape so one corrupt entry can be dropped without losing the whole plan.
 */
export function isPaintShape(value: unknown): value is PaintShape {
  const shape = value as PaintShape | null;
  if (!shape || typeof shape !== "object") return false;
  if (typeof shape.id !== "string" || !shape.id) return false;
  if (!isColorId(shape.color)) return false;
  if (!Number.isFinite(shape.createdAt)) return false;
  if (shape.scale !== undefined && !(Number.isFinite(shape.scale) && shape.scale > 0)) {
    return false;
  }
  if (shape.rotation !== undefined && !Number.isFinite(shape.rotation)) return false;

  switch (shape.type) {
    case "brush":
      return (
        isWidth(shape.width) &&
        Array.isArray(shape.points) &&
        shape.points.length > 0 &&
        shape.points.every(isPaintPoint)
      );
    case "arrow":
      return isWidth(shape.width) && isPaintPoint(shape.from) && isPaintPoint(shape.to);
    case "stamp":
      if (shape.flipX !== undefined && typeof shape.flipX !== "boolean") return false;
      return isStampIconId(shape.icon) && isPaintPoint(shape.at);
    case "text": {
      if (!isWidth(shape.width) || !isPaintPoint(shape.at)) return false;
      if (typeof shape.text !== "string") return false;
      if (shape.font !== undefined && !(shape.font in PAINT_FONTS)) return false;
      for (const flag of [shape.bold, shape.italic, shape.underline, shape.strike]) {
        if (flag !== undefined && typeof flag !== "boolean") return false;
      }
      if (shape.bgOpacity !== undefined && !Number.isFinite(shape.bgOpacity)) return false;
      if (shape.bgColor !== undefined && !isTextBgId(shape.bgColor)) return false;
      return true;
    }
    default:
      return false;
  }
}
