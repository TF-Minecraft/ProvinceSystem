/**
 * The front of a Minecraft skin as a flat 16×32 picture: head, body, arms and legs with the outer
 * layer over them. Reads classic and slim arms and legacy 64×32 skins.
 */

export const FRONT_WIDTH = 16;
export const FRONT_HEIGHT = 32;

type Rgba = Uint8ClampedArray;

/** One part's front face: where it sits on the skin and where it goes in the picture. */
type Part = { sx: number; sy: number; w: number; h: number; dx: number; dy: number; mirror?: boolean };

function alphaAt(skin: Rgba, x: number, y: number): number {
  return skin[(y * 64 + x) * 4 + 3];
}

/** Slim arms leave the outer column of the right arm's front empty. */
export function isSlim(skin: Rgba, height: number): boolean {
  if (height !== 64) return false;
  for (let y = 20; y < 32; y++) if (alphaAt(skin, 54, y) !== 0) return false;
  return true;
}

function parts(slim: boolean, legacy: boolean): { base: Part[]; outer: Part[] } {
  const aw = slim ? 3 : 4;
  const ax = 4 - aw;
  const base: Part[] = [
    { sx: 8, sy: 8, w: 8, h: 8, dx: 4, dy: 0 },
    { sx: 20, sy: 20, w: 8, h: 12, dx: 4, dy: 8 },
    { sx: 44, sy: 20, w: aw, h: 12, dx: ax, dy: 8 },
    legacy
      ? { sx: 44, sy: 20, w: aw, h: 12, dx: 12, dy: 8, mirror: true }
      : { sx: 36, sy: 52, w: aw, h: 12, dx: 12, dy: 8 },
    { sx: 4, sy: 20, w: 4, h: 12, dx: 4, dy: 20 },
    legacy
      ? { sx: 4, sy: 20, w: 4, h: 12, dx: 8, dy: 20, mirror: true }
      : { sx: 20, sy: 52, w: 4, h: 12, dx: 8, dy: 20 },
  ];
  const outer: Part[] = [{ sx: 40, sy: 8, w: 8, h: 8, dx: 4, dy: 0 }];
  if (!legacy) {
    outer.push(
      { sx: 20, sy: 36, w: 8, h: 12, dx: 4, dy: 8 },
      { sx: 44, sy: 36, w: aw, h: 12, dx: ax, dy: 8 },
      { sx: 52, sy: 52, w: aw, h: 12, dx: 12, dy: 8 },
      { sx: 4, sy: 36, w: 4, h: 12, dx: 4, dy: 20 },
      { sx: 4, sy: 52, w: 4, h: 12, dx: 8, dy: 20 },
    );
  }
  return { base, outer };
}

/** Lays src over dst (straight alpha). */
function over(out: Rgba, o: number, skin: Rgba, s: number) {
  const a = skin[s + 3] / 255;
  if (a === 0) return;
  const b = out[o + 3] / 255;
  const alpha = a + b * (1 - a);
  for (let c = 0; c < 3; c++) out[o + c] = (skin[s + c] * a + out[o + c] * b * (1 - a)) / alpha;
  out[o + 3] = alpha * 255;
}

/**
 * The 16×32 RGBA front of a 64×64 or 64×32 skin, or null for any other size or a blank head (such as
 * the masked template), which isn't worth a picture.
 */
export function skinFront(skin: Rgba, width: number, height: number): Rgba | null {
  if (width !== 64 || (height !== 64 && height !== 32)) return null;
  let head = false;
  for (let y = 8; y < 16 && !head; y++) for (let x = 8; x < 16 && !head; x++) head = alphaAt(skin, x, y) !== 0;
  if (!head) return null;
  const out = new Uint8ClampedArray(FRONT_WIDTH * FRONT_HEIGHT * 4);
  const { base, outer } = parts(isSlim(skin, height), height === 32);
  for (const p of [...base, ...outer]) {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const sx = p.sx + (p.mirror ? p.w - 1 - x : x);
        over(out, ((p.dy + y) * FRONT_WIDTH + p.dx + x) * 4, skin, ((p.sy + y) * 64 + sx) * 4);
      }
    }
  }
  return out;
}
