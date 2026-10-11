import { logoutCharacter } from "../characters/api";
import { clearSession as clearDrinksSession, getSession as getDrinksSession } from "../drinks/session";
import { clearSession as clearSkinsSession, getSession as getSkinsSession } from "../skins/session";

/** Clears and revokes the stored skin and drink sessions that started from Profile, or those that didn't. */
async function endUploads(fromProfile: boolean): Promise<void> {
  const ended: string[] = [];
  const skin = getSkinsSession();
  if (skin && Boolean(skin.from_profile) === fromProfile) {
    clearSkinsSession();
    ended.push(skin.session_token);
  }
  const drink = getDrinksSession();
  if (drink && Boolean(drink.from_profile) === fromProfile) {
    clearDrinksSession();
    ended.push(drink.session_token);
  }
  await Promise.all(
    ended.map((token) =>
      logoutCharacter(token).catch(() => {
        // It expires on its own; the browser no longer holds it.
      }),
    ),
  );
}

/**
 * End skin and drink uploads started from Profile, so signing out leaves none open.
 * Sessions from in-game codes stay; the player redeemed those themselves.
 */
export function endProfileUploads(): Promise<void> {
  return endUploads(true);
}

/** End the skin and drink sessions in-game codes opened, when the player logs out of a code-opened Profile. */
export function endCodeUploads(): Promise<void> {
  return endUploads(false);
}

/** Revoke a Profile session along with the uploads started from it. */
export async function logoutProfile(sessionToken: string): Promise<void> {
  await Promise.all([endProfileUploads(), logoutCharacter(sessionToken)]);
}
