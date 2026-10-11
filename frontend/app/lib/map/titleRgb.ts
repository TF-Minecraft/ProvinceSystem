import { normalizePreviewHex } from "@/lib/skins/namePreview";

/** Matches backend editor_validation rgb format. */
const TITLE_RGB_PATTERN = /^\d{1,3},\d{1,3},\d{1,3}$/;

const TWEAK_DELTAS = [1, -1, 2, -2, 3, -3, 5, -5, 8, -8, 10, -10];

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toRgbString(r: number, g: number, b: number): string {
  return `${r},${g},${b}`;
}

export function parseRgbString(s: string): [number, number, number] | null {
  const trimmed = (s || "").trim();
  if (!TITLE_RGB_PATTERN.test(trimmed)) return null;

  const parts = trimmed.split(",").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  if (parts.some((n) => n < 0 || n > 255)) return null;

  return [parts[0]!, parts[1]!, parts[2]!];
}

export function rgbStringToHex(rgb: string): string | null {
  const parsed = parseRgbString(rgb);
  if (!parsed) return null;
  const [r, g, b] = parsed;
  const hex = [r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("");
  return `#${hex}`;
}

export function hexToRgbString(hex: string): string | null {
  const normalized = normalizePreviewHex(hex);
  if (!normalized) return null;
  const raw = normalized.slice(1);
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return toRgbString(r, g, b);
}

function normalizeUsedSet(usedRgbs: ReadonlySet<string> | readonly string[]): Set<string> {
  const used = new Set<string>();
  for (const item of usedRgbs) {
    const parsed = parseRgbString(item);
    if (parsed) {
      used.add(toRgbString(...parsed));
    }
  }
  return used;
}

/** Port of county_editor.py tweak_rgb_near — find nearby unused map title rgb. */
export function tweakRgbNear(baseRgb: string, usedRgbs: ReadonlySet<string> | readonly string[]): string {
  const base = parseRgbString(baseRgb);
  if (!base) return baseRgb.trim();

  const normalizedBase = toRgbString(...base);
  const used = normalizeUsedSet(usedRgbs);
  if (!used.has(normalizedBase)) return normalizedBase;

  const [br, bg, bb] = base;
  for (const delta of TWEAK_DELTAS) {
    for (let axis = 0; axis < 3; axis += 1) {
      const cand: [number, number, number] = [br, bg, bb];
      cand[axis] = clampByte(cand[axis] + delta);
      const candidate = toRgbString(...cand);
      if (!used.has(candidate)) return candidate;
    }
  }

  return normalizedBase;
}
