import { describe, expect, it } from "vitest";

import { delayToCentiseconds, encodeGif, type GifSourceFrame } from "./encodeGif";

type ParsedFrame = {
  delayCentiseconds: number;
  disposal: number;
  left: number;
  top: number;
  width: number;
  height: number;
  minCodeSize: number;
  lzw: Uint8Array;
};

type ParsedGif = {
  signature: string;
  width: number;
  height: number;
  globalTableSize: number;
  globalTable: Uint8Array;
  netscapeBlocks: number;
  graphicControlExtensions: number;
  frames: ParsedFrame[];
  trailer: number;
};

/**
 * Minimal GIF reader, written against the format rather than against the
 * encoder: a file that is structurally plausible but paints the wrong picture
 * has to fail here, so this walks the blocks and decodes the pixels for real.
 */
function parseGif(bytes: Uint8Array): ParsedGif {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  const u16 = (at: number): number => bytes[at]! | (bytes[at + 1]! << 8);

  const width = u16(6);
  const height = u16(8);
  const packed = bytes[10]!;
  const globalTableSize = (packed & 0x80) === 0 ? 0 : 1 << ((packed & 0x07) + 1);
  const globalTable = bytes.subarray(13, 13 + globalTableSize * 3);

  let at = 13 + globalTableSize * 3;
  let netscapeBlocks = 0;
  let graphicControlExtensions = 0;
  const frames: ParsedFrame[] = [];
  let pendingDelay = 0;
  let pendingDisposal = 0;

  const skipSubBlocks = (): Uint8Array => {
    const parts: number[] = [];
    for (;;) {
      const size = bytes[at++]!;
      if (size === 0) break;
      for (let i = 0; i < size; i++) parts.push(bytes[at + i]!);
      at += size;
    }
    return Uint8Array.from(parts);
  };

  let trailer = 0;
  for (;;) {
    const block = bytes[at++]!;
    if (block === 0x3b) {
      trailer = block;
      break;
    }
    if (block === 0x21) {
      const label = bytes[at++]!;
      if (label === 0xf9) {
        graphicControlExtensions++;
        const size = bytes[at++]!;
        expect(size).toBe(4);
        pendingDisposal = (bytes[at]! >> 2) & 0x07;
        pendingDelay = u16(at + 1);
        at += size;
        expect(bytes[at++]).toBe(0);
      } else if (label === 0xff) {
        const size = bytes[at++]!;
        const name = String.fromCharCode(...bytes.subarray(at, at + size));
        at += size;
        const payload = skipSubBlocks();
        if (name === "NETSCAPE2.0") {
          netscapeBlocks++;
          expect(Array.from(payload)).toEqual([0x01, 0x00, 0x00]);
        }
      } else {
        skipSubBlocks();
      }
      continue;
    }
    if (block === 0x2c) {
      const left = u16(at);
      const top = u16(at + 2);
      const frameWidth = u16(at + 4);
      const frameHeight = u16(at + 6);
      const imagePacked = bytes[at + 8]!;
      expect(imagePacked & 0x80).toBe(0); // No local colour table.
      expect(imagePacked & 0x40).toBe(0); // Not interlaced.
      at += 9;
      const minCodeSize = bytes[at++]!;
      const lzw = skipSubBlocks();
      frames.push({
        delayCentiseconds: pendingDelay,
        disposal: pendingDisposal,
        left,
        top,
        width: frameWidth,
        height: frameHeight,
        minCodeSize,
        lzw,
      });
      continue;
    }
    throw new Error(`unexpected block 0x${block.toString(16)} at ${at - 1}`);
  }

  return {
    signature,
    width,
    height,
    globalTableSize,
    globalTable,
    netscapeBlocks,
    graphicControlExtensions,
    frames,
    trailer,
  };
}

function lzwDecompress(bytes: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let dict: number[][] = [];
  let codeWidth = minCodeSize + 1;
  let widthLimit = 1 << codeWidth;
  const reset = (): void => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push([]);
    dict.push([]);
    codeWidth = minCodeSize + 1;
    widthLimit = 1 << codeWidth;
  };
  reset();

  let bitPos = 0;
  const totalBits = bytes.length * 8;
  const out: number[] = [];
  let previous = -1;
  while (bitPos + codeWidth <= totalBits) {
    let code = 0;
    for (let i = 0; i < codeWidth; i++) {
      code |= (((bytes[bitPos >> 3] ?? 0) >> (bitPos & 7)) & 1) << i;
      bitPos++;
    }
    if (code === endCode) break;
    if (code === clearCode) {
      reset();
      previous = -1;
      continue;
    }
    let entry: number[];
    if (code < dict.length) entry = dict[code]!;
    else {
      const prior = dict[previous!]!;
      entry = [...prior, prior[0]!];
    }
    for (const value of entry) out.push(value);
    if (previous >= 0) {
      const prior = dict[previous]!;
      dict.push([...prior, entry[0]!]);
      if (dict.length === widthLimit && codeWidth < 12) {
        codeWidth++;
        widthLimit <<= 1;
      }
    }
    previous = code;
  }
  return Uint8Array.from(out);
}

function decodeFramePixels(gif: ParsedGif, index: number): number[][] {
  const frame = gif.frames[index]!;
  const indices = lzwDecompress(frame.lzw, frame.minCodeSize);
  expect(indices.length).toBe(frame.width * frame.height);
  const pixels: number[][] = [];
  for (const paletteIndex of indices) {
    const o = paletteIndex * 3;
    pixels.push([gif.globalTable[o]!, gif.globalTable[o + 1]!, gif.globalTable[o + 2]!]);
  }
  return pixels;
}

function solidFrame(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
  delayMs = 100,
): GifSourceFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, delayMs };
}

describe("delayToCentiseconds", () => {
  it("rounds to GIF ticks and clamps both ends", () => {
    // 0 and 1 tick are treated as "as fast as the viewer likes", which is not
    // what the studio's 1x speed means.
    expect(delayToCentiseconds(0)).toBe(2);
    expect(delayToCentiseconds(9)).toBe(2);
    expect(delayToCentiseconds(33)).toBe(3);
    expect(delayToCentiseconds(1000)).toBe(100);
    expect(delayToCentiseconds(10 * 60 * 1000)).toBe(60_000);
    expect(delayToCentiseconds(Number.MAX_SAFE_INTEGER)).toBe(65_535);
    expect(delayToCentiseconds(Number.NaN)).toBe(2);
  });

  it("carries the clamped delay into the file", () => {
    const gif = parseGif(
      encodeGif({
        width: 2,
        height: 2,
        frames: [
          solidFrame(2, 2, [10, 10, 10], 0),
          solidFrame(2, 2, [20, 20, 20], 33),
          solidFrame(2, 2, [30, 30, 30], 1000),
          solidFrame(2, 2, [40, 40, 40], 10 * 60 * 1000),
        ],
      }),
    );
    expect(gif.frames.map((frame) => frame.delayCentiseconds)).toEqual([2, 3, 100, 60_000]);
  });
});

describe("encodeGif structure", () => {
  const frames = [solidFrame(8, 5, [200, 30, 30]), solidFrame(8, 5, [30, 200, 30]), solidFrame(8, 5, [30, 30, 200])];

  it("writes a GIF89a header, the requested size and a trailer", () => {
    const bytes = encodeGif({ width: 8, height: 5, frames });
    const gif = parseGif(bytes);
    expect(gif.signature).toBe("GIF89a");
    expect(gif.width).toBe(8);
    expect(gif.height).toBe(5);
    expect(bytes[bytes.length - 1]).toBe(0x3b);
    expect(gif.trailer).toBe(0x3b);
  });

  it("writes exactly one global colour table and no local tables", () => {
    const gif = parseGif(encodeGif({ width: 8, height: 5, frames }));
    expect(gif.globalTableSize).toBe(4);
    expect(gif.globalTable.length).toBe(12);
    expect(gif.frames).toHaveLength(3);
    for (const frame of gif.frames) {
      expect(frame.left).toBe(0);
      expect(frame.top).toBe(0);
      expect(frame.width).toBe(8);
      expect(frame.height).toBe(5);
      expect(frame.disposal).toBe(1);
    }
  });

  it("writes one graphic control extension per frame", () => {
    const gif = parseGif(encodeGif({ width: 8, height: 5, frames }));
    expect(gif.graphicControlExtensions).toBe(3);
  });

  it("writes the NETSCAPE loop block once, and only when looping", () => {
    expect(parseGif(encodeGif({ width: 8, height: 5, frames })).netscapeBlocks).toBe(1);
    expect(parseGif(encodeGif({ width: 8, height: 5, frames, loop: true })).netscapeBlocks).toBe(1);
    expect(parseGif(encodeGif({ width: 8, height: 5, frames, loop: false })).netscapeBlocks).toBe(0);
  });

  it("reports progress once per frame", () => {
    const seen: Array<[number, number]> = [];
    encodeGif({
      width: 8,
      height: 5,
      frames,
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});

describe("encodeGif pixels", () => {
  it("round-trips a hand-made three-colour image", () => {
    const colors: Array<[number, number, number]> = [
      [12, 34, 56],
      [220, 40, 40],
      [240, 232, 200],
    ];
    // A 4x4 with a distinct layout per row, so a transposed or mis-strided
    // write cannot pass by symmetry.
    const layout = [
      [0, 1, 2, 0],
      [1, 1, 0, 2],
      [2, 0, 0, 1],
      [0, 2, 1, 1],
    ];
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const color = colors[layout[y]![x]!]!;
        const o = (y * 4 + x) * 4;
        data[o] = color[0];
        data[o + 1] = color[1];
        data[o + 2] = color[2];
        data[o + 3] = 255;
      }
    }

    const gif = parseGif(
      encodeGif({
        width: 4,
        height: 4,
        frames: [{ data, delayMs: 100 }, solidFrame(4, 4, [12, 34, 56])],
      }),
    );
    const pixels = decodeFramePixels(gif, 0);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(pixels[y * 4 + x]).toEqual(colors[layout[y]![x]!]);
      }
    }

    // The second frame shares the same global table.
    expect(decodeFramePixels(gif, 1).every((p) => p.join(",") === "12,34,56")).toBe(true);
  });

  it("maps a photographic frame to its nearest palette colour", () => {
    const width = 40;
    const height = 30;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        data[o] = (x * 6) & 0xff;
        data[o + 1] = (y * 8) & 0xff;
        data[o + 2] = ((x + y) * 5) & 0xff;
        data[o + 3] = 255;
      }
    }

    const gif = parseGif(encodeGif({ width, height, frames: [{ data, delayMs: 60 }] }));
    const pixels = decodeFramePixels(gif, 0);

    for (let p = 0; p < width * height; p++) {
      const o = p * 4;
      const source = [data[o]!, data[o + 1]!, data[o + 2]!];
      let bestDistance = Infinity;
      for (let i = 0; i < gif.globalTableSize; i++) {
        const t = i * 3;
        const d =
          (source[0]! - gif.globalTable[t]!) ** 2 +
          (source[1]! - gif.globalTable[t + 1]!) ** 2 +
          (source[2]! - gif.globalTable[t + 2]!) ** 2;
        if (d < bestDistance) bestDistance = d;
      }
      const got = pixels[p]!;
      const gotDistance = (source[0]! - got[0]!) ** 2 + (source[1]! - got[1]!) ** 2 + (source[2]! - got[2]!) ** 2;
      expect(gotDistance).toBe(bestDistance);
    }
  });

  it("quantises a >256-colour frame without throwing", () => {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        data[o] = x * 4;
        data[o + 1] = y * 4;
        data[o + 2] = (x * y) & 0xff;
        data[o + 3] = 255;
      }
    }
    const gif = parseGif(encodeGif({ width, height, frames: [{ data, delayMs: 40 }] }));
    expect(gif.globalTableSize).toBe(256);
    expect(decodeFramePixels(gif, 0)).toHaveLength(width * height);
  });
});

describe("encodeGif validation", () => {
  const frame = solidFrame(4, 4, [1, 2, 3]);

  it("rejects non-integer or non-positive dimensions", () => {
    expect(() => encodeGif({ width: 0, height: 4, frames: [frame] })).toThrow(/width must be a positive integer/);
    expect(() => encodeGif({ width: 4.5, height: 4, frames: [frame] })).toThrow(/width must be a positive integer/);
    expect(() => encodeGif({ width: 4, height: -4, frames: [frame] })).toThrow(/height must be a positive integer/);
    expect(() => encodeGif({ width: 4, height: Number.NaN, frames: [frame] })).toThrow(
      /height must be a positive integer/,
    );
  });

  it("rejects an empty frame list", () => {
    expect(() => encodeGif({ width: 4, height: 4, frames: [] })).toThrow(/at least one frame/);
  });

  it("rejects a frame whose buffer does not match the dimensions", () => {
    const short = { data: new Uint8ClampedArray(4 * 4 * 4 - 4), delayMs: 100 };
    expect(() => encodeGif({ width: 4, height: 4, frames: [frame, short] })).toThrow(
      /frame 1 holds 60 bytes, expected 64/,
    );
  });
});
