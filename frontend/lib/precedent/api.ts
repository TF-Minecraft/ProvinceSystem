import { adminRequest } from "../admin/api";

export type CaseParticipant = {
  discord_user_id?: string | null;
  player_uuid?: string | null;
  name: string;
  discord_username?: string | null;
};

export type PrecedentCase = {
  id: string;
  logged_by: string;
  players: string[];
  summary: string;
  rule: string;
  ruling: string;
  punishment: string;
  created_at: string | null;
  participants?: CaseParticipant[];
};

/** A case plus its cosine distance from the query vector. */
export type PrecedentMatch = PrecedentCase & { distance: number };

export type PrecedentSearchResult = {
  matches: PrecedentMatch[];
  synthesis: string;
  /** Live relevance cutoff from the backend; drives the similarity percentage. */
  max_distance: number;
};

export type CaseInput = {
  logged_by: string;
  players: string[];
  summary: string;
  rule: string;
  ruling: string;
  punishment: string;
  participants?: CaseParticipant[];
};

/**
 * Staff panel calls, signed in by the Discord session cookie. The precedent
 * routes also accept the shared X-Staff-Key, but that is a bot secret and must
 * never reach a browser. Failures throw AccountApiError, as the panel's do.
 */
export function listCases({
  query = "",
  limit,
  offset,
}: {
  query?: string;
  limit: number;
  offset: number;
}): Promise<{ cases: PrecedentCase[]; total: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query.trim()) params.set("q", query.trim());
  return adminRequest(`/precedent/staff/cases?${params}`);
}

/** Every player name already in the corpus, for the case form's autocomplete. */
export function listKnownPlayers(): Promise<{ players: string[] }> {
  return adminRequest("/precedent/staff/players");
}

export function createCase(body: CaseInput): Promise<{ id: string }> {
  return adminRequest("/precedent/staff/log", { method: "POST", body: JSON.stringify(body) });
}

export function updateCase(caseId: string, body: CaseInput): Promise<{ updated: boolean; id: string }> {
  return adminRequest(`/precedent/staff/case/${encodeURIComponent(caseId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteCase(caseId: string): Promise<{ deleted: boolean; id: string }> {
  return adminRequest(`/precedent/staff/case/${encodeURIComponent(caseId)}`, { method: "DELETE" });
}

/** Costs a Voyage embed plus a Claude call server-side. Rate limited to 10/60s per staff member. */
export function searchPrecedent(query: string, players: string[] = []): Promise<PrecedentSearchResult> {
  return adminRequest("/precedent/staff/search", {
    method: "POST",
    body: JSON.stringify({ query, players }),
  });
}
