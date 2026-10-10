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
  /** How ownership was proved; null for links made before this was recorded. */
  link_method?: "code" | "microsoft" | null;
};

export type AccountActivity = {
  first_seen: number | null;
  last_seen: number | null;
  online: boolean;
  server_label: string | null;
};

/** Each part is null when the site can't read it. */
export type AccountOverview = {
  activity: AccountActivity | null;
  rank: string | null;
};

export type Account = {
  user: {
    discord_user_id: string;
    discord_username: string | null;
    discord_global_name: string | null;
    avatar_url: string;
    role?: string;
  };
  guild: {
    member: boolean;
    checked_at: string | null;
    fresh: boolean;
    /** False when the site could not ask Discord, so only a new sign-in shows a change. */
    can_recheck?: boolean;
  };
  minecraft: AccountMinecraft | null;
  /** True when "Connect with Microsoft" is set up on this site. */
  microsoft_link?: boolean;
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

export function getAccountOverview(): Promise<AccountOverview> {
  return accountRequest("/account/overview");
}

/** The linked player's skin face, served by our API so Mojang never sees the visitor. */
export function minecraftHeadUrl(): string {
  return `${getApiBase()}/account/minecraft/head`;
}

export type LinkedProfileSession = {
  session_token: string;
  player_uuid: string;
  expires_at: string;
  scope: string;
  realm_id: string;
};

/** A Profile session for the linked Minecraft account, in place of an in-game code. */
export function startLinkedProfileSession(): Promise<LinkedProfileSession> {
  return accountRequest("/account/profile-session", { method: "POST" });
}

export function unlinkAccountPatreon(): Promise<unknown> {
  return accountRequest("/account/patreon/unlink", { method: "POST" });
}

/** The Microsoft sign-in page that proves which Minecraft account you own. */
export async function startMicrosoftLink(): Promise<string> {
  const data = await accountRequest<{ authorize_url?: unknown }>("/account/minecraft/microsoft/start", {
    method: "POST",
  });
  if (typeof data.authorize_url !== "string" || !data.authorize_url.startsWith("https://login.microsoftonline.com/")) {
    throw new AccountApiError("Microsoft link unavailable", 502);
  }
  return data.authorize_url;
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

const IN_GAME_FALLBACK = "You can link with a code from in game instead.";

const MINECRAFT_MESSAGES: Record<string, string> = {
  denied: "Microsoft sign-in was cancelled.",
  expired: "That Microsoft sign-in took too long or was opened in another browser. Please try again.",
  guild_check_stale: "Please confirm your Discord membership again, then connect with Microsoft.",
  not_guild_member: "Linking needs you to be in the TFMC Discord server.",
  no_xbox_profile:
    "That Microsoft account has no Xbox profile yet. Sign in once at xbox.com to create one, then try again.",
  xbox_child_account: `That Microsoft account is a child account, so an adult has to add it to a Microsoft family first. ${IN_GAME_FALLBACK}`,
  xbox_region_blocked: `Xbox isn’t available in that Microsoft account’s country, so we can’t check it. ${IN_GAME_FALLBACK}`,
  xbox_adult_verification: `That Microsoft account needs age verification at xbox.com first. ${IN_GAME_FALLBACK}`,
  no_java_profile:
    "That Microsoft account doesn’t own Minecraft: Java Edition. If you have another Microsoft account, try that one.",
  minecraft_taken: "That Minecraft account is already linked to a different Discord account. Ask staff if this is wrong.",
  discord_taken: "Your Discord account is already linked to a different Minecraft account. Unlink it first.",
  unavailable: `Connecting with Microsoft isn’t available right now. ${IN_GAME_FALLBACK}`,
  error: `We couldn’t connect with Microsoft just now. Please try again. ${IN_GAME_FALLBACK}`,
};

/** The notice for /account?minecraft=…; "linked" is confirmed from the account itself. */
export function minecraftLinkMessage(status: string | null): string | null {
  if (!status || status === "linked") return null;
  return Object.hasOwn(MINECRAFT_MESSAGES, status) ? MINECRAFT_MESSAGES[status] : MINECRAFT_MESSAGES.error;
}

/** Link refusals that need the person to sign in with Discord again. */
export function needsGuildRecheck(err: unknown): boolean {
  return err instanceof AccountApiError && err.status === 403 && err.message === "guild_check_stale";
}

export function isNotGuildMember(err: unknown): boolean {
  return err instanceof AccountApiError && err.status === 403 && err.message === "not_guild_member";
}
