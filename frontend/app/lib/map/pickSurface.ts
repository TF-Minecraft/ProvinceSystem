/**
 * The live map's pick map, kept as runs of one colour per row.
 *
 * Hover and click read one pixel at a time. A 6400 px map typically needs
 * 70–120 thousand runs, well under 1 MB. Colours match canvas readback,
 * including transparent pixels (0,0,0), for lookup through `rgbToId`.
 */
export type PickSurface = {
  readonly width: number;
  readonly height: number;
  /** The colour at (x, y) as `r,g,b`, the form `rgbToId` is keyed by. */
  rgbAt(x: number, y: number): string | null;
};

/** No pick map (yet, or for a mode that picks provinces): nothing under any pixel. */
export const EMPTY_PICK_SURFACE: PickSurface = {
  width: 0,
  height: 0,
  rgbAt: () => null,
};

/** Built a band of rows at a time, top to bottom (see `addRows`). */
export class PickSurfaceBuilder {
  readonly width: number;
  readonly height: number;
  /** Where each row's runs begin in `starts`/`colours`; one more for the end. */
  private readonly rowStarts: Uint32Array;
  private starts: Uint16Array;
  private colours: Uint32Array;
  private runs = 0;
  private rows = 0;

  constructor(width: number, height: number) {
    if (width > 0xffff) throw new Error(`Pick map too wide: ${width}`);
    this.width = width;
    this.height = height;
    this.rowStarts = new Uint32Array(height + 1);
    this.starts = new Uint16Array(Math.max(1024, height * 8));
    this.colours = new Uint32Array(this.starts.length);
  }

  /** Append `count` rows of RGBA pixels, `width` wide, as `getImageData` gives them. */
  addRows(data: Uint8ClampedArray, count: number): void {
    const width = this.width;
    for (let row = 0; row < count && this.rows < this.height; row++) {
      this.rowStarts[this.rows] = this.runs;
      const base = row * width * 4;
      let previous = -1;
      for (let x = 0; x < width; x++) {
        const i = base + x * 4;
        // Transparent reads back as 0,0,0 from a canvas, whatever was put there.
        const colour =
          data[i + 3] === 0 ? 0 : (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        if (colour === previous) continue;
        previous = colour;
        this.push(x, colour);
      }
      this.rows += 1;
    }
  }

  finish(): PickSurface {
    for (let row = this.rows; row <= this.height; row++) this.rowStarts[row] = this.runs;
    const { width, height, rowStarts } = this;
    const starts = this.starts.slice(0, this.runs);
    const colours = this.colours.slice(0, this.runs);
    return {
      width,
      height,
      rgbAt(x, y) {
        if (!(x >= 0 && y >= 0 && x < width && y < height)) return null;
        const row = Math.floor(y);
        let lo = rowStarts[row];
        let hi = rowStarts[row + 1] - 1;
        if (hi < lo) return null;
        // The last run starting at or before x.
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (starts[mid] <= x) lo = mid;
          else hi = mid - 1;
        }
        const colour = colours[lo];
        return `${(colour >> 16) & 0xff},${(colour >> 8) & 0xff},${colour & 0xff}`;
      },
    };
  }

  private push(x: number, colour: number): void {
    if (this.runs === this.starts.length) {
      const starts = new Uint16Array(this.starts.length * 2);
      starts.set(this.starts);
      this.starts = starts;
      const colours = new Uint32Array(this.colours.length * 2);
      colours.set(this.colours);
      this.colours = colours;
    }
    this.starts[this.runs] = x;
    this.colours[this.runs] = colour;
    this.runs += 1;
  }
}

/** A whole RGBA image at once, e.g. a chronicle day's pick map. */
export function pickSurfaceFromImageData(image: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): PickSurface {
  const builder = new PickSurfaceBuilder(image.width, image.height);
  builder.addRows(image.data, image.height);
  return builder.finish();
}

/**
 * Rows read back per band: 6400 x 64 RGBA is 1.6 MB, a few ms to copy and
 * encode. A 256-row band took up to ~21 ms, longer than a frame.
 */
const PICK_BAND_ROWS = 64;

/** Bands are read until this much of a frame has gone, then the page draws. */
const PICK_FRAME_BUDGET_MS = 8;

/**
 * Read a decoded pick map into a `PickSurface` through a canvas one band high,
 * yielding once a frame's budget is spent so the page keeps drawing (and a pan
 * while the map loads stays smooth). Null once `cancelled`.
 */
export async function pickSurfaceFromImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  cancelled: () => boolean,
  nextFrame: () => Promise<unknown> = () =>
    new Promise((resolve) => requestAnimationFrame(resolve)),
  now: () => number = () => performance.now()
): Promise<PickSurface | null> {
  const band = document.createElement("canvas");
  band.width = width;
  band.height = Math.min(PICK_BAND_ROWS, height);
  // Read straight back, never drawn: keep the backing store CPU-side.
  const ctx = band.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const builder = new PickSurfaceBuilder(width, height);
  try {
    let frameStart = now();
    for (let y = 0; y < height; y += PICK_BAND_ROWS) {
      if (cancelled()) return null;
      const rows = Math.min(PICK_BAND_ROWS, height - y);
      // Cleared first: the map's transparent pixels must not keep the last band's.
      ctx.clearRect(0, 0, width, rows);
      ctx.drawImage(source, 0, y, width, rows, 0, 0, width, rows);
      builder.addRows(ctx.getImageData(0, 0, width, rows).data, rows);
      if (now() - frameStart >= PICK_FRAME_BUDGET_MS) {
        await nextFrame();
        frameStart = now();
      }
    }
    return cancelled() ? null : builder.finish();
  } finally {
    band.width = 0;
    band.height = 0;
  }
}
