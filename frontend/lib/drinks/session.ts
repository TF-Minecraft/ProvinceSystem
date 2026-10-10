import type { DrinkRedeemResult } from "./api";

const STORAGE_KEY = "tfmc_drinks_session";

export type DrinksSession = {
  session_token: string;
  player_uuid: string;
  expires_at: string;
  scope?: string;
  realm_id?: string;
  allow_drink_texture?: boolean;
  allow_drink_message?: boolean;
  name_colour_stops?: number;
};

type StoredSession = DrinksSession & {
  last_submission_id?: string;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function readNonNegInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return undefined;
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
    if (typeof parsed.scope === "string" && parsed.scope.trim()) {
      out.scope = parsed.scope.trim();
    }
    if (typeof parsed.realm_id === "string" && parsed.realm_id.trim()) {
      out.realm_id = parsed.realm_id.trim().toLowerCase();
    }
    if (typeof parsed.allow_drink_texture === "boolean") {
      out.allow_drink_texture = parsed.allow_drink_texture;
    }
    if (typeof parsed.allow_drink_message === "boolean") {
      out.allow_drink_message = parsed.allow_drink_message;
    }
    const stops = readNonNegInt(parsed.name_colour_stops);
    if (stops !== undefined) {
      out.name_colour_stops = stops;
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

export function getSession(): DrinksSession | null {
  const stored = readStored();
  if (!stored) return null;
  const out: DrinksSession = {
    session_token: stored.session_token,
    player_uuid: stored.player_uuid,
    expires_at: stored.expires_at,
  };
  if (stored.scope) out.scope = stored.scope;
  if (stored.realm_id) out.realm_id = stored.realm_id;
  if (stored.allow_drink_texture !== undefined) {
    out.allow_drink_texture = stored.allow_drink_texture;
  }
  if (stored.allow_drink_message !== undefined) {
    out.allow_drink_message = stored.allow_drink_message;
  }
  if (stored.name_colour_stops !== undefined) {
    out.name_colour_stops = stored.name_colour_stops;
  }
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

/** The stored session for a redeemed code or a drink started from Profile. */
export function drinksSessionFrom(result: DrinkRedeemResult): DrinksSession {
  return {
    session_token: result.session_token,
    player_uuid: result.player_uuid,
    expires_at: result.expires_at,
    ...(result.scope ? { scope: result.scope } : {}),
    ...(result.realm_id ? { realm_id: result.realm_id } : {}),
    allow_drink_texture: result.allow_drink_texture === true,
    allow_drink_message: result.allow_drink_message === true,
    name_colour_stops:
      typeof result.name_colour_stops === "number"
        ? Math.max(0, Math.floor(result.name_colour_stops))
        : 0,
  };
}

export function setSession(session: DrinksSession): void {
  if (!canUseStorage()) return;
  const stored: StoredSession = {
    session_token: session.session_token,
    player_uuid: session.player_uuid,
    expires_at: session.expires_at,
  };
  if (session.scope) stored.scope = session.scope;
  if (session.realm_id) stored.realm_id = session.realm_id;
  if (session.allow_drink_texture !== undefined) {
    stored.allow_drink_texture = session.allow_drink_texture;
  }
  if (session.allow_drink_message !== undefined) {
    stored.allow_drink_message = session.allow_drink_message;
  }
  if (session.name_colour_stops !== undefined) {
    stored.name_colour_stops = session.name_colour_stops;
  }
  writeStored(stored);
}

export function clearSession(): void {
  if (!canUseStorage()) return;
  sessionStorage.removeItem(STORAGE_KEY);
}

export function isSessionValid(
  session: DrinksSession | null = getSession()
): boolean {
  if (!session) return false;
  const exp = Date.parse(session.expires_at);
  if (Number.isNaN(exp)) return false;
  return exp > Date.now();
}
