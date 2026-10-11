/**
 * Colour quantisation for the GIF encoder: one palette built from every frame
 * at once, then a nearest-colour mapping for the real pixels.
 *
 * The palette is global rather than per-frame because a per-frame palette makes
 * the parchment and the ocean drift a shade between days, and a timelapse of a
 * map reads that drift as flicker across the whole canvas — far more visible
 * than the quantisation error it saves.
 *
 * No dithering, deliberately. Ordered or error-diffused dither scatters noise
 * across the large flat parchment and ocean fills, and LZW compresses runs;
 * turning a 1600-pixel run of one index into 1600 alternating indices roughly
 * triples the file. Flat map art quantises cleanly without it.
 *
 * Pure over typed arrays — no `ImageData`, no canvas — so this runs under node
 * in the tests and on the studio's main thread in the browser. Note that
 * `buildGifPalette` is the one part of the encode that reads every frame at
 * once and so cannot be chunked between frames the way the rest of
 * `encodeGifSteps` is; it is a single scan, not the per-pixel LZW pass.
 */

/**
 * A GIF colour table. `table` is always a power-of-two number of RGB triples
 * because the format encodes its size as an exponent; entries past
 * `colorCount` are padding and are never referenced by an index.
 */
export type GifPalette = {
  /** `3 * tableSize` bytes, R,G,B per entry. */
  table: Uint8Array;
  /** Entries actually produced by quantisation. */
  colorCount: number;
};

/**
 * Roughly how many pixels the median cut looks at, across *all* frames
 * together.
 *
 * A 1080x1080x60-frame export is 70 million pixels; walking every one to build
 * a histogram costs more than the rest of the encode put together and changes
 * the palette by nothing you could see. 150k samples still puts thousands of
 * pixels inside any region big enough to notice on screen, and a nation fill
 * too small to catch a sample at this rate is a handful of pixels that will map
 * to a near neighbour anyway.
 */
export const PALETTE_SAMPLE_TARGET = 150_000;

/** Below this alpha a pixel is treated as black — see `buildGifPalette`. */
export const OPAQUE_ALPHA_THRESHOLD = 128;

function packRgb(r: number, g: number, b: number): number {
  return ((r << 16) | (g << 8) | b) >>> 0;
}

/**
 * Sampling stride in pixels. Kept off any multiple of the frame width: a stride
 * that lands on the row period samples a single column, and on a map that
 * column is quite likely to be all ocean, which would hand the median cut a
 * one-colour histogram for a full-colour picture.
 */
export function pixelSampleStride(totalPixels: number, width: number): number {
  let stride = Math.max(1, Math.floor(totalPixels / PALETTE_SAMPLE_TARGET));
  while (stride > 1 && width > 0 && stride % width === 0) stride++;
  return stride;
}

type ColorHistogram = {
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  count: Uint32Array;
  size: number;
};

function sampleHistogram(frames: readonly Uint8ClampedArray[], width: number): ColorHistogram {
  let totalPixels = 0;
  for (const frame of frames) totalPixels += frame.length >> 2;
  const stride = pixelSampleStride(totalPixels, width);

  const counts = new Map<number, number>();
  for (const frame of frames) {
    const pixels = frame.length >> 2;
    for (let p = 0; p < pixels; p += stride) {
      const o = p << 2;
      // Transparent pixels are a guard, not a feature: the rasterizer
      // composites onto an opaque background before calling us. Folding them
      // in as black keeps a stray transparent pixel from inventing a palette
      // entry out of whatever RGB happens to sit under alpha 0.
      const key = frame[o + 3]! < OPAQUE_ALPHA_THRESHOLD ? 0 : packRgb(frame[o]!, frame[o + 1]!, frame[o + 2]!);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const size = counts.size;
  const histogram: ColorHistogram = {
    r: new Uint8Array(size),
    g: new Uint8Array(size),
    b: new Uint8Array(size),
    count: new Uint32Array(size),
    size,
  };
  let i = 0;
  for (const [key, count] of counts) {
    histogram.r[i] = (key >>> 16) & 0xff;
    histogram.g[i] = (key >>> 8) & 0xff;
    histogram.b[i] = key & 0xff;
    histogram.count[i] = count;
    i++;
  }
  return histogram;
}

type Box = {
  start: number;
  end: number;
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
};

function boundBox(box: Box, hist: ColorHistogram, order: Uint32Array): void {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  for (let i = box.start; i < box.end; i++) {
    const c = order[i]!;
    const r = hist.r[c]!;
    const g = hist.g[c]!;
    const b = hist.b[c]!;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  box.rMin = rMin;
  box.rMax = rMax;
  box.gMin = gMin;
  box.gMax = gMax;
  box.bMin = bMin;
  box.bMax = bMax;
}

/**
 * How badly a box wants splitting: its longest axis times the number of
 * *distinct* colours it holds.
 *
 * Counting distinct colours rather than pixels is the whole trick for map
 * imagery. The ocean and the parchment cover most of the canvas but are one or
 * two colours each; a population-weighted median cut would spend nearly every
 * split subdividing them and hand the saturated nation fills — a few thousand
 * pixels, but the entire point of the picture — a single shared box. Under this
 * rule the ocean is one entry competing against every other entry, and the
 * nation colours, which are far apart in RGB, win splits on their axis extent.
 */
function boxPriority(box: Box): number {
  const longest = Math.max(box.rMax - box.rMin, box.gMax - box.gMin, box.bMax - box.bMin);
  return longest * (box.end - box.start);
}

/**
 * Builds one global colour table from every frame.
 *
 * `width` is only used to pick a sampling stride that does not degenerate into
 * a single column; passing the real frame width is enough.
 */
export function buildGifPalette(frames: readonly Uint8ClampedArray[], width: number, maxColors = 256): GifPalette {
  const limit = Math.max(2, Math.min(256, maxColors | 0));
  const hist = sampleHistogram(frames, width);

  const order = new Uint32Array(hist.size);
  for (let i = 0; i < hist.size; i++) order[i] = i;

  const boxes: Box[] = [];
  if (hist.size > 0) {
    const root: Box = {
      start: 0,
      end: hist.size,
      rMin: 0,
      rMax: 0,
      gMin: 0,
      gMax: 0,
      bMin: 0,
      bMax: 0,
    };
    boundBox(root, hist, order);
    boxes.push(root);
  }

  while (boxes.length < limit) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      if (box.end - box.start < 2) continue;
      const score = boxPriority(box);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    // Every remaining box is a single colour (or a group of identical ones):
    // there is nothing left to cut, and a palette smaller than the limit is the
    // correct answer, not a failure.
    if (best < 0) break;

    const box = boxes[best]!;
    const rSpan = box.rMax - box.rMin;
    const gSpan = box.gMax - box.gMin;
    const bSpan = box.bMax - box.bMin;
    const channel = rSpan >= gSpan && rSpan >= bSpan ? hist.r : gSpan >= bSpan ? hist.g : hist.b;

    const segment = Array.from(order.subarray(box.start, box.end));
    segment.sort((a, b) => channel[a]! - channel[b]!);
    order.set(segment, box.start);

    // Median over distinct colours, matching the selection rule above.
    const mid = box.start + ((box.end - box.start) >> 1);
    const right: Box = {
      start: mid,
      end: box.end,
      rMin: 0,
      rMax: 0,
      gMin: 0,
      gMax: 0,
      bMin: 0,
      bMax: 0,
    };
    box.end = mid;
    boundBox(box, hist, order);
    boundBox(right, hist, order);
    boxes.push(right);
  }

  const colorCount = Math.max(1, boxes.length);
  let tableSize = 2;
  while (tableSize < colorCount) tableSize <<= 1;
  const table = new Uint8Array(tableSize * 3);

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!;
    // Pixel-count weighting for the *representative* even though the splits
    // ignore it: once a box is mostly one flat fill, the exported ocean should
    // be the ocean's own tone, not the average of it and a few anti-aliased
    // stragglers that share its box.
    let weight = 0;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    for (let j = box.start; j < box.end; j++) {
      const c = order[j]!;
      const w = hist.count[c]!;
      weight += w;
      rSum += hist.r[c]! * w;
      gSum += hist.g[c]! * w;
      bSum += hist.b[c]! * w;
    }
    const o = i * 3;
    if (weight > 0) {
      table[o] = Math.round(rSum / weight);
      table[o + 1] = Math.round(gSum / weight);
      table[o + 2] = Math.round(bSum / weight);
    }
  }

  return { table, colorCount };
}

/**
 * Exact-RGB memoised nearest-colour lookup.
 *
 * The cache is open-addressed over typed arrays rather than a `Map`: a frame is
 * a million lookups and a `Map.get` on a boxed key is several times the cost of
 * a masked array probe. Keys are the packed 24-bit RGB, `-1` marks a free slot,
 * and the table doubles before it can get slow, so a repeated colour — which is
 * nearly every pixel of a map — costs one probe.
 */
export class NearestColorCache {
  private readonly table: Uint8Array;
  private readonly colorCount: number;
  private keys: Int32Array;
  private values: Uint8Array;
  private mask: number;
  private occupied = 0;
  /** Index every sub-threshold-alpha pixel resolves to. */
  readonly transparentIndex: number;

  constructor(palette: GifPalette) {
    this.table = palette.table;
    this.colorCount = Math.max(1, palette.colorCount);
    this.mask = (1 << 16) - 1;
    this.keys = new Int32Array(this.mask + 1).fill(-1);
    this.values = new Uint8Array(this.mask + 1);
    this.transparentIndex = this.nearest(0, 0, 0);
  }

  private nearest(r: number, g: number, b: number): number {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < this.colorCount; i++) {
      const o = i * 3;
      const dr = r - this.table[o]!;
      const dg = g - this.table[o + 1]!;
      const db = b - this.table[o + 2]!;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
        if (distance === 0) break;
      }
    }
    return best;
  }

  private grow(): void {
    const oldKeys = this.keys;
    const oldValues = this.values;
    this.mask = ((this.mask + 1) << 1) - 1;
    this.keys = new Int32Array(this.mask + 1).fill(-1);
    this.values = new Uint8Array(this.mask + 1);
    for (let i = 0; i < oldKeys.length; i++) {
      const key = oldKeys[i]!;
      if (key < 0) continue;
      let slot = (key * 2654435761) & this.mask;
      while (this.keys[slot]! >= 0) slot = (slot + 1) & this.mask;
      this.keys[slot] = key;
      this.values[slot] = oldValues[i]!;
    }
  }

  lookup(r: number, g: number, b: number): number {
    const key = packRgb(r, g, b);
    let slot = (key * 2654435761) & this.mask;
    for (;;) {
      const stored = this.keys[slot]!;
      if (stored === key) return this.values[slot]!;
      if (stored < 0) break;
      slot = (slot + 1) & this.mask;
    }
    const index = this.nearest(r, g, b);
    this.keys[slot] = key;
    this.values[slot] = index;
    this.occupied++;
    // Linear probing degrades badly past about two thirds full; grow well
    // before that so a label-heavy frame with tens of thousands of anti-aliased
    // tones never turns the cache into a linear scan.
    if (this.occupied * 2 > this.mask) this.grow();
    return index;
  }
}

/** Maps one RGBA frame into `out`, which must hold `frame.length / 4` indices. */
export function mapFrameToPaletteIndices(frame: Uint8ClampedArray, cache: NearestColorCache, out: Uint8Array): void {
  const pixels = frame.length >> 2;
  for (let p = 0, o = 0; p < pixels; p++, o += 4) {
    out[p] =
      frame[o + 3]! < OPAQUE_ALPHA_THRESHOLD
        ? cache.transparentIndex
        : cache.lookup(frame[o]!, frame[o + 1]!, frame[o + 2]!);
  }
}
