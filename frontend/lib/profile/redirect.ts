import { getAccount } from "../account/api";
import { getSession, isSessionValid } from "./session";

/** True when Profile opens for this visitor, so the code pages can send them there. */
export async function canOpenProfile(): Promise<boolean> {
  if (isSessionValid(getSession())) return true;
  try {
    return Boolean((await getAccount())?.minecraft?.player_uuid);
  } catch {
    return false;
  }
}
