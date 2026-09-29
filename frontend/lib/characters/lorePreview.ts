/** Canonical Minecraft / TLibs inline format → web colour runs.

 * Use parseNameRuns / parseLoreRuns here only — do not reimplement &# / § / &
 * decoding elsewhere. Render with FormattedMcRuns.
 */

import { LEGACY_PALETTE } from "../skins/namePreview";

export type LoreRun = {
  text: string;
  color: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
};

const LEGACY = new Map(LEGACY_PALETTE.map((p) => [p.code, p.hex]));

function normalizeHex(raw: string): string | null {
  const t = raw.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/.test(t)) return `#${t.toLowerCase()}`;
  return null;
}

/** Prepend §7 when the line has no leading colour (matches API / in-game apply).

 * Format codes alone (§l / &l) are not colours — still prepend §7.
 */
export function ensureLoreGray(line: string): string {
  const s = line.trim();
  if (!s) return s;
  if (hasLeadingLoreColour(s)) return s;
  return `§7${s}`;
}

function hasLeadingLoreColour(line: string): boolean {
  if (!line) return false;
  if (line.startsWith("&#") && line.length >= 8) {
    return /^&#[0-9A-Fa-f]{6}/.test(line);
  }
  if ((line[0] === "§" || line[0] === "&") && line.length >= 2) {
    const code = line[1]!.toLowerCase();
    return "0123456789abcdef".includes(code);
  }
  if (line[0] === "#" && line.length >= 7) {
    return /^#[0-9A-Fa-f]{6}/.test(line);
  }
  return false;
}

export function hasInlineFormatCodes(raw: string): boolean {
  const s = String(raw || "");
  if (/[§&][0-9a-fk-or]/i.test(s)) return true;
  if (/&#[0-9A-Fa-f]{6}/.test(s)) return true;
  if (/#[0-9A-Fa-f]{6}/.test(s)) return true;
  return false;
}

/**
 * Parse a lore line into coloured runs (inline codes mid-line).
 * Supports §x / &x, §l/§o/§n/§m/§r, &#RRGGBB, and #RRGGBB.
 */
export function parseLoreRuns(raw: string): LoreRun[] {
  return parseInlineRuns(ensureLoreGray(raw), "#aaaaaa");
}

/**
 * Parse item name with the same §/&/# codes as lore.
 * Does not force gray — default is white for names.
 */
export function parseNameRuns(raw: string): LoreRun[] {
  return parseInlineRuns(String(raw || ""), "#ffffff");
}

function parseInlineRuns(raw: string, defaultColor: string): LoreRun[] {
  // SimpleFactions gradient names double the section sign before each code
  // (§§x§3§9…); collapse it so the stray § doesn't eat the x.
  const line = raw.replace(/§{2,}/g, "§");
  const runs: LoreRun[] = [];
  let color = defaultColor;
  let bold = false;
  let italic = false;
  let underline = false;
  let strike = false;
  let buf = "";

  const flush = () => {
    if (!buf) return;
    runs.push({ text: buf, color, bold, italic, underline, strike });
    buf = "";
  };

  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    // Minecraft RGB colours encode all six digits as separate legacy tokens.
    if ((ch === "§" || ch === "&") && line[i + 1]?.toLowerCase() === "x") {
      const hex = line.slice(i, i + 14).match(/^[§&]x((?:[§&][0-9a-f]){6})$/i);
      if (hex) {
        flush();
        color = `#${hex[1]!.replace(/[§&]/g, "").toLowerCase()}`;
        bold = italic = underline = strike = false;
        i += 14;
        continue;
      }
    }
    // TLibs / permission-groups: &#RRGGBB before plain & codes
    if (ch === "&" && i + 7 < line.length && line[i + 1] === "#") {
      const hex = normalizeHex(line.slice(i + 1, i + 8));
      if (hex) {
        flush();
        color = hex;
        bold = italic = underline = strike = false;
        i += 8;
        continue;
      }
    }
    if ((ch === "§" || ch === "&") && i + 1 < line.length) {
      const code = line[i + 1]!.toLowerCase();
      flush();
      if (code === "l") bold = true;
      else if (code === "o") italic = true;
      else if (code === "n") underline = true;
      else if (code === "m") strike = true;
      else if (code === "r") {
        color = defaultColor;
        bold = italic = underline = strike = false;
      } else if (LEGACY.has(code)) {
        color = LEGACY.get(code)!;
        bold = italic = underline = strike = false;
      }
      i += 2;
      continue;
    }
    if (ch === "#" && i + 6 < line.length) {
      const hex = normalizeHex(line.slice(i, i + 7));
      if (hex) {
        flush();
        color = hex;
        bold = italic = underline = strike = false;
        i += 7;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return runs;
}
