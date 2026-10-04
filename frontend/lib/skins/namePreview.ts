import type { LoreRun } from "../characters/lorePreview";

/** Approximate TLibs / Minecraft name colour preview for the upload form. */

export const NAME_STYLES = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
] as const;

export type NameStyle = (typeof NAME_STYLES)[number];

export const LEGACY_PALETTE: { code: string; hex: string; label: string }[] = [
  { code: "0", hex: "#000000", label: "Black" },
  { code: "1", hex: "#0000aa", label: "Dark blue" },
  { code: "2", hex: "#00aa00", label: "Dark green" },
  { code: "3", hex: "#00aaaa", label: "Dark aqua" },
  { code: "4", hex: "#aa0000", label: "Dark red" },
  { code: "5", hex: "#aa00aa", label: "Dark purple" },
  { code: "6", hex: "#ffaa00", label: "Gold" },
  { code: "7", hex: "#aaaaaa", label: "Gray" },
  { code: "8", hex: "#555555", label: "Dark gray" },
  { code: "9", hex: "#5555ff", label: "Blue" },
  { code: "a", hex: "#55ff55", label: "Green" },
  { code: "b", hex: "#55ffff", label: "Aqua" },
  { code: "c", hex: "#ff5555", label: "Red" },
  { code: "d", hex: "#ff55ff", label: "Light purple" },
  { code: "e", hex: "#ffff55", label: "Yellow" },
  { code: "f", hex: "#ffffff", label: "White" },
];

const HEX_RE = /^#?[0-9A-Fa-f]{6}$/;

export function normalizePreviewHex(token: string): string | null {
  const t = token.trim();
  if (!t) return null;
  if (t.length === 2 && (t[0] === "§" || t[0] === "&")) {
    const hit = LEGACY_PALETTE.find((p) => p.code === t[1].toLowerCase());
    return hit?.hex ?? null;
  }
  if (t.length === 1) {
    const hit = LEGACY_PALETTE.find((p) => p.code === t.toLowerCase());
    return hit?.hex ?? null;
  }
  if (!HEX_RE.test(t)) return null;
  return (t.startsWith("#") ? t : `#${t}`).toLowerCase();
}

function parseRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((n) => Math.round(n).toString(16).padStart(2, "0"))
      .join("")
  );
}

function lerp(
  from: [number, number, number],
  to: [number, number, number],
  t: number
): string {
  const c = Math.max(0, Math.min(1, t));
  return rgbToHex(
    from[0] + (to[0] - from[0]) * c,
    from[1] + (to[1] - from[1]) * c,
    from[2] + (to[2] - from[2]) * c
  );
}

export type PreviewSpan = { char: string; color: string };

/** Per-character colours matching TLibs applyColourGradient. */
export function previewSpans(
  text: string,
  colourTokens: string[]
): PreviewSpan[] {
  const plain = text || "";
  const hexes = colourTokens
    .map(normalizePreviewHex)
    .filter((h): h is string => Boolean(h));
  if (!plain) return [];
  if (hexes.length === 0) {
    return [...plain].map((char) => ({ char, color: "#ffffff" }));
  }
  if (hexes.length === 1) {
    return [...plain].map((char) => ({ char, color: hexes[0]! }));
  }
  const stops = hexes.length;
  const length = plain.length;
  return [...plain].map((char, i) => {
    const t = length === 1 ? 0 : i / (length - 1);
    let segment = Math.floor(t * (stops - 1));
    if (segment >= stops - 1) segment = stops - 2;
    const localT = t * (stops - 1) - segment;
    return {
      char,
      color: lerp(
        parseRgb(hexes[segment]!),
        parseRgb(hexes[segment + 1]!),
        localT
      ),
    };
  });
}

/**
 * Colour-stop gradient preview as LoreRun[] for FormattedMcRuns.
 * Optional styles apply to every character (picker / kit name styles).
 */
export function previewColourStopRuns(
  text: string,
  colourTokens: string[],
  styles: string[] = []
): LoreRun[] {
  const set = new Set(styles.map((s) => s.toLowerCase()));
  const bold = set.has("bold");
  const italic = set.has("italic");
  const underline = set.has("underline") || set.has("underlined");
  const strike = set.has("strikethrough") || set.has("strike");
  return previewSpans(text, colourTokens).map((span) => ({
    text: span.char,
    color: span.color,
    bold: bold || undefined,
    italic: italic || undefined,
    underline: underline || undefined,
    strike: strike || undefined,
  }));
}
