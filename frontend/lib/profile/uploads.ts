import { logoutCharacter } from "../characters/api";
import {
  clearSession as clearDrinksSession,
  getSession as getDrinksSession,
} from "../drinks/session";
import {
  clearSession as clearSkinsSession,
  getSession as getSkinsSession,
} from "../skins/session";

/**
 * End skin and drink uploads started from Profile, so signing out leaves none open.
 * Sessions from in-game codes stay; the player redeemed those themselves.
 */
export async function endProfileUploads(): Promise<void> {
  const ended: string[] = [];
  const skin = getSkinsSession();
  if (skin?.from_profile) {
    clearSkinsSession();
    ended.push(skin.session_token);
  }
  const drink = getDrinksSession();
  if (drink?.from_profile) {
    clearDrinksSession();
    ended.push(drink.session_token);
  }
  await Promise.all(
    ended.map((token) =>
      logoutCharacter(token).catch(() => {
        // It expires on its own; the browser no longer holds it.
      })
    )
  );
}

/** Revoke a Profile session along with the uploads started from it. */
export async function logoutProfile(sessionToken: string): Promise<void> {
  await Promise.all([endProfileUploads(), logoutCharacter(sessionToken)]);
}
