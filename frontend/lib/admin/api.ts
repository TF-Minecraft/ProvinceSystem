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
};

export function adminErrorMessage(err: unknown): string {
  if (err instanceof AccountApiError) return ERROR_MESSAGES[err.message] ?? err.message;
  return "Something went wrong. Please try again.";
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
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
