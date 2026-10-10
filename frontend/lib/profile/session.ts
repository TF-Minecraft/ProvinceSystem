const STORAGE_KEY = "tfmc_profile_session";

export type ProfileSession = {
  session_token: string;
  player_uuid: string;
  expires_at: string;
  scope?: string;
  realm_id?: string;
  remember_me?: boolean;
  /** "discord" when opened through a linked Discord sign-in rather than an in-game code. */
  source?: "discord";
};

type StoredSession = ProfileSession;

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function parseStored(raw: string | null): StoredSession | null {
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
    if (parsed.remember_me === true) {
      out.remember_me = true;
    }
    if (parsed.source === "discord") {
      out.source = "discord";
    }
    return out;
  } catch {
    return null;
  }
}

function readStored(): StoredSession | null {
  if (!canUseStorage()) return null;
  const fromLocal = parseStored(localStorage.getItem(STORAGE_KEY));
  if (fromLocal) {
    fromLocal.remember_me = true;
    return fromLocal;
  }
  return parseStored(sessionStorage.getItem(STORAGE_KEY));
}

function writeStored(stored: StoredSession, remember: boolean): void {
  if (!canUseStorage()) return;
  const payload = JSON.stringify(stored);
  if (remember) {
    localStorage.setItem(STORAGE_KEY, payload);
    sessionStorage.removeItem(STORAGE_KEY);
  } else {
    sessionStorage.setItem(STORAGE_KEY, payload);
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function getSession(): ProfileSession | null {
  return readStored();
}

export function setSession(session: ProfileSession, rememberMe = false): void {
  if (!canUseStorage()) return;
  const stored: StoredSession = {
    session_token: session.session_token,
    player_uuid: session.player_uuid,
    expires_at: session.expires_at,
  };
  if (session.scope) stored.scope = session.scope;
  if (session.realm_id) stored.realm_id = session.realm_id;
  if (rememberMe) stored.remember_me = true;
  if (session.source === "discord") stored.source = "discord";
  writeStored(stored, rememberMe);
}

export function clearSession(): void {
  if (!canUseStorage()) return;
  sessionStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
}

export function isSessionValid(
  session: ProfileSession | null = getSession()
): boolean {
  if (!session) return false;
  const exp = Date.parse(session.expires_at);
  if (Number.isNaN(exp)) return false;
  return exp > Date.now();
}
