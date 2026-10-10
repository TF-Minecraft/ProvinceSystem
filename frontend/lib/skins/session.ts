import type { RedeemResult } from "./api";

const STORAGE_KEY = "tfmc_skins_session";

export type SkinsSession = {
  session_token: string;
  player_uuid: string;
  expires_at: string;
  /** True when code scope is skin_staff. */
  staff?: boolean;
  scope?: string;
  /** Started from Profile rather than redeemed from an in-game code. */
  from_profile?: boolean;
  /** Server realm stamped on the mint code. */
  realm_id?: string;
  /** Rank colour stops for name picker (clamped by API to web hard cap). */
  name_colour_stops?: number;
  /** Combined texture+model byte budget for 3D kinds. */
  max_3d_pair_bytes?: number;
  /** Days between skin token mints (-1 = cannot mint; informational on session). */
  skin_token_cooldown_days?: number;
  /** Allowed upload kind ids for this session. */
  skin_kinds?: string[];
  /** When false, armor_set cannot use per-tier 3D helmets. */
  allow_armor_3d_helmet?: boolean;
};

type StoredSession = SkinsSession & {
  last_submission_id?: string;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function readNonNegInt(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

function readCooldownDays(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < -1) return undefined;
  return Math.floor(n);
}

function readSkinKinds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const kind = String(item || "")
      .trim()
      .toLowerCase();
    if (!kind || seen.has(kind)) continue;
    seen.add(kind);
    out.push(kind);
  }
  return out;
}

function readStored(): StoredSession | null {
  if (!canUseStorage()) return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed.session_token || !parsed.player_uuid || !parsed.expires_at) {
      return null;
    }
    const out: StoredSession = {
      session_token: parsed.session_token,
      player_uuid: parsed.player_uuid,
      expires_at: parsed.expires_at,
    };
    if (parsed.staff === true) {
      out.staff = true;
    }
    if (typeof parsed.scope === "string" && parsed.scope.trim()) {
      out.scope = parsed.scope.trim();
    }
    if (parsed.from_profile === true) out.from_profile = true;
    if (typeof parsed.realm_id === "string" && parsed.realm_id.trim()) {
      out.realm_id = parsed.realm_id.trim().toLowerCase();
    }
    const stops = readNonNegInt(parsed.name_colour_stops);
    if (stops !== undefined) out.name_colour_stops = stops;
    const pair = readNonNegInt(parsed.max_3d_pair_bytes);
    if (pair !== undefined) out.max_3d_pair_bytes = pair;
    const cooldown = readCooldownDays(parsed.skin_token_cooldown_days);
    if (cooldown !== undefined) out.skin_token_cooldown_days = cooldown;
    const kinds = readSkinKinds(parsed.skin_kinds);
    if (kinds !== undefined) out.skin_kinds = kinds;
    if (typeof parsed.allow_armor_3d_helmet === "boolean") {
      out.allow_armor_3d_helmet = parsed.allow_armor_3d_helmet;
    }
    const lastId =
      typeof parsed.last_submission_id === "string"
        ? parsed.last_submission_id.trim()
        : "";
    if (lastId) {
      out.last_submission_id = lastId;
    }
    return out;
  } catch {
    return null;
  }
}

function writeStored(stored: StoredSession): void {
  if (!canUseStorage()) return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function copyEntitlements(
  from: SkinsSession,
  to: SkinsSession | StoredSession
): void {
  if (from.realm_id !== undefined) {
    to.realm_id = from.realm_id;
  }
  if (from.name_colour_stops !== undefined) {
    to.name_colour_stops = from.name_colour_stops;
  }
  if (from.max_3d_pair_bytes !== undefined) {
    to.max_3d_pair_bytes = from.max_3d_pair_bytes;
  }
  if (from.skin_token_cooldown_days !== undefined) {
    to.skin_token_cooldown_days = from.skin_token_cooldown_days;
  }
  if (from.skin_kinds !== undefined) {
    to.skin_kinds = from.skin_kinds;
  }
  if (from.allow_armor_3d_helmet !== undefined) {
    to.allow_armor_3d_helmet = from.allow_armor_3d_helmet;
  }
}

export function getSession(): SkinsSession | null {
  const stored = readStored();
  if (!stored) return null;
  const out: SkinsSession = {
    session_token: stored.session_token,
    player_uuid: stored.player_uuid,
    expires_at: stored.expires_at,
  };
  if (stored.staff) out.staff = true;
  if (stored.scope) out.scope = stored.scope;
  if (stored.from_profile) out.from_profile = true;
  copyEntitlements(stored, out);
  return out;
}

export function getLastSubmissionId(): string | null {
  const stored = readStored();
  const id = stored?.last_submission_id?.trim();
  return id ? id : null;
}

export function setLastSubmissionId(id: string): void {
  const stored = readStored();
  if (!stored) return;
  const trimmed = (id || "").trim();
  if (!trimmed) {
    const { last_submission_id: _, ...rest } = stored;
    writeStored(rest);
    return;
  }
  writeStored({ ...stored, last_submission_id: trimmed });
}

/** The stored session for a redeemed code or a skin started from Profile. */
export function skinsSessionFrom(result: RedeemResult): SkinsSession {
  return {
    session_token: result.session_token,
    player_uuid: result.player_uuid,
    expires_at: result.expires_at,
    ...(result.staff ? { staff: true as const } : {}),
    ...(result.scope ? { scope: result.scope } : {}),
    ...(result.realm_id ? { realm_id: result.realm_id } : {}),
    ...(result.name_colour_stops !== undefined
      ? { name_colour_stops: result.name_colour_stops }
      : {}),
    ...(result.max_3d_pair_bytes !== undefined
      ? { max_3d_pair_bytes: result.max_3d_pair_bytes }
      : {}),
    ...(result.skin_token_cooldown_days !== undefined
      ? { skin_token_cooldown_days: result.skin_token_cooldown_days }
      : {}),
    ...(result.skin_kinds !== undefined ? { skin_kinds: result.skin_kinds } : {}),
    ...(result.allow_armor_3d_helmet !== undefined
      ? { allow_armor_3d_helmet: result.allow_armor_3d_helmet }
      : {}),
  };
}

/** New redeem: store session token fields only (no leftover last submission). */
export function setSession(session: SkinsSession): void {
  if (!canUseStorage()) return;
  const stored: StoredSession = {
    session_token: session.session_token,
    player_uuid: session.player_uuid,
    expires_at: session.expires_at,
  };
  if (session.staff) stored.staff = true;
  if (session.scope) stored.scope = session.scope;
  if (session.from_profile) stored.from_profile = true;
  copyEntitlements(session, stored);
  writeStored(stored);
}

/** Wipe token and last submission id. */
export function clearSession(): void {
  if (!canUseStorage()) return;
  sessionStorage.removeItem(STORAGE_KEY);
}

/** True if a session exists and expires_at is still in the future (UTC ISO). */
export function isSessionValid(session: SkinsSession | null = getSession()): boolean {
  if (!session) return false;
  const exp = Date.parse(session.expires_at);
  if (Number.isNaN(exp)) return false;
  return exp > Date.now();
}
