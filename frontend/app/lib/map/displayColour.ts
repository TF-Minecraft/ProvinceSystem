/**
 * Client port of `backend/src/scripts/util/display_colour.py`.
 *
 * The live map's realm overlays are not the faction's raw RGB. They are run
 * through this wash first — hue kept, saturation and lightness pulled into the
 * parchment range, then blended a little toward the paper — and the chronicle
 * fill uses the same triples so a day reads as the map did that day.
 *
 * The arithmetic matches CPython's `colorsys` and the server's `int()` truncate
 * on the final paper blend. A one-level drift here is a nation that no longer
 * matches its own overlay.
 */

const PAPER_HIGH = [240, 230, 210] as const;
const WARM_HUE_CENTER = 40 / 360;
const GREEN_HUE_MIN = 80 / 360;
const GREEN_HUE_MAX = 160 / 360;
const WARM_HUE_PULL = 0.12;

const SATURATION_SCALE = 0.5;
const FILL_SATURATION_MAX = 0.48;
const FILL_LIGHTNESS_MIN = 0.42;
const FILL_LIGHTNESS_MAX = 0.58;
const PARCHMENT_BLEND = 0.08;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Python's `%` for a modulus of 1, which wraps negatives the other way from JS. */
function pyMod1(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function rgbToHls(r: number, g: number, b: number): [number, number, number] {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const sumc = maxc + minc;
  const rangec = maxc - minc;
  const lightness = sumc / 2;
  if (minc === maxc) return [0, lightness, 0];
  const saturation = lightness <= 0.5 ? rangec / sumc : rangec / (2 - sumc);
  const rc = (maxc - r) / rangec;
  const gc = (maxc - g) / rangec;
  const bc = (maxc - b) / rangec;
  let hue: number;
  if (r === maxc) hue = bc - gc;
  else if (g === maxc) hue = 2 + rc - bc;
  else hue = 4 + gc - rc;
  return [pyMod1(hue / 6), lightness, saturation];
}

function hlsChannel(m1: number, m2: number, hue: number): number {
  const wrapped = pyMod1(hue);
  if (wrapped < 1 / 6) return m1 + (m2 - m1) * wrapped * 6;
  if (wrapped < 0.5) return m2;
  if (wrapped < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - wrapped) * 6;
  return m1;
}

function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  return [
    hlsChannel(m1, m2, h + 1 / 3),
    hlsChannel(m1, m2, h),
    hlsChannel(m1, m2, h - 1 / 3),
  ];
}

/**
 * `display_colour.parchment_wash_rgb` / `display_rgb`. Home-land colour for a
 * realm overlay.
 */
export function parchmentWashRgb(
  rgb: readonly [number, number, number]
): [number, number, number] {
  let [hue, lightness, saturation] = rgbToHls(
    rgb[0] / 255,
    rgb[1] / 255,
    rgb[2] / 255
  );
  if (hue >= GREEN_HUE_MIN && hue <= GREEN_HUE_MAX) {
    hue = hue + (WARM_HUE_CENTER - hue) * WARM_HUE_PULL;
  }
  lightness =
    FILL_LIGHTNESS_MIN + lightness * (FILL_LIGHTNESS_MAX - FILL_LIGHTNESS_MIN);
  saturation = Math.min(saturation * SATURATION_SCALE, FILL_SATURATION_MAX);

  const [r, g, b] = hlsToRgb(hue, lightness, saturation);
  const washed: [number, number, number] = [
    clampByte(r * 255),
    clampByte(g * 255),
    clampByte(b * 255),
  ];
  // `_lerp_rgb` truncates with `int()`. Re-rounding would miss the server by a
  // level on colours that land just under an integer.
  return [
    Math.trunc(washed[0] + (PAPER_HIGH[0] - washed[0]) * PARCHMENT_BLEND),
    Math.trunc(washed[1] + (PAPER_HIGH[1] - washed[1]) * PARCHMENT_BLEND),
    Math.trunc(washed[2] + (PAPER_HIGH[2] - washed[2]) * PARCHMENT_BLEND),
  ];
}
