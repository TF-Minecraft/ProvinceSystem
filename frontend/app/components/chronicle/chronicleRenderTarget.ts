import {
  paintChronicleFrameToImageData,
  type NationColorLut,
  type ProvinceIdGrid,
} from "../../lib/map/chroniclePaint";

/**
 * The canvas half of the build pass. Everything here is allocated once for a
 * whole timelapse: the q4 grid is 1600x1600, so a frame kept at grid resolution
 * is 10.2 MB of RGBA and a 25-day build would be 256 MB of it. Instead one
 * scratch canvas is painted at grid resolution, scaled down into a small output
 * canvas, and only the small canvas is handed out as an `ImageBitmap`.
 */

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type AnyCanvasContext =
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D;

export type ChronicleRenderTarget = {
  grid: ProvinceIdGrid;
  renderWidth: number;
  renderHeight: number;
  scratch: AnyCanvas;
  scratchCtx: AnyCanvasContext;
  imageData: ImageData;
  output: AnyCanvas;
  outputCtx: AnyCanvasContext;
  /** `transferToImageBitmap` is only on `OffscreenCanvas`. */
  transferable: boolean;
};

export function createChronicleCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: AnyCanvas): AnyCanvasContext {
  const ctx = canvas.getContext("2d") as AnyCanvasContext | null;
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

export function createChronicleRenderTarget(
  grid: ProvinceIdGrid,
  renderWidth: number,
  renderHeight: number
): ChronicleRenderTarget {
  const scratch = createChronicleCanvas(grid.width, grid.height);
  const scratchCtx = context2d(scratch);
  const output = createChronicleCanvas(renderWidth, renderHeight);
  const outputCtx = context2d(output);
  outputCtx.imageSmoothingQuality = "high";

  return {
    grid,
    renderWidth,
    renderHeight,
    scratch,
    scratchCtx,
    // Allocated once and rewritten in place every day; `paintChronicleFrame`
    // writes every pixel, so it never needs clearing between frames.
    imageData: scratchCtx.createImageData(grid.width, grid.height),
    output,
    outputCtx,
    transferable: typeof OffscreenCanvas !== "undefined",
  };
}

/**
 * Paints one day and hands back the small bitmap. Returns the time the pixel
 * pass itself took, which is what the estimate for the remaining days is scaled
 * from — the caller measures a real paint instead of guessing at one.
 */
export async function renderChronicleFrame(
  target: ChronicleRenderTarget,
  lut: NationColorLut
): Promise<{ bitmap: ImageBitmap; paintMs: number }> {
  const startedAt = performance.now();
  paintChronicleFrameToImageData(target.imageData, target.grid, lut);
  target.scratchCtx.putImageData(target.imageData, 0, 0);
  const paintMs = performance.now() - startedAt;

  target.outputCtx.clearRect(0, 0, target.renderWidth, target.renderHeight);
  target.outputCtx.drawImage(
    target.scratch as CanvasImageSource,
    0,
    0,
    target.renderWidth,
    target.renderHeight
  );

  // `transferToImageBitmap` empties the output canvas, which is exactly what
  // the next frame wants anyway since it redraws the full rectangle.
  const bitmap = target.transferable
    ? (target.output as OffscreenCanvas).transferToImageBitmap()
    : await createImageBitmap(target.output as HTMLCanvasElement);

  return { bitmap, paintMs };
}

export function clearChronicleCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
}

/** Playback draw: one `drawImage` of an already-painted day. */
export function drawChronicleBitmap(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap | null
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (!bitmap) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
}
