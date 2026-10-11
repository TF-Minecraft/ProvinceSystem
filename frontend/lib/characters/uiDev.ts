/** Local character UI iteration without redeem/API. */

import type { ProfileSession } from "../profile/session";

export function isCharacterUiDev(): boolean {
  return process.env.NEXT_PUBLIC_CHARACTER_UI_DEV === "1";
}

export const UI_DEV_SESSION_TOKEN = "ui-dev-session";

/** Fake signed-in session for UI-dev pages. */
export function uiDevSession(): ProfileSession {
  return {
    session_token: UI_DEV_SESSION_TOKEN,
    player_uuid: "00000000-0000-4000-8000-ui0000000001",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    scope: "profile",
  };
}
