import type { PrecedentCase } from "./api";

/**
 * No similarity-score helpers live here on purpose.
 *
 * The UI shows the matched cases and nothing about how closely they matched: a
 * percentage next to a case anchors the reader's judgement before they have
 * read it, and the backend's ordering is a retrieval artefact, not a finding
 * about which precedent ought to govern. `distance` and `max_distance` are
 * still returned by the API for tuning and debugging.
 */

/**
 * Client-side substring filter over already-loaded rows. Deliberately not a
 * server round-trip: browsing must never touch the embedding/Claude pipeline.
 */
export function caseMatchesFilter(row: PrecedentCase, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [row.summary, row.rule, row.ruling, row.punishment, row.logged_by, ...(row.players || [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterCases(rows: PrecedentCase[], filter: string): PrecedentCase[] {
  const needle = filter.trim();
  if (!needle) return rows;
  return rows.filter((row) => caseMatchesFilter(row, needle));
}

/**
 * Strip Markdown emphasis from the synthesis.
 *
 * Claude writes Markdown and Discord's embed renders it, but the web shows the
 * text verbatim, so the markers leak through as literal asterisks. Stripping
 * beats rendering here: the synthesis is a short advisory paragraph, not a
 * document, and parsing model output as markup would be a needless injection
 * surface.
 */
export function cleanSynthesis(text: string): string {
  // [\s\S] rather than the /s flag: this project's TS target predates ES2018.
  return text
    .replace(/\*\*\*([\s\S]+?)\*\*\*/g, "$1")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/(^|\s)\*(\S(?:[\s\S]*?\S)?)\*(?=\s|$)/g, "$1$2")
    .replace(/(^|\s)__([\s\S]+?)__(?=\s|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

/** Comma-separated player field <-> array, matching the Discord cog's split. */
export function parsePlayers(raw: string): string[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Visual weight for a field, so severity reads without being read. */
export type Tone = "positive" | "negative" | "warning" | "neutral";

/** Upheld vs overturned: the two outcomes staff scan for first. */
export function rulingTone(ruling: string): Tone {
  const v = ruling.trim().toLowerCase();
  if (!v) return "neutral";
  if (/(overturn|revers|pardon|acquit|denied|void|dismiss|rejected|not guilty)/.test(v)) {
    return "negative";
  }
  // Whole-string match only. A substring test would swallow informative
  // rulings that merely contain an affirmative word, e.g. "Confirmed via
  // replay mod footage, admitted after questioning" is evidence detail worth
  // showing, not the bare default outcome.
  if (/^(upheld|uphold|guilty|confirmed|accepted)\.?$/.test(v)) {
    return "positive";
  }
  return "neutral";
}

/**
 * The ruling worth rendering, or null when it carries no information.
 *
 * Nearly every case is upheld, so printing "Upheld" on every row is noise that
 * buries the rare pardon or overturn. Only the exceptions get shown.
 */
export function visibleRuling(ruling: string): string | null {
  const v = ruling.trim();
  if (!v) return null;
  return rulingTone(v) === "positive" ? null : v;
}

/**
 * Severity of the punishment. Permanent removals and multi-year bans read as
 * the heaviest; short bans and warnings as intermediate; nothing as neutral.
 */
export function punishmentTone(punishment: string): Tone {
  const v = punishment.trim().toLowerCase();
  if (!v || /^(none|n\/a|no punishment)$/.test(v)) return "neutral";
  if (/(perma|permanent|blacklist|ip.?ban)/.test(v)) return "negative";
  // Bare durations: years are severe, hours/days are not.
  if (/\d+\s*y/.test(v)) return "negative";
  if (/\d+\s*(h|d|w|m(?!o?nth.*perma))/.test(v)) return "warning";
  if (/(warn|notify|verbal|caution)/.test(v)) return "warning";
  if (/ban|mute|kick|jail/.test(v)) return "warning";
  return "neutral";
}

export function formatCreatedAt(iso: string | null): string {
  if (!iso) return "unknown date";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "unknown date";
  return new Date(parsed).toISOString().slice(0, 10);
}
