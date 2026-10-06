import { AccountApiError } from "../account/api";
import { detailMessage, getApiBase, parseJson } from "../site/api";

export type StaffRole = "player" | "mod" | "admin" | "root";

export type AdminMe = {
  user_id: number;
  discord_username: string | null;
  role: StaffRole;
  capabilities: string[];
  assignable_roles: StaffRole[];
};

export type AdminAccount = {
  user_id: number;
  discord_user_id: string;
  discord_username: string | null;
  discord_global_name: string | null;
  avatar_url: string;
  role: StaffRole;
  minecraft_name: string | null;
  created_at: string;
  last_login_at: string;
};

const RANK: Record<string, number> = { player: 0, mod: 1, admin: 2, root: 3 };

export function isStaffRole(role: string | null | undefined): boolean {
  return (RANK[role ?? ""] ?? -1) >= RANK.mod;
}

/** Mirrors the server's rule for showing actions; the server still decides. */
export function canManage(me: AdminMe, target: AdminAccount): boolean {
  return me.user_id !== target.user_id && (RANK[me.role] ?? -1) > (RANK[target.role] ?? 99);
}

const ROLE_LABELS: Record<StaffRole, string> = {
  player: "Player",
  mod: "Moderator",
  admin: "Admin",
  root: "Owner",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as StaffRole] ?? role;
}

const ERROR_MESSAGES: Record<string, string> = {
  reason_required: "Give a reason of at least 3 characters.",
  target_outranks_you: "You can only change accounts below your own role.",
  role_not_assignable: "You can’t give that role.",
  role_unchanged: "That account already has that role.",
  cannot_act_on_self: "You can’t do that to your own account.",
  account_not_found: "That account no longer exists.",
  forbidden: "Your role doesn’t allow that.",
  not_signed_in: "Your session has ended. Sign in again.",
  bad_origin: "That request was blocked. Reload the page and try again.",
  player_not_found: "No player with that UUID has been seen.",
  bad_uuid: "That isn’t a Minecraft UUID.",
  bad_session: "That session link isn’t valid.",
  session_gone: "That session is no longer in CoreProtect’s records.",
  bad_window: "Choose a time range of up to 7 days for one player, or 24 hours for everyone.",
  bad_cursor: "That page link has expired. Reload to start again.",
  bad_kinds: "That filter isn’t available.",
  bad_sort: "That sort order isn’t available.",
  query_too_long: "Search for 64 characters or fewer.",
  directory_busy: "The player list is busy. Try again in a moment.",
  audit_unavailable: "Chat and commands can’t be shown because the view couldn’t be logged. Try again.",
};

export function adminErrorMessage(err: unknown): string {
  if (err instanceof AccountApiError) return ERROR_MESSAGES[err.message] ?? err.message;
  return "Something went wrong. Please try again.";
}

export async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new AccountApiError(detailMessage(data, `Request failed (${res.status})`), res.status);
  }
  return data as T;
}

export function getAdminMe(): Promise<AdminMe> {
  return adminRequest("/admin/me");
}

export async function getStaff(): Promise<AdminAccount[]> {
  return (await adminRequest<{ staff: AdminAccount[] }>("/admin/staff")).staff;
}

export async function lookupAccounts(query: string): Promise<AdminAccount[]> {
  const q = encodeURIComponent(query.trim());
  return (await adminRequest<{ accounts: AdminAccount[] }>(`/admin/accounts/lookup?q=${q}`)).accounts;
}

export function changeRole(userId: number, role: StaffRole, reason: string): Promise<unknown> {
  return adminRequest(`/admin/accounts/${userId}/role`, {
    method: "POST",
    body: JSON.stringify({ role, reason }),
  });
}

export function revokeSessions(userId: number, reason: string): Promise<unknown> {
  return adminRequest(`/admin/accounts/${userId}/sessions/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// --------------------
// Players
// --------------------

export type CoreProtectStatus = { status: "available"; reason?: undefined } | { status: "unavailable"; reason: string };

export type PlayerSort = "last_seen" | "minecraft" | "discord" | "character";

export function parsePlayerSort(value: string | undefined): PlayerSort {
  return value === "minecraft" || value === "discord" || value === "character" ? value : "last_seen";
}

export type PlayerSummary = {
  uuid: string;
  minecraft_name: string | null;
  discord_user_id: string | null;
  discord_username: string | null;
  site_role: StaffRole | null;
  characters: string[];
  last_seen: number | null;
  online: boolean;
};

export type PlayerDirectory = {
  players: PlayerSummary[];
  total: number;
  page: number;
  page_size: number;
  coreprotect: CoreProtectStatus & { server_label: string | null };
};

export type PlayerProfile = {
  uuid: string;
  minecraft_name: string | null;
  past_names: { name: string; time: number }[];
  first_seen: number | null;
  last_seen: number | null;
  online: boolean;
  discord: {
    discord_user_id: string;
    discord_username: string | null;
    linked_at: string | null;
    left_guild_at: string | null;
    grace_until: string | null;
  } | null;
  account: {
    user_id: number;
    role: StaffRole;
    discord_global_name: string | null;
    avatar_url: string;
    created_at: string;
    last_login_at: string;
  } | null;
  characters: {
    realm_id: string;
    character_id: string;
    name: string;
    status: string | null;
    race: string | null;
    class: string | null;
    updated_at: string | null;
  }[];
  coreprotect: CoreProtectStatus & { server_label: string | null; ping_seconds: number | null };
};

export type WorldPoint = { time: number; world: string | null; x: number; y: number; z: number };

export type PlayerSession = {
  /** Opaque; names this session in /sessions/{id}/movement and in links. */
  id: string;
  start: WorldPoint;
  end: WorldPoint | null;
  end_kind: "logout" | "last_observed" | "open" | "unknown";
  duration_seconds: number | null;
  /** The newest row seen in the session: its logout, last ping or login. */
  last_observed: WorldPoint;
};

export type SessionPage = {
  sessions: PlayerSession[];
  next: string | null;
  first_seen?: number | null;
  history_start?: number | null;
  coreprotect: CoreProtectStatus;
};

export type ActivityEntry = {
  id: string;
  time: number;
  kind: string;
  verb: string;
  target: string | null;
  amount: number | null;
  victim: { minecraft_name: string; uuid: string | null } | null;
  /** Chat text, for admins only. */
  message: string | null;
  truncated: boolean;
  world: string | null;
  x: number;
  y: number;
  z: number;
  rolled_back: string | null;
};

export type ActivityPage = {
  entries: ActivityEntry[];
  next: string | null;
  searched_to: number | null;
  kinds: string[];
  /** Whether chat and whole commands are included (admins); each such view is audited. */
  shows_messages: boolean;
  coreprotect: CoreProtectStatus;
};

const COREPROTECT_REASONS: Record<string, string> = {
  not_configured: "CoreProtect isn’t connected to this site.",
  missing: "The CoreProtect database couldn’t be found.",
  cannot_open: "The CoreProtect database couldn’t be opened.",
  busy: "CoreProtect is busy. Try again in a moment.",
  timeout: "CoreProtect took too long to answer. Try again in a moment.",
  error: "CoreProtect couldn’t be read.",
};

export function coreProtectMessage(status: CoreProtectStatus): string | null {
  if (status.status === "available") return null;
  return COREPROTECT_REASONS[status.reason] ?? COREPROTECT_REASONS.error;
}

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function getPlayers(params: { q?: string; sort?: PlayerSort; page?: number }): Promise<PlayerDirectory> {
  return adminRequest(`/admin/players${query({ q: params.q?.trim(), sort: params.sort, page: params.page })}`);
}

export function getPlayer(uuid: string): Promise<PlayerProfile> {
  return adminRequest(`/admin/players/${encodeURIComponent(uuid)}`);
}

export function getPlayerSessions(uuid: string, before?: string | null): Promise<SessionPage> {
  return adminRequest(`/admin/players/${encodeURIComponent(uuid)}/sessions${query({ before })}`);
}

export function getPlayerActivity(
  uuid: string,
  params: { before?: string | null; kinds?: string[] } = {}
): Promise<ActivityPage> {
  return adminRequest(
    `/admin/players/${encodeURIComponent(uuid)}/activity${query({ before: params.before, kinds: params.kinds?.join(",") })}`
  );
}
