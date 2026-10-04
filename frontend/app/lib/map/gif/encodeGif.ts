/**
 * GIF89a animation encoder for the map timelapse studio.
 *
 * Pure typed-array work, independent of canvases, the DOM and timers.
 * `encodeGifSteps` yields after each frame; the browser caller awaits between
 * steps to repaint progress and process cancellation. `encodeGif` drains the
 * same generator synchronously for callers that do not need those yields.
 */

import { ByteWriter, lzwCompress, writeSubBlocks } from "./gifLzw";
import {
  buildGifPalette,
  mapFrameToPaletteIndices,
  NearestColorCache,
} from "./gifPalette";

export type GifSourceFrame = {
  /** RGBA, width*height*4, straight out of `ImageData.data`. */
  data: Uint8ClampedArray;
  /** Frame duration in ms. Rounded to GIF's 10ms tick when written. */
  delayMs: number;
};

export type EncodeGifOptions = {
  width: number;
  height: number;
  frames: GifSourceFrame[];
  /** Infinite loop when true (default), play-once when false. */
  loop?: boolean;
  /** Reported after each frame is written, for a progress bar. */
  onProgress?: (framesDone: number, frameTotal: number) => void;
};

/**
 * GIF stores a delay in hundredths of a second, so 10ms is the finest tick the
 * format has. Zero and one are the interesting cases: the spec says nothing
 * useful about them, and browsers, Discord and most other viewers historically
 * substitute a default of about 100ms or run the animation flat out. The
 * studio's 1x speed is a real duration, so a delay that fast is a bug, not a
 * request — clamp to two ticks, the fastest value everything honours.
 */
const MIN_DELAY_CENTISECONDS = 2;
const MAX_DELAY_CENTISECONDS = 0xffff;

export function delayToCentiseconds(delayMs: number): number {
  if (!Number.isFinite(delayMs)) return MIN_DELAY_CENTISECONDS;
  const ticks = Math.round(delayMs / 10);
  if (ticks < MIN_DELAY_CENTISECONDS) return MIN_DELAY_CENTISECONDS;
  if (ticks > MAX_DELAY_CENTISECONDS) return MAX_DELAY_CENTISECONDS;
  return ticks;
}

function validate(options: EncodeGifOptions): void {
  const { width, height, frames } = options;
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`gif width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`gif height must be a positive integer, got ${height}`);
  }
  // A 16-bit logical screen descriptor cannot describe anything larger, and a
  // silently truncated dimension would produce a file that decodes to a
  // sliver of the map rather than an obvious failure.
  if (width > 0xffff || height > 0xffff) {
    throw new Error(`gif dimensions cannot exceed 65535, got ${width}x${height}`);
  }
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error("gif needs at least one frame");
  }
  const expected = width * height * 4;
  for (let i = 0; i < frames.length; i++) {
    const data = frames[i]?.data;
    if (!data || data.length !== expected) {
      throw new Error(
        `gif frame ${i} holds ${data?.length ?? 0} bytes, expected ${expected} for ${width}x${height}`
      );
    }
  }
}

/**
 * The encoder as a resumable generator: one `yield` per frame written, valued
 * with the number of frames done so far, returning the finished GIF bytes.
 *
 * The palette is global to the file — `buildGifPalette` reads every frame — so
 * the frames must all be in hand before the first step, and the up-front
 * `CHRONICLE_MEMORY_CEILING_BYTES` refusal in `chronicleGifExport.ts` is what
 * keeps that bounded. Everything after the palette is per-frame, and that
 * per-frame work (nearest-colour mapping plus LZW over `width*height` pixels)
 * is the longest synchronous step, which is what the yields
 * are for.
 *
 * `validate` runs on the first `next()`, not at call time — generators do not
 * execute their body until then. Both drivers below step immediately, so a bad
 * request still throws before anything observable happens.
 */
export function* encodeGifSteps(
  options: EncodeGifOptions
): Generator<number, Uint8Array, void> {
  validate(options);
  const { width, height, frames } = options;
  const loop = options.loop ?? true;

  const palette = buildGifPalette(
    frames.map((frame) => frame.data),
    width
  );
  const tableSize = palette.table.length / 3;
  // The colour table size travels as an exponent minus one across three bits,
  // and the same exponent is the LZW minimum code size. Two entries is the
  // format's floor, hence the `Math.max(2, ...)` in `buildGifPalette`.
  let sizeBits = 1;
  while (1 << sizeBits < tableSize) sizeBits++;

  const out = new ByteWriter();
  out.ascii("GIF89a");

  out.u16(width);
  out.u16(height);
  // Global colour table present, 8-bit colour resolution, unsorted, size 2^n.
  out.byte(0x80 | 0x70 | (sizeBits - 1));
  out.byte(0); // Background colour index.
  out.byte(0); // Pixel aspect ratio: 0 means "square, do not correct".
  out.bytes(palette.table);

  if (loop) {
    // NETSCAPE2.0 is the de-facto looping extension, written once for the whole
    // file. Repeating it per frame is a common bug that some decoders read as
    // restarting the loop counter.
    out.byte(0x21);
    out.byte(0xff);
    out.byte(0x0b);
    out.ascii("NETSCAPE2.0");
    out.byte(0x03); // Sub-block length.
    out.byte(0x01); // Sub-block id: loop count follows.
    out.u16(0); // Zero means forever.
    out.byte(0x00); // Block terminator.
  }

  const cache = new NearestColorCache(palette);
  const indices = new Uint8Array(width * height);
  const minCodeSize = Math.max(2, sizeBits);

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;

    out.byte(0x21);
    out.byte(0xf9);
    out.byte(0x04);
    // Disposal method 1, "leave the frame in place". Every frame here covers
    // the whole canvas opaquely, so there is nothing to restore, and disposal 2
    // would make viewers clear to the background colour between frames — a
    // one-frame flash on slow decoders.
    out.byte(0x01 << 2);
    out.u16(delayToCentiseconds(frame.delayMs));
    out.byte(0); // Transparent colour index, unused (flag above is clear).
    out.byte(0x00); // Block terminator.

    out.byte(0x2c);
    out.u16(0); // Image left.
    out.u16(0); // Image top.
    out.u16(width);
    out.u16(height);
    out.byte(0x00); // No local colour table, not interlaced.

    mapFrameToPaletteIndices(frame.data, cache, indices);
    out.byte(minCodeSize);
    writeSubBlocks(out, lzwCompress(indices, minCodeSize));

    options.onProgress?.(i + 1, frames.length);
    yield i + 1;
  }

  out.byte(0x3b); // Trailer.
  return out.toUint8Array();
}

/**
 * The whole encode in one synchronous call — every step drained back to back.
 *
 * This is the shape `encodeGif.test.ts` exercises and the shape any non-UI
 * caller wants; the studio uses `encodeGifSteps` directly so it can yield.
 */
export function encodeGif(options: EncodeGifOptions): Uint8Array {
  const steps = encodeGifSteps(options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
