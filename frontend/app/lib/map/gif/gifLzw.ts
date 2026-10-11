/**
 * GIF's flavour of LZW, plus the byte plumbing every part of the encoder
 * shares. Pure over typed arrays — no DOM, no canvas, no timers — which lets
 * the tests run it under node and lets `encodeGif`'s frame-by-frame generator
 * pause between frames without this file knowing anything about it. The encode
 * runs on the studio's main thread, not a Worker; `encodeGif.ts`'s module doc
 * records why (Turbopack does not bundle browser Workers).
 *
 * GIF LZW is *not* the same as the LZW in TIFF or `compress`: codes are packed
 * least-significant-bit first, the code width grows from `minCodeSize + 1`, and
 * two reserved codes sit immediately above the pixel values. Every deviation
 * below is a spec requirement, not a preference.
 */

const WRITER_CHUNK_SIZE = 1 << 16;

/**
 * Append-only byte sink that grows by handing out fresh chunks instead of
 * reallocating and copying one big buffer. A 60-frame 1080x1080 export writes
 * a few megabytes; `Array<number>.push` would cost a boxed number per byte and
 * a final `Uint8Array.from` over millions of elements, and doubling a single
 * buffer re-copies everything written so far on every growth. Chunks pay one
 * copy total, in `toUint8Array`.
 */
export class ByteWriter {
  private readonly full: Uint8Array[] = [];
  private current = new Uint8Array(WRITER_CHUNK_SIZE);
  private used = 0;
  private total = 0;

  get length(): number {
    return this.total;
  }

  byte(value: number): void {
    if (this.used === WRITER_CHUNK_SIZE) {
      this.full.push(this.current);
      this.current = new Uint8Array(WRITER_CHUNK_SIZE);
      this.used = 0;
    }
    this.current[this.used++] = value & 0xff;
    this.total++;
  }

  /** Little-endian: every multi-byte field in a GIF is stored low byte first. */
  u16(value: number): void {
    this.byte(value & 0xff);
    this.byte((value >>> 8) & 0xff);
  }

  ascii(text: string): void {
    for (let i = 0; i < text.length; i++) this.byte(text.charCodeAt(i));
  }

  bytes(source: Uint8Array, start = 0, end = source.length): void {
    let offset = start;
    while (offset < end) {
      if (this.used === WRITER_CHUNK_SIZE) {
        this.full.push(this.current);
        this.current = new Uint8Array(WRITER_CHUNK_SIZE);
        this.used = 0;
      }
      const take = Math.min(WRITER_CHUNK_SIZE - this.used, end - offset);
      this.current.set(source.subarray(offset, offset + take), this.used);
      this.used += take;
      this.total += take;
      offset += take;
    }
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.total);
    let offset = 0;
    for (const chunk of this.full) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    out.set(this.current.subarray(0, this.used), offset);
    return out;
  }
}

/** GIF caps the code width at 12 bits, so 4095 is the last assignable code. */
const MAX_CODE_WIDTH = 12;
const MAX_CODE = (1 << MAX_CODE_WIDTH) - 1;

/**
 * Dictionary lookup for `(prefixCode, nextIndex)`. `prefixCode` is at most 4095
 * and `nextIndex` at most 255, so the pair fits a flat `prefix * 256 + index`
 * table of a million slots — a plain array index beats hashing a `Map` key
 * several million times per frame. Stored values are `code + 1` so that `0`
 * means "absent" and a `fill(0)` is a valid reset.
 *
 * Held module-level and reused: allocating 4 MB per frame would hand the GC
 * sixty large buffers over one export for no gain.
 */
let dictionary: Int32Array | null = null;

function resetDictionary(): Int32Array {
  if (!dictionary) dictionary = new Int32Array(4096 * 256);
  else dictionary.fill(0);
  return dictionary;
}

/**
 * Compresses palette indices into a raw GIF LZW code stream (no sub-block
 * framing — see `writeSubBlocks`).
 *
 * `minCodeSize` is the byte that precedes the image data in the file. It is at
 * least 2 even for a two-colour image: a `minCodeSize` of 1 would leave the
 * clear and end-of-information codes no room to grow into, and real decoders
 * reject it.
 */
export function lzwCompress(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const codeSizeFloor = Math.max(2, Math.min(8, minCodeSize | 0));
  // The two reserved codes sit directly above the pixel values, which is why
  // every "first free code" below is `clearCode + 2` rather than a table size.
  const clearCode = 1 << codeSizeFloor;
  const endCode = clearCode + 1;

  const out = new ByteWriter();
  let bitBuffer = 0;
  let bitCount = 0;

  const emit = (code: number, width: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += width;
    while (bitCount >= 8) {
      out.byte(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  let codeWidth = codeSizeFloor + 1;
  let widthLimit = 1 << codeWidth;
  let nextCode = clearCode + 2;
  const table = resetDictionary();

  emit(clearCode, codeWidth);

  if (indices.length === 0) {
    emit(endCode, codeWidth);
    if (bitCount > 0) out.byte(bitBuffer & 0xff);
    return out.toUint8Array();
  }

  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const next = indices[i]!;
    const key = (prefix << 8) | next;
    const found = table[key]!;
    if (found !== 0) {
      prefix = found - 1;
      continue;
    }

    emit(prefix, codeWidth);

    if (nextCode > MAX_CODE) {
      // The table is full. Tell the decoder to throw its copy away rather than
      // freezing the dictionary; a frozen table on a long map animation keeps
      // emitting 12-bit codes for strings that have stopped recurring.
      emit(clearCode, codeWidth);
      table.fill(0);
      codeWidth = codeSizeFloor + 1;
      widthLimit = 1 << codeWidth;
      nextCode = clearCode + 2;
    } else {
      table[key] = nextCode + 1;
      // The decoder adds its own entry one code later than we do, so it reaches
      // any given table size one code behind us. Widening when the code we just
      // *assigned* equals the limit — rather than when the next free code does —
      // is what keeps the two in step; getting this off by one still produces a
      // plausible-looking file that decodes to garbage halfway down the image.
      if (nextCode === widthLimit && codeWidth < MAX_CODE_WIDTH) {
        codeWidth++;
        widthLimit = 1 << codeWidth;
      }
      nextCode++;
    }

    prefix = next;
  }

  emit(prefix, codeWidth);
  emit(endCode, codeWidth);
  if (bitCount > 0) out.byte(bitBuffer & 0xff);
  return out.toUint8Array();
}

/**
 * Frames a byte stream the way GIF carries all bulk data: a length byte, up to
 * 255 payload bytes, repeated, closed by a zero-length block. Without the
 * terminator a decoder keeps reading the trailer as image data.
 */
export function writeSubBlocks(writer: ByteWriter, payload: Uint8Array): void {
  let offset = 0;
  while (offset < payload.length) {
    const size = Math.min(255, payload.length - offset);
    writer.byte(size);
    writer.bytes(payload, offset, offset + size);
    offset += size;
  }
  writer.byte(0);
}
