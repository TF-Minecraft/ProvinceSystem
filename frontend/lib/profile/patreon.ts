import { authHeaders, getApiBase } from "../characters/api";

export type PatreonStatus = {
  linked: boolean;
  method?: string | null;
  patreon_name?: string | null;
  tier_key?: string | null;
  tier_name?: string | null;
  patron_status?: string | null;
  is_gifted?: boolean;
  grace_until?: string | null;
  has_discord?: boolean;
  has_minecraft?: boolean;
};

export type SupporterPanelState =
  | "not_linked"
  | "linked_tier"
  | "linked_no_tier"
  | "grace";

export function selectSupporterPanelState(
  status: PatreonStatus
): SupporterPanelState {
  if (!status.linked) return "not_linked";
  if (status.grace_until) return "grace";
  if (status.tier_key || status.tier_name) return "linked_tier";
  return "linked_no_tier";
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function patreonRequest(
  path: string,
  sessionToken: string,
  init?: RequestInit
): Promise<unknown> {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      ...authHeaders(sessionToken),
      ...(init?.headers || {}),
    },
  });
  const data = await parseJson(response);
  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? (data as { detail?: unknown }).detail
        : null;
    throw Object.assign(
      new Error(typeof detail === "string" ? detail : `Request failed (${response.status})`),
      { status: response.status }
    );
  }
  return data;
}

export async function getPatreonStatus(
  sessionToken: string
): Promise<PatreonStatus> {
  const data = await patreonRequest("/patreon/status", sessionToken);
  if (!data || typeof data !== "object" || typeof (data as PatreonStatus).linked !== "boolean") {
    throw new Error("Invalid supporter status");
  }
  return data as PatreonStatus;
}

export async function startPatreonLink(sessionToken: string): Promise<string> {
  const data = await patreonRequest("/patreon/link/start", sessionToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const authorizeUrl =
    data && typeof data === "object"
      ? (data as { authorize_url?: unknown }).authorize_url
      : null;
  if (typeof authorizeUrl !== "string") {
    throw new Error("Could not start Patreon linking");
  }
  return authorizeUrl;
}

export async function unlinkPatreon(sessionToken: string): Promise<void> {
  await patreonRequest("/patreon/link/unlink", sessionToken, {
    method: "POST",
  });
}
