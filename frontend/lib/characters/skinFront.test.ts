import { expect, it } from "vitest";
import { FRONT_HEIGHT, FRONT_WIDTH, isSlim, skinFront } from "./skinFront";

type Px = [number, number, number, number];

function blank(height = 64): Uint8ClampedArray {
  return new Uint8ClampedArray(64 * height * 4);
}

function fill(skin: Uint8ClampedArray, x0: number, y0: number, w: number, h: number, px: Px) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) skin.set(px, (y * 64 + x) * 4);
}

function at(front: Uint8ClampedArray, x: number, y: number): Px {
  const i = (y * FRONT_WIDTH + x) * 4;
  return Array.from(front.slice(i, i + 4)) as Px;
}

const HEAD: Px = [200, 150, 100, 255];
const HAT: Px = [10, 20, 30, 255];
const BODY: Px = [1, 2, 3, 255];
const ARM: Px = [4, 5, 6, 255];
const LEG: Px = [7, 8, 9, 255];

it("lays out the head, body, arms and legs with the outer layer on top", () => {
  const skin = blank();
  fill(skin, 8, 8, 8, 8, HEAD);
  fill(skin, 40, 8, 2, 2, HAT);
  fill(skin, 20, 20, 8, 12, BODY);
  fill(skin, 44, 20, 4, 12, ARM);
  fill(skin, 52, 20, 4, 12, ARM); // the right arm's back keeps it classic
  fill(skin, 36, 52, 4, 12, ARM);
  fill(skin, 4, 20, 4, 12, LEG);
  fill(skin, 20, 52, 4, 12, LEG);
  const front = skinFront(skin, 64, 64)!;
  expect(front.length).toBe(FRONT_WIDTH * FRONT_HEIGHT * 4);
  expect(at(front, 4, 0)).toEqual(HAT);
  expect(at(front, 8, 4)).toEqual(HEAD);
  expect(at(front, 0, 8)).toEqual(ARM);
  expect(at(front, 15, 19)).toEqual(ARM);
  expect(at(front, 8, 12)).toEqual(BODY);
  expect(at(front, 4, 31)).toEqual(LEG);
  expect(at(front, 11, 20)).toEqual(LEG);
  // Beside the head is empty.
  expect(at(front, 0, 0)[3]).toBe(0);
});

it("draws slim arms three pixels wide against the body", () => {
  const skin = blank();
  fill(skin, 8, 8, 8, 8, HEAD);
  fill(skin, 44, 20, 3, 12, ARM);
  fill(skin, 36, 52, 3, 12, ARM);
  expect(isSlim(skin, 64)).toBe(true);
  const front = skinFront(skin, 64, 64)!;
  expect(at(front, 0, 8)[3]).toBe(0);
  expect(at(front, 1, 8)).toEqual(ARM);
  expect(at(front, 14, 8)).toEqual(ARM);
  expect(at(front, 15, 8)[3]).toBe(0);
});

it("mirrors the right arm and leg for a legacy 64×32 skin", () => {
  const skin = blank(32);
  fill(skin, 8, 8, 8, 8, HEAD);
  fill(skin, 44, 20, 1, 12, ARM); // the arm's outer edge only
  fill(skin, 4, 20, 4, 12, LEG);
  const front = skinFront(skin, 64, 32)!;
  expect(at(front, 0, 8)).toEqual(ARM);
  expect(at(front, 15, 8)).toEqual(ARM);
  expect(at(front, 12, 8)[3]).toBe(0);
  expect(at(front, 8, 20)).toEqual(LEG);
});

it("blends a translucent outer layer over the base", () => {
  const skin = blank();
  fill(skin, 8, 8, 8, 8, [0, 0, 0, 255]);
  fill(skin, 40, 8, 8, 8, [255, 255, 255, 128]);
  const [r, , , a] = at(skinFront(skin, 64, 64)!, 6, 2);
  expect(r).toBeGreaterThan(120);
  expect(r).toBeLessThan(135);
  expect(a).toBe(255);
});

it("has no picture for a blank head or an odd size", () => {
  const skin = blank();
  fill(skin, 20, 20, 8, 12, BODY);
  expect(skinFront(skin, 64, 64)).toBeNull();
  expect(skinFront(new Uint8ClampedArray(16 * 16 * 4), 16, 16)).toBeNull();
});
