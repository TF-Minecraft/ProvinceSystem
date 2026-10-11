export interface WikiSearchEntry {
  href: string;
  pageTitle: string;
  sectionTitle?: string;
  text: string;
}

export interface RankedWikiSearchEntry extends WikiSearchEntry {
  snippet: string;
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
}

function excerpt(text: string, query: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 150) return compact;

  const normalizedText = normalizeSearchText(compact);
  const firstToken = normalizeSearchText(query).split(" ")[0];
  const matchAt = firstToken ? normalizedText.indexOf(firstToken) : -1;
  const start = Math.max(0, matchAt - 55);
  const clipped = compact.slice(start, start + 150).trim();
  return `${start > 0 ? "..." : ""}${clipped}${start + 150 < compact.length ? "..." : ""}`;
}

function scoreEntry(entry: WikiSearchEntry, normalizedQuery: string, tokens: string[]): number {
  const pageTitle = normalizeSearchText(entry.pageTitle);
  const sectionTitle = normalizeSearchText(entry.sectionTitle ?? "");
  const body = normalizeSearchText(entry.text);
  const searchable = `${pageTitle} ${sectionTitle} ${body}`;

  if (!tokens.every((token) => searchable.includes(token))) return 0;

  let score = 1;
  if (pageTitle === normalizedQuery) score += 1200;
  else if (pageTitle.startsWith(normalizedQuery)) score += 750;
  else if (pageTitle.includes(normalizedQuery)) score += 500;

  if (sectionTitle === normalizedQuery) score += 900;
  else if (sectionTitle.startsWith(normalizedQuery)) score += 550;
  else if (sectionTitle.includes(normalizedQuery)) score += 350;

  for (const token of tokens) {
    if (pageTitle.split(" ").includes(token)) score += 140;
    if (sectionTitle.split(" ").includes(token)) score += 110;
    if (body.includes(token)) score += 10;
  }
  return score;
}

export function searchWikiIndex(entries: WikiSearchEntry[], query: string, limit = 8): RankedWikiSearchEntry[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const tokens = normalizedQuery.split(" ").filter(Boolean);

  return entries
    .map((entry, position) => ({ entry, position, score: scoreEntry(entry, normalizedQuery, tokens) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, limit)
    .map(({ entry }) => ({ ...entry, snippet: excerpt(entry.text, query) }));
}
