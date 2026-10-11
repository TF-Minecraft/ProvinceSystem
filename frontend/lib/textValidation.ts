/**
 * Shared free-text validation (mirrors backend src/text_validation.py).
 * UX only — API remains authoritative.
 */

export const DISPLAY_NAME_HINT = "letters, numbers, spaces, and - _ . '";

const DISPLAY_ALLOWED_EXTRA = new Set([" ", ".", "-", "_", "'"]);

/** Minecraft / legacy colour tokens. */
const COLOUR_CODE_RE = /(?:§.|[&][0-9A-Fa-fk-orK-OR]|#[0-9A-Fa-f]{6})/;

// oxlint-disable-next-line no-control-regex -- strips control characters on purpose
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

function normalizeUserText(value: string, collapseWs: boolean): string {
  let s = (value ?? "").normalize("NFKC").trim();
  if (collapseWs) {
    s = s.replace(/\s+/g, " ");
  }
  return s;
}

function hasDisallowedDisplayChar(s: string): boolean {
  for (const ch of s) {
    if (DISPLAY_ALLOWED_EXTRA.has(ch)) continue;
    // Unicode letters / decimal digits (mirrors Python L* / Nd).
    if (/^\p{L}$/u.test(ch) || /^\p{Nd}$/u.test(ch)) continue;
    return true;
  }
  return false;
}

function hasDisallowedProseChar(s: string, allowNewlines: boolean, allowColourCodes = false): boolean {
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (allowNewlines && ch === "\n") {
      i += 1;
      continue;
    }
    if (allowColourCodes) {
      if ((ch === "§" || ch === "&") && i + 1 < s.length) {
        i += 2;
        continue;
      }
      if (ch === "#" && i + 6 < s.length && /^[0-9A-Fa-f]{6}$/.test(s.slice(i + 1, i + 7))) {
        i += 7;
        continue;
      }
    }
    if (/^\p{L}$/u.test(ch) || /^\p{N}$/u.test(ch)) {
      i += 1;
      continue;
    }
    if (/^\p{P}$/u.test(ch) || /^\p{Z}$/u.test(ch)) {
      i += 1;
      continue;
    }
    if (/^\p{M}$/u.test(ch)) {
      i += 1;
      continue;
    }
    return true;
  }
  return false;
}

function labelize(field: string): string {
  const t = (field || "text").replace(/_/g, " ").trim() || "text";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function displayNameError(
  value: string | null | undefined,
  opts: { minLen: number; maxLen: number; field?: string },
): string | null {
  const s = normalizeUserText(String(value ?? ""), true);
  const label = labelize(opts.field || "name");
  if (!s) return `${label} is required`;
  if (s.length < opts.minLen) {
    return `${label} must be at least ${opts.minLen} character${opts.minLen === 1 ? "" : "s"}`;
  }
  if (s.length > opts.maxLen) {
    return `${label} must be at most ${opts.maxLen} characters`;
  }
  if (COLOUR_CODE_RE.test(s)) return `${label} cannot contain colour codes`;
  if (hasDisallowedDisplayChar(s)) {
    return `${label} may only contain ${DISPLAY_NAME_HINT}`;
  }
  return null;
}

export function isValidDisplayName(
  value: string | null | undefined,
  opts: { minLen: number; maxLen: number; field?: string },
): boolean {
  return displayNameError(value, opts) === null;
}

/** Empty/whitespace is ok (returns null error). */
export function optionalDisplayNameError(
  value: string | null | undefined,
  opts: { maxLen: number; field?: string },
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return displayNameError(raw, {
    minLen: 1,
    maxLen: opts.maxLen,
    field: opts.field,
  });
}

export function proseError(
  value: string | null | undefined,
  opts: {
    minLen: number;
    maxLen: number;
    field?: string;
    allowNewlines?: boolean;
    allowColourCodes?: boolean;
  },
): string | null {
  let s = normalizeUserText(String(value ?? ""), false);
  const label = labelize(opts.field || "text");
  const allowNewlines = Boolean(opts.allowNewlines);
  const allowColourCodes = Boolean(opts.allowColourCodes);
  if (!s) return `${label} is required`;
  if (!allowNewlines && (s.includes("\n") || s.includes("\r"))) {
    return `${label} cannot contain line breaks`;
  }
  if (allowNewlines) {
    s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (CONTROL_RE.test(s.replace(/\n/g, ""))) {
      return `${label} contains invalid control characters`;
    }
  } else if (CONTROL_RE.test(s) || s.includes("\n") || s.includes("\r")) {
    return `${label} contains invalid control characters`;
  }
  if (!allowColourCodes && COLOUR_CODE_RE.test(s)) {
    return `${label} cannot contain colour codes`;
  }
  if (s.length < opts.minLen) {
    return `${label} must be at least ${opts.minLen} character${opts.minLen === 1 ? "" : "s"}`;
  }
  if (s.length > opts.maxLen) {
    return `${label} must be at most ${opts.maxLen} characters`;
  }
  if (hasDisallowedProseChar(s, allowNewlines, allowColourCodes)) {
    return `${label} contains characters that are not allowed`;
  }
  return null;
}

export function isValidProse(
  value: string | null | undefined,
  opts: {
    minLen: number;
    maxLen: number;
    field?: string;
    allowNewlines?: boolean;
  },
): boolean {
  return proseError(value, opts) === null;
}
