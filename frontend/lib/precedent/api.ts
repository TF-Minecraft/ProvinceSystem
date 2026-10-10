import { adminRequest } from "../admin/api";

export type PrecedentCase = {
  id: string;
  logged_by: string;
  players: string[];
  summary: string;
  rule: string;
  ruling: string;
  punishment: string;
  created_at: string | null;
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
};

/**
 * Staff panel calls, signed in by the Discord session cookie. The precedent
 * routes also accept the shared X-Staff-Key, but that is a bot secret and must
 * never reach a browser. Failures throw AccountApiError, as the panel's do.
 */
export function listCases(): Promise<{ cases: PrecedentCase[]; total: number }> {
  return adminRequest("/precedent/staff/cases");
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
