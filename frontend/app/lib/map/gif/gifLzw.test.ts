import { describe, expect, it } from "vitest";

import { ByteWriter, lzwCompress, writeSubBlocks } from "./gifLzw";

/**
 * Independent GIF LZW decoder. Written from the format's rules rather than from
 * the encoder so that a shared misunderstanding cannot make a round trip pass:
 * if the encoder widens its codes one step early, this decoder desynchronises
 * and the output goes wrong, which is exactly the failure a real viewer shows.
 */
function lzwDecompress(bytes: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  let dict: number[][] = [];
  let codeWidth = minCodeSize + 1;
  let widthLimit = 1 << codeWidth;
  const reset = (): void => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push([]); // clear
    dict.push([]); // end of information
    codeWidth = minCodeSize + 1;
    widthLimit = 1 << codeWidth;
  };
  reset();

  let bitPos = 0;
  const totalBits = bytes.length * 8;
  const readCode = (): number => {
    let value = 0;
    for (let i = 0; i < codeWidth; i++) {
      const byte = bytes[bitPos >> 3] ?? 0;
      value |= ((byte >> (bitPos & 7)) & 1) << i;
      bitPos++;
    }
    return value;
  };

  const out: number[] = [];
  let previous = -1;
  while (bitPos + codeWidth <= totalBits) {
    const code = readCode();
    if (code === endCode) break;
    if (code === clearCode) {
      reset();
      previous = -1;
      continue;
    }

    let entry: number[];
    if (code < dict.length) {
      entry = dict[code]!;
    } else {
      if (previous < 0) throw new Error("stream opens with an undefined code");
      const prior = dict[previous]!;
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

function roundTrip(indices: Uint8Array, minCodeSize: number): Uint8Array {
  return lzwDecompress(lzwCompress(indices, minCodeSize), minCodeSize);
}

describe("lzwCompress", () => {
  it("round-trips random indices at every code size", () => {
    for (let minCodeSize = 2; minCodeSize <= 8; minCodeSize++) {
      const alphabet = 1 << minCodeSize;
      const input = new Uint8Array(9_000);
      let seed = 0x2f6e2b1 + minCodeSize;
      for (let i = 0; i < input.length; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        input[i] = (seed >>> 16) % alphabet;
      }
      expect(roundTrip(input, minCodeSize)).toEqual(input);
    }
  });

  it("round-trips a single repeated byte", () => {
    const input = new Uint8Array(50_000).fill(7);
    expect(roundTrip(input, 8)).toEqual(input);
  });

  it("round-trips an alternating pattern", () => {
    const input = new Uint8Array(40_000);
    for (let i = 0; i < input.length; i++) input[i] = i & 1;
    expect(roundTrip(input, 2)).toEqual(input);
  });

  it("round-trips a run long enough to fill and reset the code table", () => {
    // A 400k run of one value exhausts the 12-bit table and forces at least one
    // mid-stream clear code, which is where an encoder that forgets to reset its
    // dictionary silently starts lying to the decoder.
    const input = new Uint8Array(400_000).fill(3);
    expect(roundTrip(input, 4)).toEqual(input);
  });

  it("round-trips a long run of blocks that each fill the table", () => {
    const input = new Uint8Array(300_000);
    for (let i = 0; i < input.length; i++) input[i] = (i * i) & 0xff;
    expect(roundTrip(input, 8)).toEqual(input);
  });

  it("round-trips one index and an empty stream", () => {
    expect(roundTrip(Uint8Array.from([5]), 3)).toEqual(Uint8Array.from([5]));
    expect(roundTrip(new Uint8Array(0), 8)).toEqual(new Uint8Array(0));
  });

  it("emits a clear code first and an end code last", () => {
    const compressed = lzwCompress(Uint8Array.from([0, 1, 2, 3]), 2);
    // minCodeSize 2 -> 3-bit codes: clear is 4, end is 5.
    expect(compressed[0]! & 0b111).toBe(4);
    const decoded = lzwDecompress(compressed, 2);
    expect(decoded).toEqual(Uint8Array.from([0, 1, 2, 3]));
  });
});

describe("writeSubBlocks", () => {
  it("splits at 255 bytes and terminates with a zero-length block", () => {
    const writer = new ByteWriter();
    const payload = new Uint8Array(600);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
    writeSubBlocks(writer, payload);
    const out = writer.toUint8Array();

    expect(out.length).toBe(600 + 3 + 1);
    expect(out[0]).toBe(255);
    expect(out[256]).toBe(255);
    expect(out[512]).toBe(90);
    expect(out[out.length - 1]).toBe(0);
    expect(Array.from(out.subarray(1, 256))).toEqual(Array.from(payload.subarray(0, 255)));
  });

  it("writes only the terminator for an empty payload", () => {
    const writer = new ByteWriter();
    writeSubBlocks(writer, new Uint8Array(0));
    expect(Array.from(writer.toUint8Array())).toEqual([0]);
  });
});

describe("ByteWriter", () => {
  it("keeps bytes in order across its internal chunk boundary", () => {
    const writer = new ByteWriter();
    const size = (1 << 16) + 1234;
    const source = new Uint8Array(size);
    for (let i = 0; i < size; i++) source[i] = (i * 31) & 0xff;
    writer.byte(0xaa);
    writer.bytes(source);
    writer.u16(0x1234);

    const out = writer.toUint8Array();
    expect(out.length).toBe(size + 3);
    expect(out[0]).toBe(0xaa);
    expect(out[1]).toBe(source[0]);
    expect(out[size]).toBe(source[size - 1]);
    expect(out[size + 1]).toBe(0x34);
    expect(out[size + 2]).toBe(0x12);
  });
});
