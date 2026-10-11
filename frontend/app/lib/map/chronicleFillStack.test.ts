import { describe, expect, it } from "vitest";

import {
  blendPackedRgbaOver,
  desaturatePackedRgba,
  focusChronicleFillLut,
  stackChronicleFillLuts,
} from "./chronicleFillStack";

const pack = (r: number, g: number, b: number, a: number) => ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;

const unpack = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

describe("blendPackedRgbaOver", () => {
  it("leaves the layer beneath alone where the layer above is empty", () => {
    // The hole this guards: with `as === 0` the general formula multiplies every
    // colour term by zero, so an unclaimed province in an upper layer would
    // punch black through the fill below instead of showing it.
    const below = pack(10, 20, 30, 255);
    expect(blendPackedRgbaOver(below, 0)).toBe(below);
  });

  it("replaces outright when the layer above is opaque", () => {
    const above = pack(1, 2, 3, 255);
    expect(blendPackedRgbaOver(pack(9, 9, 9, 255), above)).toBe(above);
  });

  it("shows the layer beneath through a partial one", () => {
    // Half-and-half between black and white lands mid-grey, and stays opaque.
    const out = blendPackedRgbaOver(pack(0, 0, 0, 255), pack(255, 255, 255, 128));
    const [r, g, b, a] = unpack(out);
    expect(a).toBe(255);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(136);
  });

  it("keeps a partial layer partial over bare parchment", () => {
    // Nothing underneath, so the colour survives untouched and the alpha is
    // what lets the base map show through in the canvas.
    const above = pack(50, 60, 70, 140);
    expect(blendPackedRgbaOver(0, above)).toBe(above);
  });
});

describe("stackChronicleFillLuts", () => {
  it("hands a lone layer straight back rather than copying it", () => {
    // The common case is the nation fill on its own, which is what the studio
    // has always drawn; it must not pay an allocation for a stack of one.
    const only = Uint32Array.of(0, pack(1, 2, 3, 255));
    expect(stackChronicleFillLuts([null, only, undefined])).toBe(only);
  });

  it("is empty when nothing is switched on", () => {
    expect(stackChronicleFillLuts([null, undefined, new Uint32Array(0)])).toHaveLength(0);
  });

  it("sizes itself to the longest layer and keeps ids past a short one", () => {
    const low = Uint32Array.of(0, pack(10, 10, 10, 255));
    const high = Uint32Array.of(0, 0, 0, pack(20, 20, 20, 255));
    const out = stackChronicleFillLuts([low, high]);
    expect(out).toHaveLength(4);
    expect(out[1]).toBe(low[1]);
    expect(out[3]).toBe(high[3]);
  });

  it("composites in the order given, last on top", () => {
    const bottom = Uint32Array.of(0, pack(0, 0, 0, 255));
    const top = Uint32Array.of(0, pack(255, 255, 255, 255));
    expect(stackChronicleFillLuts([bottom, top])[1]).toBe(top[1]);
    expect(stackChronicleFillLuts([top, bottom])[1]).toBe(bottom[1]);
  });

  it("does not let a sparse upper layer erase the fill under it", () => {
    // The trade-league case: a league covers one province of a nation's two,
    // and the province it does not cover must keep the nation's colour.
    const nation = Uint32Array.of(0, pack(10, 20, 30, 255), pack(10, 20, 30, 255));
    const league = Uint32Array.of(0, pack(200, 200, 0, 140));
    const out = stackChronicleFillLuts([nation, league]);
    expect(out[2]).toBe(nation[2]);
    expect(out[1]).not.toBe(nation[1]);
    // Still carries the nation's own colour underneath rather than replacing it.
    const [r, g, b] = unpack(out[1]!);
    expect(r).toBeGreaterThan(10);
    expect(g).toBeGreaterThan(20);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(30);
  });
});

describe("desaturatePackedRgba", () => {
  it("drains the colour but keeps the coverage", () => {
    // Alpha is what makes the province a shape on the map rather than a hole in
    // it, so the mute must never touch it.
    const [r, g, b, a] = unpack(desaturatePackedRgba(pack(200, 40, 40, 190)));
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(a).toBe(190);
  });

  it("keeps a bright realm brighter than a dark one", () => {
    const bright = unpack(desaturatePackedRgba(pack(240, 240, 240, 255)))[0]!;
    const dark = unpack(desaturatePackedRgba(pack(12, 12, 12, 255)))[0]!;
    expect(bright).toBeGreaterThan(dark);
  });

  it("stays a muted mid-grey at both ends of the range", () => {
    // Never black (invisible against the deep-forest ground) and never white
    // (louder than the focused realm it is meant to sit behind).
    for (const colour of [pack(0, 0, 0, 255), pack(255, 255, 255, 255)]) {
      const grey = unpack(desaturatePackedRgba(colour))[0]!;
      expect(grey).toBeGreaterThan(60);
      expect(grey).toBeLessThan(210);
    }
  });

  it("leaves an unpainted entry alone", () => {
    expect(desaturatePackedRgba(0)).toBe(0);
  });
});

describe("focusChronicleFillLut", () => {
  const lut = Uint32Array.of(0, pack(200, 40, 40, 255), pack(40, 40, 200, 255), 0);

  it("hands the table straight back when nothing is focused", () => {
    expect(focusChronicleFillLut(lut, null)).toBe(lut);
  });

  it("keeps the focused realm's colour and mutes the rest", () => {
    const out = focusChronicleFillLut(lut, new Set([1]));
    expect(out[1]).toBe(lut[1]);
    const [r, g, b] = unpack(out[2]!);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it("greys the whole map for a realm that holds nothing that day", () => {
    // A realm founded later or destroyed earlier: every province keeps its
    // shape, nothing keeps its colour.
    const out = focusChronicleFillLut(lut, new Set<number>());
    expect(out).toHaveLength(lut.length);
    for (const id of [1, 2]) {
      const [r, g, b, a] = unpack(out[id]!);
      expect(r).toBe(g);
      expect(g).toBe(b);
      expect(a).toBe(255);
    }
  });

  it("leaves unpainted provinces unpainted", () => {
    const out = focusChronicleFillLut(lut, new Set([1]));
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(0);
  });

  it("does not write over the table it was given", () => {
    const source = Uint32Array.of(0, pack(10, 20, 30, 255));
    focusChronicleFillLut(source, new Set<number>());
    expect(source[1]).toBe(pack(10, 20, 30, 255));
  });

  it("is empty for an empty table", () => {
    expect(focusChronicleFillLut(new Uint32Array(0), new Set([1]))).toHaveLength(0);
  });
});
