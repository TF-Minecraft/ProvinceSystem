import { detailMessage, getApiBase, parseJson } from "../site/api";
import type { PatreonStatus } from "../profile/patreon";

export class AccountApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
  }
}

export type AccountMinecraft = {
  player_uuid: string;
  minecraft_name: string | null;
  linked_at: string;
  in_grace: boolean;
  grace_until: string | null;
};

export type Account = {
  user: {
    discord_user_id: string;
    discord_username: string | null;
    discord_global_name: string | null;
    avatar_url: string;
    role?: string;
  };
  guild: { member: boolean; checked_at: string | null; fresh: boolean };
  minecraft: AccountMinecraft | null;
  patreon: PatreonStatus | null;
};

export type MinecraftLinkPreview = {
  player_uuid: string;
  minecraft_name: string | null;
  expires_at: string;
};

/** The session is an HttpOnly cookie, so every call sends credentials. */
async function accountRequest<T>(
  path: string,
  init?: RequestInit,
  opts?: { allowEmpty?: boolean }
): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new AccountApiError(detailMessage(data, `Request failed (${res.status})`), res.status);
  }
  // A missing body would otherwise read as "signed out" or an empty result.
  if (data === null && !opts?.allowEmpty) {
    throw new AccountApiError("Unexpected empty response", res.status);
  }
  return data as T;
}

export function discordSignInUrl(returnTo = "/account"): string {
  return `${getApiBase()}/auth/discord/start?return_to=${encodeURIComponent(returnTo)}`;
}

/** The account, or null when nobody is signed in. */
export async function getAccount(): Promise<Account | null> {
  try {
    return await accountRequest<Account>("/account");
  } catch (err) {
    if (err instanceof AccountApiError && err.status === 401) return null;
    throw err;
  }
}

export function signOut(): Promise<unknown> {
  return accountRequest("/auth/logout", { method: "POST" }, { allowEmpty: true });
}

export function previewMinecraftLink(code: string): Promise<MinecraftLinkPreview> {
  return accountRequest("/account/minecraft/preview", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function linkMinecraft(code: string): Promise<AccountMinecraft | null> {
  const data = await accountRequest<{ minecraft: AccountMinecraft | null }>(
    "/account/minecraft/link",
    { method: "POST", body: JSON.stringify({ code }) }
  );
  return data.minecraft;
}

export function unlinkMinecraft(): Promise<unknown> {
  return accountRequest("/account/minecraft/unlink", { method: "POST" });
}

export async function startAccountPatreonLink(): Promise<string> {
  const data = await accountRequest<{ authorize_url?: unknown }>("/account/patreon/start", {
    method: "POST",
  });
  if (typeof data.authorize_url !== "string") {
    throw new AccountApiError("Patreon link unavailable", 502);
  }
  return data.authorize_url;
}

const SIGN_IN_MESSAGES: Record<string, string> = {
  expired: "That sign-in took too long or was opened in another browser. Please try again.",
  denied: "Discord sign-in was cancelled.",
  error: "We couldn’t sign you in with Discord just now. Please try again.",
};

export function signInMessage(status: string | null): string | null {
  if (!status) return null;
  return Object.hasOwn(SIGN_IN_MESSAGES, status) ? SIGN_IN_MESSAGES[status] : SIGN_IN_MESSAGES.error;
}

/** Link refusals that need the person to sign in with Discord again. */
export function needsGuildRecheck(err: unknown): boolean {
  return err instanceof AccountApiError && err.status === 403 && err.message === "guild_check_stale";
}

export function isNotGuildMember(err: unknown): boolean {
  return err instanceof AccountApiError && err.status === 403 && err.message === "not_guild_member";
}
