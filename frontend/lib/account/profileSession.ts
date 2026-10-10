import { logoutCharacter } from "../characters/api";
import { clearSession, getSession, setSession, type ProfileSession } from "../profile/session";
import { endProfileUploads } from "../profile/uploads";
import { startLinkedProfileSession } from "./api";

/** Reuse a stored session with at least this long left before asking for a new one. */
const MIN_LEFT_MS = 5 * 60_000;

function sameUuid(a: string, b: string): boolean {
  return a.replace(/-/g, "").toLowerCase() === b.replace(/-/g, "").toLowerCase();
}

/**
 * A Profile session for the Minecraft account linked to the signed-in Discord account.
 * Shared across tabs, so opening Account and Profile together asks for one session.
 */
export async function linkedProfileSession(playerUuid: string): Promise<ProfileSession> {
  const existing = getSession();
  if (
    existing &&
    sameUuid(existing.player_uuid, playerUuid) &&
    Date.parse(existing.expires_at) - Date.now() > MIN_LEFT_MS
  ) {
    return existing;
  }
  const fresh = await startLinkedProfileSession();
  const session: ProfileSession = { ...fresh, source: "discord" };
  setSession(session, true);
  return session;
}

/** Drop a Profile session opened through Discord, after signing out or unlinking. */
export async function endLinkedProfileSession(): Promise<void> {
  const existing = getSession();
  if (!existing || existing.source !== "discord") return;
  clearSession();
  await endProfileUploads();
  try {
    await logoutCharacter(existing.session_token);
  } catch {
    // It expires on its own; the browser no longer holds it.
  }
}
