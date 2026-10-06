"use client";

import { CHRONICLE_MEMORY_CEILING_BYTES } from "../../lib/map/chronicleBuild";
import { encodeGifSteps, type GifSourceFrame } from "@/app/lib/map/gif/encodeGif";
import {
  CHRONICLE_BORDER_INK_RGBA,
  expandChronicleBorderMask,
  type ChronicleBorderMask,
} from "../../lib/map/chronicleBorderMask";
import { CHRONICLE_ZOC_HATCH_RGBA } from "../../lib/map/chronicleFortControl";
import { CHRONICLE_OCCUPATION_SEAM_RGBA } from "../../lib/map/chronicleOccupation";
import {
  CHRONICLE_WATERMARK_TEXT,
  DEFAULT_CHRONICLE_WATERMARK_CORNER,
  arcGlyphPlacements,
  chronicleGifLabelArc,
  chronicleGifLabelLayout,
  chronicleGifMarkerLayout,
  chronicleGifTransform,
  chronicleWatermarkLayout,
  type ChronicleGifTransform,
  type ChronicleWatermarkCorner,
  type ChronicleWatermarkParts,
} from "../../lib/map/chronicleGifFrame";
import { LABEL_INK, type ProvinceCentroids } from "../../lib/mapLabels";
import { resolveMarkerImageSrc, type MapMarker } from "../../lib/mapMarkers";
import {
  buildWarCampaignPathPair,
  warLineStrokeStyle,
} from "../../lib/warCampaignLine";
import type { WarExport } from "../map/types";
import type { ChronicleFrameLayers } from "./chronicleLayers";
import {
  createChronicleCanvas,
  type AnyCanvas,
  type AnyCanvasContext,
} from "./chronicleRenderTarget";

/**
 * Flattens the studio's layer stack into one square raster per day. The GIF
 * always shows the whole map, never the pan/zoom viewport: an on-screen reading
 * position must not crop a shared timelapse. Only `chronicleGifTransform`
 * applies here; nothing reads `useMapViewport`.
 *
 * Export must not wedge the tab. Fourteen days at 1080² move 65 MB through
 * `getImageData` before encoding starts. Both frame-processing loops yield
 * between frames so progress repaints and Cancel stays clickable throughout
 * rendering and encoding. `encodeGifSteps` yields once per written frame, and
 * its caller awaits between steps to hand control back to the browser.
 *
 * This runs on the main thread, not a Worker, because the production Turbopack
 * build emits raw worker source; see `encodeGif.ts` for the build evidence.
 * Without per-frame transfers to a Worker, `sourceFrames` holds all RGBA frames
 * locally until encoding finishes. Before allocating any export canvas,
 * `size * size * 4 * frames.length` is checked against the studio's
 * `CHRONICLE_MEMORY_CEILING_BYTES`, just as `estimate.overCeiling` guards a
 * build. That bounds the array's pixel storage and rejects oversized requests
 * before a render pass can exhaust browser memory.
 *
 * There is no error boundary under `app/` to contain a page failure. Guard
 * day-file data, and require callers to catch the whole export and put errors
 * in export state so a failed button action cannot blank the page.
 */

export type ChronicleGifExportFrame = {
  day: string;
  /**
   * The day's painted fill, or null when no fill layer is on.
   *
   * One bitmap, not one per layer: ownership, occupation, league territory and
   * the prosperity heat are composited into a single province -> colour table
   * before the paint pass (`composeFillLut` in `ChronicleStudio`), so the stack
   * order the preview shows is baked into these pixels. That is deliberate —
   * this module would otherwise have to restate that order, and a fill layer
   * that shows on screen and vanishes from the export is exactly the bug a
   * second copy of the ordering invites.
   */
  image: ImageBitmap | null;
  layers: ChronicleFrameLayers;
};

export type ChronicleGifProgress =
  | { phase: "render"; completed: number; total: number; day: string }
  | { phase: "encode"; completed: number; total: number };

export type ChronicleGifExportOptions = {
  frames: ChronicleGifExportFrame[];
  /** Square edge of the exported GIF, from `CHRONICLE_GIF_SIZES`. */
  size: number;
  mapW: number;
  mapH: number;
  /**
   * The base map `<img>` already decoded in the page. Re-fetching it would cost
   * a second copy of a multi-megabyte authenticated asset for no gain; null
   * simply leaves the parchment out rather than failing the export.
   */
  baseImage: HTMLImageElement | null;
  /** The studio's `CHRONICLE_FILL_OPACITY`, so the GIF matches the preview. */
  fillOpacity: number;
  delayMs: number;
  loop: boolean;
  centroids: ProvinceCentroids | null;
  /**
   * Burns each frame's own day into the watermark's box, under the link.
   *
   * A GIF that leaves the studio carries no other trace of when it is: the day
   * lives in the Play panel, which does not travel with the file, so without
   * this a reader cannot tell which stretch of history they are watching. The
   * preview deliberately does not draw it — on screen the panel already says
   * the day, and painting it twice would be noise.
   */
  stampDay: boolean;
  /**
   * Which corner the logo and Discord line sit in, bottom-left by default.
   * Each piece can be left off on its own; the corner still applies to
   * whatever remains, including a date with neither of them.
   */
  watermarkCorner?: ChronicleWatermarkCorner;
  /**
   * The TFMC logo. Defaults to shown. Independent of the Discord line and of
   * the date stamp.
   */
  logo?: boolean;
  /**
   * The discord.gg/tfmc line. Defaults to shown. Independent of the logo and
   * of the date stamp.
   */
  discordLink?: boolean;
  onProgress?: (progress: ChronicleGifProgress) => void;
  signal?: AbortSignal;
};

/**
 * Palette literals from `app/internal/globals.css`. A canvas takes no CSS
 * variables and no `color-mix()`, so the two the export needs are restated
 * here; they are stable brand colours, not theme state.
 */
const CREAM = "#e8e4d9";
const INK_SCRIM = "rgba(15, 28, 22, 0.62)";
const MARKER_HALO = "rgba(15, 28, 22, 0.85)";
/** `LABEL_HALO` from `mapLabels`, as a translucent backing for dark serif ink. */
const LABEL_HALO_RGBA = "rgba(232, 228, 217, 0.7)";

const LOGO_SRC = "/logo.png";

export class ChronicleGifCancelled extends Error {
  constructor() {
    super("GIF export cancelled");
    this.name = "ChronicleGifCancelled";
  }
}

export function isChronicleGifCancelled(err: unknown): boolean {
  return err instanceof ChronicleGifCancelled;
}

function context2d(canvas: AnyCanvas): AnyCanvasContext {
  // Every frame ends in a `getImageData`, which is the one access pattern that
  // makes a GPU-backed canvas pay a full readback each time.
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
  } as CanvasRenderingContext2DSettings) as AnyCanvasContext | null;
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

/**
 * Lets the browser repaint and lets the user click Cancel.
 *
 * `scheduler.yield` when the browser has it — it resumes ahead of ordinary
 * tasks, so a long render or encode is not overtaken by every other timer on
 * the page — and a plain `setTimeout(0)` everywhere else.
 */
function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } })
    .scheduler;
  if (typeof scheduler?.yield === "function") {
    return scheduler.yield().catch(() => undefined);
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ChronicleGifCancelled();
}

/**
 * Marker icons are a handful of PNGs shared by hundreds of pins across every
 * day, so they are loaded once per export and kept. A failed load resolves to
 * null instead of rejecting: a missing icon is one pin without art, not a dead
 * export.
 */
function loadImages(sources: string[]): Promise<Map<string, HTMLImageElement>> {
  const unique = Array.from(new Set(sources));
  return Promise.all(
    unique.map(
      (src) =>
        new Promise<[string, HTMLImageElement | null]>((resolve) => {
          const img = new Image();
          img.onload = () => resolve([src, img]);
          img.onerror = () => resolve([src, null]);
          img.src = src;
        })
    )
  ).then((entries) => {
    const map = new Map<string, HTMLImageElement>();
    for (const [src, img] of entries) if (img) map.set(src, img);
    return map;
  });
}

/**
 * Borders arrive as a 1-bit mask at the province grid's own 1600² resolution.
 * They are expanded onto a scratch canvas at that resolution and scaled into
 * the export with smoothing on. The export is always smaller than that grid,
 * and a hard nearest-neighbour scale is what made the seam look pixelated next
 * to the live map's stroked overlay. The ink stays opaque so the softened edge
 * still reads as a border after the GIF palette is built.
 *
 * Consecutive days with an unchanged nation file share one mask object, so
 * caching on identity means a quiet stretch expands nothing at all. Each
 * overlay therefore needs its own instance: one shared scratch would re-expand
 * on every alternation and defeat that cache entirely.
 */
class MaskScratch {
  private canvas: AnyCanvas | null = null;
  private ctx: AnyCanvasContext | null = null;
  private imageData: ImageData | null = null;
  private drawn: ChronicleBorderMask | null = null;

  constructor(private readonly ink: readonly [number, number, number, number]) {}

  draw(
    target: AnyCanvasContext,
    mask: ChronicleBorderMask,
    transform: ChronicleGifTransform
  ): void {
    if (
      !this.canvas ||
      this.canvas.width !== mask.width ||
      this.canvas.height !== mask.height
    ) {
      this.canvas = createChronicleCanvas(mask.width, mask.height);
      this.ctx = context2d(this.canvas);
      this.imageData = null;
      this.drawn = null;
    }
    const ctx = this.ctx!;
    if (!this.imageData) {
      this.imageData = ctx.createImageData(mask.width, mask.height);
      this.drawn = null;
    }
    if (this.drawn !== mask) {
      expandChronicleBorderMask(mask, this.imageData.data, { ink: this.ink });
      ctx.putImageData(this.imageData, 0, 0);
      this.drawn = mask;
    }

    const smoothing = target.imageSmoothingEnabled;
    const quality = target.imageSmoothingQuality;
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = "high";
    target.drawImage(
      this.canvas as CanvasImageSource,
      transform.offsetX,
      transform.offsetY,
      transform.drawWidth,
      transform.drawHeight
    );
    target.imageSmoothingEnabled = smoothing;
    target.imageSmoothingQuality = quality;
  }
}

/**
 * Resolves the site's font stacks for canvas use. Next's font loader mints a
 * hashed family name into a CSS variable, and `ctx.font` will not read a
 * `var()` — it silently falls back to a 10 px sans, which is how a whole
 * export ends up in the wrong typeface with no error.
 */
function fontStacks(): { serif: string; sans: string } {
  let fraunces = "";
  let sourceSans = "";
  try {
    const style = getComputedStyle(document.body);
    fraunces = style.getPropertyValue("--font-fraunces").trim();
    sourceSans = style.getPropertyValue("--font-source-sans").trim();
  } catch {
    // A detached or restricted document: the generic stacks below still read.
  }
  return {
    serif: [fraunces, "Fraunces", "Georgia", "serif"].filter(Boolean).join(", "),
    sans: [sourceSans, "system-ui", "sans-serif"].filter(Boolean).join(", "),
  };
}

function drawWarLines(
  ctx: AnyCanvasContext,
  wars: WarExport[],
  centroids: ProvinceCentroids | null,
  transform: ChronicleGifTransform
): void {
  if (!wars.length) return;
  ctx.save();
  // Working in map coordinates keeps the stroke widths and dash arrays the SVG
  // layer uses meaningful: they are map-space numbers there too, scaled by the
  // `viewBox`, and restating them in export pixels would drift from that layer
  // the moment either changes.
  ctx.translate(transform.offsetX, transform.offsetY);
  ctx.scale(transform.scale, transform.scale);
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";

  for (const war of wars) {
    let pair;
    try {
      pair = buildWarCampaignPathPair(war, centroids);
    } catch {
      // One malformed war must not cost the other thirteen days their export.
      continue;
    }
    for (const [d, phase] of [
      [pair.remainingD, "remaining"],
      [pair.progressedD, "progressed"],
    ] as const) {
      if (!d) continue;
      const style = warLineStrokeStyle(phase);
      ctx.globalAlpha = style.opacity;
      ctx.strokeStyle = style.dashColor;
      ctx.lineWidth = style.dashWidth;
      ctx.setLineDash(
        style.dashArray
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0)
      );
      try {
        ctx.stroke(new Path2D(d));
      } catch {
        // `Path2D` rejects a malformed `d` by throwing; skip that stroke.
      }
    }
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawMarkers(
  ctx: AnyCanvasContext,
  markers: MapMarker[],
  icons: Map<string, HTMLImageElement>,
  transform: ChronicleGifTransform,
  sansStack: string
): void {
  if (!markers.length) return;

  // Icons first, then every chip, so a pin never lands on top of a name that a
  // neighbouring pin owns. `MapMarkerLayer` gets the same ordering for free
  // from the DOM's paint order plus its z-index.
  const chips: { marker: MapMarker; layout: NonNullable<ReturnType<typeof chronicleGifMarkerLayout>> }[] =
    [];

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const marker of markers) {
    const layout = chronicleGifMarkerLayout(transform, marker);
    if (!layout) continue;
    const icon = icons.get(resolveMarkerImageSrc(marker.kind, marker.markerSize));
    if (icon) {
      ctx.drawImage(icon, layout.iconX, layout.iconY, layout.iconSize, layout.iconSize);
    }
    if (!marker.showLabelOnlyOnHover && marker.label) {
      chips.push({ marker, layout });
    }
  }
  ctx.restore();

  if (!chips.length) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  for (const { marker, layout } of chips) {
    ctx.font = `600 ${layout.fontSize}px ${sansStack}`;
    // The on-screen chip is a rounded box with a border and a `color-mix`
    // background, none of which survives a 256-colour palette cleanly. A dark
    // halo does the same job — separating cream text from snow and desert —
    // in colours the quantiser already has to keep for the ink.
    ctx.strokeStyle = MARKER_HALO;
    ctx.lineWidth = layout.haloWidth;
    ctx.strokeText(marker.label, layout.labelCenterX, layout.labelBaselineY);
    ctx.fillStyle = CREAM;
    ctx.fillText(marker.label, layout.labelCenterX, layout.labelBaselineY);
  }
  ctx.restore();
}

function drawNationLabels(
  ctx: AnyCanvasContext,
  layers: ChronicleFrameLayers,
  transform: ChronicleGifTransform,
  serifStack: string
): void {
  if (!layers.labels.length) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  for (const label of layers.labels) {
    const layout = chronicleGifLabelLayout(transform, label);
    if (!layout) continue;
    const arc = chronicleGifLabelArc(transform, label);
    ctx.save();
    ctx.font = `500 ${layout.fontSize}px ${serifStack}`;
    // The SVG layer sets the name in bare ink and relies on the parchment
    // underneath. Painted ownership at 0.88 can be as dark as the ink, so the
    // export adds the pale halo the label module already defines rather than
    // letting a realm name vanish into its own colour.
    ctx.strokeStyle = LABEL_HALO_RGBA;
    ctx.fillStyle = LABEL_INK;
    ctx.lineWidth = layout.haloWidth;

    const glyphs = arc ? Array.from(arc.text) : [];
    const widths = glyphs.map((glyph) => ctx.measureText(glyph).width);
    const placements =
      arc && glyphs.length > 0 ? arcGlyphPlacements(arc, widths) : [];
    if (placements.length === glyphs.length && glyphs.length > 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      for (let index = 0; index < glyphs.length; index++) {
        const place = placements[index]!;
        ctx.save();
        ctx.translate(place.x, place.y);
        ctx.rotate(place.angleRad);
        ctx.strokeText(glyphs[index]!, 0, 0);
        ctx.fillText(glyphs[index]!, 0, 0);
        ctx.restore();
      }
    } else {
      ctx.translate(layout.centerX, layout.centerY);
      ctx.rotate(layout.angleRad);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeText(layout.text, 0, 0);
      ctx.fillText(layout.text, 0, 0);
    }
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The mark, in the chosen corner, and — when `day` is a usable string — the
 * frame's date in the same scrim box. The logo and the Discord line are each
 * optional; with both off and no date, nothing is drawn.
 *
 * The date is drawn exactly as the chronicle stores it — `YYYY-MM-DD`, the
 * key the day file is filed under. It is sortable, unambiguous and the same
 * for every reader; running it through `toLocaleDateString` would render the
 * exporter's locale into a file that then travels to people who read it the
 * other way round.
 *
 * `day` is null when the "stamp the date" option is off, or when the frame's
 * day is not a usable string. The box then has no reserved space for a line
 * that is not drawn. Dropping the logo or the Discord line does the same for
 * that piece.
 */
function drawWatermark(
  ctx: AnyCanvasContext,
  size: number,
  logo: HTMLImageElement | null,
  sansStack: string,
  day: string | null,
  corner: ChronicleWatermarkCorner,
  parts: ChronicleWatermarkParts
): void {
  const dateText = typeof day === "string" ? day.trim() : "";
  const hasDate = dateText.length > 0;
  const showLogo = parts.logo !== false;
  const showLink = parts.link !== false;
  if (!showLogo && !showLink && !hasDate) return;

  const layoutParts = { logo: showLogo, link: showLink };
  // Measured before the layout is computed: the scrim has to know how wide
  // each line turned out, and only the context can say.
  const probe = chronicleWatermarkLayout(
    size,
    0,
    hasDate ? 0 : null,
    corner,
    layoutParts
  );
  ctx.save();
  let textWidth = 0;
  if (showLink) {
    ctx.font = `600 ${probe.fontSize}px ${sansStack}`;
    textWidth = ctx.measureText(CHRONICLE_WATERMARK_TEXT).width;
  }

  let dateWidth: number | null = null;
  if (hasDate) {
    ctx.font = `600 ${probe.date!.fontSize}px ${sansStack}`;
    dateWidth = ctx.measureText(dateText).width;
  }

  const layout = chronicleWatermarkLayout(
    size,
    textWidth,
    dateWidth,
    corner,
    layoutParts
  );

  const { scrim } = layout;
  if (scrim.width > 0 && scrim.height > 0) {
    ctx.fillStyle = INK_SCRIM;
    ctx.beginPath();
    // Ocean and snow are the two extremes the mark has to survive; a soft dark
    // plate under it settles both without hiding the map behind a hard box.
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(scrim.x, scrim.y, scrim.width, scrim.height, scrim.radius);
    } else {
      ctx.rect(scrim.x, scrim.y, scrim.width, scrim.height);
    }
    ctx.fill();
  }

  if (showLogo && logo && layout.logoSize > 0) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      logo,
      layout.logoX,
      layout.logoY,
      layout.logoSize,
      layout.logoSize
    );
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  if (showLink) {
    ctx.font = `600 ${layout.fontSize}px ${sansStack}`;
    ctx.strokeStyle = MARKER_HALO;
    ctx.lineWidth = layout.haloWidth;
    ctx.strokeText(CHRONICLE_WATERMARK_TEXT, layout.textX, layout.textBaselineY);
    ctx.fillStyle = CREAM;
    ctx.fillText(CHRONICLE_WATERMARK_TEXT, layout.textX, layout.textBaselineY);
  }

  if (layout.date && hasDate) {
    ctx.font = `600 ${layout.date.fontSize}px ${sansStack}`;
    ctx.strokeStyle = MARKER_HALO;
    ctx.lineWidth = layout.date.haloWidth;
    ctx.strokeText(dateText, layout.date.textX, layout.date.textBaselineY);
    ctx.fillStyle = CREAM;
    ctx.fillText(dateText, layout.date.textX, layout.date.textBaselineY);
  }

  ctx.restore();
}

/**
 * Whether the base map is drawable into a canvas we can read back.
 *
 * A cross-origin image with no CORS grant taints the canvas silently — the
 * `drawImage` succeeds and only the later `getImageData` throws — and once
 * tainted a canvas can never be read again, so this has to be settled on a
 * throwaway probe before any real frame is drawn. The studio asks for the base
 * map with `crossOrigin="anonymous"` precisely so this probe passes; the probe
 * is what makes the deployment where it does not still produce a GIF.
 */
function baseMapIsReadable(
  baseImage: HTMLImageElement,
  transform: ChronicleGifTransform
): boolean {
  try {
    const probe = createChronicleCanvas(1, 1);
    const ctx = context2d(probe);
    ctx.drawImage(
      baseImage,
      transform.offsetX,
      transform.offsetY,
      transform.drawWidth,
      transform.drawHeight
    );
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

export type ChronicleGifExportResult = {
  bytes: Uint8Array;
  /**
   * True when the parchment had to be left out. A timelapse of ownership and
   * borders on a flat ground is still worth having, so this is something the
   * panel mentions rather than something the export fails on.
   */
  baseMapOmitted: boolean;
};

/**
 * Renders every day and encodes them into one GIF.
 *
 * Throws `ChronicleGifCancelled` when the signal fires. A base map that cannot
 * be read back is *not* a failure: it is detected up front and dropped from
 * the composite, and the caller is told through `baseMapOmitted`.
 */
export async function exportChronicleGif(
  options: ChronicleGifExportOptions
): Promise<ChronicleGifExportResult> {
  const {
    frames,
    size,
    mapW,
    mapH,
    baseImage,
    fillOpacity,
    delayMs,
    loop,
    centroids,
    stampDay,
    watermarkCorner = DEFAULT_CHRONICLE_WATERMARK_CORNER,
    logo: showLogoOption,
    discordLink,
    onProgress,
    signal,
  } = options;
  const showLogo = showLogoOption !== false;
  const showDiscordLink = discordLink !== false;
  const watermarkParts: ChronicleWatermarkParts = {
    logo: showLogo,
    link: showDiscordLink,
  };

  if (!frames.length) throw new Error("There are no built frames to export.");

  // Bound the RGBA array retained through encoding before allocating canvases:
  // reject an oversized request up front, not midway through rendering.
  const sourceBytes = size * size * 4 * frames.length;
  if (sourceBytes > CHRONICLE_MEMORY_CEILING_BYTES) {
    const mb = (bytes: number) => `${Math.ceil(bytes / (1024 * 1024))} MB`;
    throw new Error(
      `This export would hold ${mb(sourceBytes)} of frame pixels at once, more ` +
        `than this browser should — over the ${mb(CHRONICLE_MEMORY_CEILING_BYTES)} limit. ` +
        `Export fewer days or a smaller size.`
    );
  }

  const transform = chronicleGifTransform(mapW, mapH, size);
  const edge = transform.size;
  const canvas = createChronicleCanvas(edge, edge);
  const ctx = context2d(canvas);
  ctx.imageSmoothingQuality = "high";

  const baseUsable =
    baseImage != null && baseImage.complete && baseImage.naturalWidth > 0;
  const baseReady = baseUsable && baseMapIsReadable(baseImage, transform);

  const { serif, sans } = fontStacks();

  const iconSources = new Set<string>();
  if (showLogo) iconSources.add(LOGO_SRC);
  for (const frame of frames) {
    for (const marker of frame.layers.markers) {
      iconSources.add(resolveMarkerImageSrc(marker.kind, marker.markerSize));
    }
  }
  const images = await loadImages(Array.from(iconSources));
  const logo = showLogo ? (images.get(LOGO_SRC) ?? null) : null;
  // Custom faces are still swapping in on a cold load; measuring or drawing
  // before they settle bakes the fallback metrics into the file.
  try {
    await document.fonts?.ready;
  } catch {
    // No font manager (or it rejected) — the generic stacks are already usable.
  }

  const borders = new MaskScratch(CHRONICLE_BORDER_INK_RGBA);
  // Drawn in the same order the studio stacks them, so the exported frame and
  // the preview agree about what covers what.
  const fortControl = new MaskScratch(CHRONICLE_ZOC_HATCH_RGBA);
  const occupationSeam = new MaskScratch(CHRONICLE_OCCUPATION_SEAM_RGBA);

  // `encodeGifSteps` builds one palette across every frame, so the whole set
  // has to be in hand before the first encode step. `sourceBytes` above is the
  // size of exactly this array, checked before any of it was allocated.
  const sourceFrames: GifSourceFrame[] = [];

  // Everything from here through the finished bytes is one guarded region: a
  // throw anywhere in the render or encode loop (a tainted canvas, an abort, a
  // layer painter blowing up on bad day data) must drop the frames it has
  // rather than leave hundreds of megabytes of pixels reachable from a
  // half-finished export while the user retries.
  let bytes: Uint8Array;
  try {
    for (let i = 0; i < frames.length; i++) {
      throwIfAborted(signal);
      const frame = frames[i]!;
      onProgress?.({
        phase: "render",
        completed: i,
        total: frames.length,
        day: frame.day,
      });

      ctx.clearRect(0, 0, edge, edge);
      // The letterbox bars and any hole in the parchment read as the map's own
      // deep-forest ground rather than as transparency the GIF cannot express.
      ctx.fillStyle = "#0f1c16";
      ctx.fillRect(0, 0, edge, edge);

      if (baseReady) {
        ctx.drawImage(
          baseImage,
          transform.offsetX,
          transform.offsetY,
          transform.drawWidth,
          transform.drawHeight
        );
      }

      if (frame.image) {
        ctx.save();
        ctx.globalAlpha = fillOpacity;
        ctx.drawImage(
          frame.image,
          transform.offsetX,
          transform.offsetY,
          transform.drawWidth,
          transform.drawHeight
        );
        ctx.restore();
      }

      if (frame.layers.fortControl) {
        fortControl.draw(ctx, frame.layers.fortControl, transform);
      }
      if (frame.layers.borders) {
        borders.draw(ctx, frame.layers.borders, transform);
      }
      if (frame.layers.occupationSeam) {
        occupationSeam.draw(ctx, frame.layers.occupationSeam, transform);
      }
      drawWarLines(ctx, frame.layers.wars, centroids, transform);
      drawMarkers(ctx, frame.layers.markers, images, transform, sans);
      drawNationLabels(ctx, frame.layers, transform, serif);
      drawWatermark(
        ctx,
        edge,
        logo,
        sans,
        stampDay ? frame.day : null,
        watermarkCorner,
        watermarkParts
      );

      let pixels: ImageData;
      try {
        pixels = ctx.getImageData(0, 0, edge, edge);
      } catch {
        // The probe already cleared the one image that arrives from another
        // origin, so reaching here means something else tainted the canvas —
        // there is nothing to drop and retry, and a half-written GIF is worse
        // than a message.
        throw new Error(
          "The browser blocked reading this frame's pixels, so the GIF cannot be built."
        );
      }
      sourceFrames.push({ data: pixels.data, delayMs });

      // Between days, not after the last one: the encode loop below opens with
      // a yield of its own, so a yield here after the final day would only be
      // two in a row.
      if (i < frames.length - 1) await yieldToEventLoop();
    }

    throwIfAborted(signal);
    onProgress?.({ phase: "encode", completed: 0, total: frames.length });

    // One `await` before every step, the first one included. That first step
    // is the heaviest synchronous block in the whole pipeline — the global
    // palette scan reads all `frames.length` frames end to end, then frame 1's
    // own LZW pass runs — so without a yield ahead of it the "encode 0 / n"
    // progress posted just above would never reach the screen. (The palette
    // scan itself stays one unbroken block: it is inherently whole-set work,
    // so the pre-yield buys a repaint before it, not during it.)
    //
    // The generator's own `onProgress` fires just before each yield, so the
    // bar's number is already updated by the time the browser gets the thread
    // back to paint it — and `throwIfAborted` before each step is what makes
    // Cancel land during the encode instead of only during the render.
    const steps = encodeGifSteps({
      width: edge,
      height: edge,
      frames: sourceFrames,
      loop,
      onProgress: (completed, total) =>
        onProgress?.({ phase: "encode", completed, total }),
    });
    let step: IteratorResult<number, Uint8Array>;
    do {
      await yieldToEventLoop();
      throwIfAborted(signal);
      step = steps.next();
    } while (!step.done);
    bytes = step.value;
  } catch (err) {
    // Drop every frame this export is holding before the error leaves: the
    // array is the largest thing in the function by orders of magnitude, and a
    // retried export allocates a second one.
    sourceFrames.length = 0;
    // `throwIfAborted` already throws the right type, but a cancel that lands
    // inside some other awaited call would not; re-flagging keeps
    // `isChronicleGifCancelled` — and so `exportGif`'s cancel handling in
    // `ChronicleStudio.tsx` — the one place that decides what a cancelled
    // export looks like.
    if (signal?.aborted) throw new ChronicleGifCancelled();
    throw err;
  }

  return { bytes, baseMapOmitted: baseUsable && !baseReady };
}

/**
 * Hands the finished bytes to the browser as a download. Kept here beside the
 * encoder call so the studio never has to think about object URLs — and so the
 * revoke cannot be forgotten, which leaks the whole GIF for the tab's lifetime.
 */
export function downloadGif(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: "image/gif" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Deferred: revoking synchronously races the navigation the click started
    // and lands as a silently cancelled download in Chromium.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
