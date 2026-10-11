/** Backgrounds longer than this open on an excerpt with "Read full background". */
export const COLLAPSE_OVER = 1200;
const LEAD_MIN = 650;
const LEAD_MAX = 800;

/**
 * Splits a long background into the part shown first and the rest, ending the first part at a paragraph
 * break, else a sentence, else a space. Null when the whole text shows.
 */
export function splitStory(text: string): { lead: string; rest: string } | null {
  const trimmed = text.trim();
  if (trimmed.length <= COLLAPSE_OVER) return null;
  const window = trimmed.slice(0, LEAD_MAX + 1);
  const lastIn = (pattern: RegExp): number => {
    let at = -1;
    for (const m of window.matchAll(pattern)) {
      const end = m.index + m[0].length;
      if (end >= LEAD_MIN && end <= LEAD_MAX + 1) at = end;
    }
    return at;
  };
  let cut = lastIn(/\n/g);
  if (cut < 0) cut = lastIn(/[.!?]["'”’)]?\s/g);
  if (cut < 0) cut = lastIn(/\s/g);
  if (cut < 0) cut = LEAD_MAX;
  return { lead: trimmed.slice(0, cut).trimEnd(), rest: trimmed.slice(cut).trimStart() };
}

/** Paragraphs split on blank lines; single line breaks stay inside a paragraph. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
