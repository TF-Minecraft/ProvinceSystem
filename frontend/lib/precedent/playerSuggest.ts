import type { PrecedentCase } from "./api";

/**
 * Autocomplete source: names already present in the corpus.
 *
 * Deliberately not an external lookup (NameMC has no public API; Mojang's only
 * resolves exact names and is CORS-blocked from a browser). Suggesting only
 * names we already store also keeps spellings consistent, which matters because
 * search_similar boosts rows whose players overlap the query -- a fresh typo
 * silently fails to match anything.
 */
export function collectKnownPlayers(cases: PrecedentCase[]): string[] {
  const seen = new Map<string, string>();
  for (const c of cases) {
    for (const raw of c.players || []) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      // First spelling encountered wins, so casing stays stable across renders.
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** The partial name being typed: everything after the last comma. */
export function currentToken(value: string): string {
  const idx = value.lastIndexOf(",");
  return (idx === -1 ? value : value.slice(idx + 1)).trim();
}

/** Names already committed in the field, so they aren't suggested twice. */
export function committedNames(value: string): string[] {
  const parts = value.split(",");
  // The last part is what's being typed, not yet committed.
  return parts
    .slice(0, -1)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Suggestions for the token under the cursor. Prefix matches rank above
 * mid-string matches so typing "dr" offers "drterror23" before "hydra".
 */
export function suggestPlayers(value: string, known: string[], limit = 8): string[] {
  const token = currentToken(value).toLowerCase();
  if (!token) return [];
  const taken = new Set(committedNames(value).map((n) => n.toLowerCase()));

  const prefix: string[] = [];
  const contains: string[] = [];
  for (const name of known) {
    const lower = name.toLowerCase();
    if (taken.has(lower)) continue;
    if (lower === token) continue;
    if (lower.startsWith(token)) prefix.push(name);
    else if (lower.includes(token)) contains.push(name);
  }
  return [...prefix, ...contains].slice(0, limit);
}

/** Replace the token under the cursor with a chosen name. */
export function applySuggestion(value: string, name: string): string {
  const idx = value.lastIndexOf(",");
  const head = idx === -1 ? "" : value.slice(0, idx + 1);
  const prefix = head ? `${head} ` : "";
  return `${prefix}${name}, `;
}
