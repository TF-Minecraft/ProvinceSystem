import { getApiBase, detailMessage, parseJson } from "../site/api";
import { getSession } from "@/lib/characters/session";
import { isCharacterUiDev, UI_DEV_SESSION_TOKEN } from "@/lib/characters/uiDev";

export class PrecedentApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PrecedentApiError";
    this.status = status;
  }
}

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

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error("Could not reach the API. Please try again.");
  }
}

/**
 * Bearer session headers. The precedent routes also accept the shared
 * X-Staff-Key, but that is a bot/plugin secret and must never reach a browser,
 * so the website always authenticates as the individual staff member.
 */
function authHeaders(sessionToken?: string): Record<string, string> {
  let token = (sessionToken || getSession()?.session_token || "").trim();
  // Local UI iteration has no redeemed session; the backend accepts this token
  // only when CHARACTER_UI_DEV=1 is also set there.
  if (!token && isCharacterUiDev()) {
    token = UI_DEV_SESSION_TOKEN;
  }
  if (!token) {
    throw new PrecedentApiError("Sign in required", 401);
  }
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(
  path: string,
  init: RequestInit,
  fallbackError: string,
  sessionToken?: string
): Promise<T> {
  const res = await apiFetch(`${getApiBase()}${path}`, {
    ...init,
    headers: { ...authHeaders(sessionToken), ...(init.headers || {}) },
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new PrecedentApiError(detailMessage(data, fallbackError), res.status);
  }
  return data as T;
}

function jsonBody(body: CaseInput): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function listCases(
  sessionToken?: string
): Promise<{ cases: PrecedentCase[]; total: number }> {
  return request(
    "/precedent/staff/cases",
    { method: "GET" },
    "Could not load precedent cases",
    sessionToken
  );
}

export async function createCase(
  body: CaseInput,
  sessionToken?: string
): Promise<{ id: string }> {
  return request(
    "/precedent/staff/log",
    { method: "POST", ...jsonBody(body) },
    "Could not log the case",
    sessionToken
  );
}

export async function updateCase(
  caseId: string,
  body: CaseInput,
  sessionToken?: string
): Promise<{ updated: boolean; id: string }> {
  return request(
    `/precedent/staff/case/${encodeURIComponent(caseId)}`,
    { method: "PUT", ...jsonBody(body) },
    "Could not save the case",
    sessionToken
  );
}

export async function deleteCase(
  caseId: string,
  sessionToken?: string
): Promise<{ deleted: boolean; id: string }> {
  return request(
    `/precedent/staff/case/${encodeURIComponent(caseId)}`,
    { method: "DELETE" },
    "Could not delete the case",
    sessionToken
  );
}

/** Costs a Voyage embed plus a Claude call server-side. Rate limited to 10/60s. */
export async function searchPrecedent(
  query: string,
  players: string[] = [],
  sessionToken?: string
): Promise<PrecedentSearchResult> {
  return request(
    "/precedent/staff/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, players }),
    },
    "Precedent search failed",
    sessionToken
  );
}
