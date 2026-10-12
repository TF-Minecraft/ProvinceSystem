import { startViewingAs } from "../admin/api";
import { clearSession as clearDrinksSession, getSession as getDrinksSession } from "../drinks/session";
import { clearSession, clearTabSession } from "../profile/session";
import { clearSession as clearSkinsSession, getSession as getSkinsSession } from "../skins/session";
import { getAccount, stopViewingAs } from "./api";
import { endLinkedProfileSession } from "./profileSession";

/** Set on each switch, so other tabs reload rather than act as the wrong account. */
const SWITCH_KEY = "tfmc_view_switch";

/** A Profile session in this browser belongs to whoever was signed in before the switch. */
async function dropProfile(): Promise<void> {
  await endLinkedProfileSession();
  clearSession();
}

function announceSwitch(): void {
  try {
    localStorage.setItem(SWITCH_KEY, String(Date.now()));
  } catch {
    // Other tabs then catch up on their next load.
  }
}

/**
 * This tab's own Profile and Profile-started upload sessions, which would outlive a reload.
 * The shared one is left alone: the switching tab ended it and may already hold a new one.
 */
function dropTabProfile(): void {
  clearTabSession();
  if (getSkinsSession()?.from_profile) clearSkinsSession();
  if (getDrinksSession()?.from_profile) clearDrinksSession();
}

/** Calls back when another tab starts or leaves a view, once this tab has dropped its own sessions. */
export function onViewSwitch(callback: () => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key !== SWITCH_KEY) return;
    dropTabProfile();
    callback();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/** Admins: view the site as a player. A full load, so every part of the page sees the switch. */
export async function viewSiteAs(playerUuid: string): Promise<void> {
  const next = await startViewingAs(playerUuid);
  await dropProfile();
  announceSwitch();
  window.location.assign(next);
}

/** Back to the admin's own account, from a view that is open or has run out. */
export async function leaveView(): Promise<void> {
  await dropProfile();
  const next = await stopViewingAs();
  announceSwitch();
  window.location.assign(next);
}

/**
 * When the view this page shows runs out. Leaves it only if it is still the browser's
 * view; otherwise something else has switched already, so reload to show what is.
 */
export async function leaveExpiredView(expiresAt: string): Promise<void> {
  const account = await getAccount();
  if (account?.viewing_as?.expires_at === expiresAt) return leaveView();
  window.location.reload();
}
