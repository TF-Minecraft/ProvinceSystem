import type { NationColorLut } from "./chroniclePaint";

/**
 * Compositing several province -> colour tables down to the one table
 * `paintChronicleFrame` walks.
 *
 * The studio has exactly one fill canvas per frame, and that is deliberate: a
 * frame is an `ImageBitmap` held in memory for the whole playback, so a second
 * fill canvas per day would double what a 79-frame build costs at the ceiling
 * `CHRONICLE_MEMORY_CEILING_BYTES` already sets. It would also have to be
 * threaded through `runChronicleBuild`, `disposeChronicleFrames`, the playback
 * draw and the GIF compositor, and a layer that shows on screen but is missing
 * from the export is the exact bug that split path invites.
 *
 * So the extra fill layers are composited *per province id* instead of per
 * pixel. There are hundreds of provinces and millions of pixels, so blending
 * here is free next to blending in the paint pass, and the result is a single
 * ordinary LUT that every existing caller already knows how to draw.
 *
 * Source-over, in the order given, lowest layer first. A layer that wants to
 * let the one beneath it show through says so with its own alpha byte — which
 * is why `buildTradeLeagueColorLut` and `buildProsperityColorLut` pack a
 * partial alpha and `buildNationColorLut` packs 255. Nothing here consults a
 * toggle: the caller passes only the layers that are on, so the stack for a
 * given set of toggles is decided in one place and cannot drift between the
 * compose preview and the build.
 */

/**
 * `src` over `dst`, both packed 0xRRGGBBAA exactly as `NationColorLut` stores
 * them. Straight (non-premultiplied) source-over, since the LUT is straight.
 *
 * A fully transparent `src` returns `dst` untouched rather than falling through
 * the general formula: with `as === 0` the colour terms are all multiplied by
 * zero and a result alpha of `ad` would be paired with black, so an unclaimed
 * province in an upper layer would punch a black hole through the fill below.
 */
export function blendPackedRgbaOver(dst: number, src: number): number {
  const as = src & 0xff;
  if (as === 0) return dst;
  if (as === 0xff) return src;

  const ad = dst & 0xff;
  if (ad === 0) return src;

  const sa = as / 255;
  const da = ad / 255;
  const outA = sa + da * (1 - sa);
  // `outA` cannot be 0 here: `sa > 0` was established above.
  const mix = (sc: number, dc: number) => Math.round((sc * sa + dc * da * (1 - sa)) / outA);

  const r = mix((src >>> 24) & 0xff, (dst >>> 24) & 0xff);
  const g = mix((src >>> 16) & 0xff, (dst >>> 16) & 0xff);
  const b = mix((src >>> 8) & 0xff, (dst >>> 8) & 0xff);
  return ((r << 24) | (g << 16) | (b << 8) | Math.round(outA * 255)) >>> 0;
}

/**
 * Flattens the enabled fill layers into one LUT, lowest first.
 *
 * The result is sized to the longest layer, because an id past a layer's end
 * simply has no entry in it — the same rule `paintChronicleFrame` applies when
 * an id runs past the LUT it is handed.
 *
 * A single non-empty layer is returned as-is rather than copied: on the common
 * case (nation fill alone, which is what the studio has always drawn) this
 * keeps the whole module out of the hot path and off the allocator.
 */
export function stackChronicleFillLuts(layers: readonly (NationColorLut | null | undefined)[]): NationColorLut {
  const present = layers.filter((lut): lut is NationColorLut => lut != null && lut.length > 0);
  if (present.length === 0) return new Uint32Array(0);
  if (present.length === 1) return present[0]!;

  let length = 0;
  for (const lut of present) if (lut.length > length) length = lut.length;

  const out = new Uint32Array(length);
  for (const lut of present) {
    for (let id = 0; id < lut.length; id++) {
      const src = lut[id]!;
      if (src === 0) continue;
      out[id] = blendPackedRgbaOver(out[id]!, src);
    }
  }
  return out;
}

/**
 * Where a defocused province's grey lands: the floor keeps it off black, and
 * the span keeps a bright realm and a dark one from collapsing onto the same
 * tone. Both are picked so the greys sit clearly under the parchment's own
 * warmth rather than reading as another faction colour.
 */
const FOCUS_GREY_FLOOR = 88;
const FOCUS_GREY_SPAN = 0.42;

/**
 * One packed colour, drained to grey at the same brightness ordering.
 *
 * Luminance weights are the ones `occupationDisplayRgb` already uses, so the
 * two mutes in the chronicle agree about what "the grey of this colour" means.
 * Alpha is carried through untouched: the point of the grey is that the
 * province keeps its *shape* and its coverage, and dropping the alpha would
 * put a hole in the political geography the focused realm has to grow into.
 */
export function desaturatePackedRgba(packed: number): number {
  const a = packed & 0xff;
  if (a === 0) return packed;
  const r = (packed >>> 24) & 0xff;
  const g = (packed >>> 16) & 0xff;
  const b = (packed >>> 8) & 0xff;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const grey = Math.max(0, Math.min(255, Math.round(FOCUS_GREY_FLOOR + luma * FOCUS_GREY_SPAN)));
  return ((grey << 24) | (grey << 16) | (grey << 8) | a) >>> 0;
}

/**
 * Mutes every province the focused realm does not hold.
 *
 * A transform over the finished table rather than a second paint pass, and for
 * the same reason the fill layers are stacked per province id: the studio has
 * exactly one fill canvas per frame, and a focus that painted its own overlay
 * would have to be threaded through the build, the playback draw and the GIF
 * compositor separately — which is precisely how a focus ends up visible in the
 * preview and absent from the exported file. Done here, the focus is baked into
 * the one `ImageBitmap` every consumer already draws.
 *
 * `null` means no focus and returns the table itself, so an unfocused build is
 * byte-for-byte what it always was and pays no allocation. An *empty* set is a
 * different answer: the realm exists in the picker but holds nothing on this
 * day, so the whole map greys out — which is what "founded later" or
 * "destroyed earlier" should look like, rather than a day that silently
 * pretends nothing was focused.
 */
export function focusChronicleFillLut(
  lut: NationColorLut,
  focusProvinceIds: ReadonlySet<number> | null,
): NationColorLut {
  if (!focusProvinceIds) return lut;
  const out = new Uint32Array(lut.length);
  for (let id = 0; id < lut.length; id++) {
    const packed = lut[id]!;
    if (packed === 0) continue;
    out[id] = focusProvinceIds.has(id) ? packed : desaturatePackedRgba(packed);
  }
  return out;
}
