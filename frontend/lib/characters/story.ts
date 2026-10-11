/** Backgrounds longer than this open on an excerpt with "Read full background". */
export const COLLAPSE_OVER = 1200;
const LEAD_MIN = 650;
const LEAD_MAX = 800;

/**
 * The opening of a long background, ending at a paragraph break, else a sentence, else a word (with an
 * ellipsis). Null when the whole text shows.
 */
export function splitStory(text: string): { lead: string } | null {
  const trimmed = text.trim();
  if (trimmed.length <= COLLAPSE_OVER) return null;
  const window = trimmed.slice(0, LEAD_MAX + 1);
  const lastEnd = (pattern: RegExp): number => {
    let at = -1;
    for (const m of window.matchAll(pattern)) {
      const end = m.index + m[0].length;
      if (end >= LEAD_MIN && end <= LEAD_MAX + 1) at = end;
    }
    return at;
  };
  const whole = lastEnd(/\n\s*\n/g);
  if (whole >= 0) return { lead: trimmed.slice(0, whole).trimEnd() };
  const sentence = lastEnd(/[.!?]["'”’)]?\s/g);
  if (sentence >= 0) return { lead: trimmed.slice(0, sentence).trimEnd() };
  const word = lastEnd(/\s/g);
  return { lead: `${trimmed.slice(0, word >= 0 ? word : LEAD_MAX).trimEnd()}…` };
}

/** Paragraphs split on blank lines; single line breaks stay inside a paragraph. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
