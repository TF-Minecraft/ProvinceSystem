import { getPlayerMeta, SkinsApiError } from "@/lib/skins/api";

export const SITE_STAFF_PERMISSION = "tfmc.map.staff";

export function playerMetaHasSiteStaffAccess(permissionFlags: Record<string, boolean> | undefined): boolean {
  return permissionFlags?.[SITE_STAFF_PERMISSION] === true;
}

/** True when the session bearer has tfmc.map.staff in player-meta. */
export async function hasSiteStaffAccess(sessionToken: string): Promise<boolean> {
  const token = sessionToken.trim();
  if (!token) return false;

  try {
    const meta = await getPlayerMeta(token);
    return playerMetaHasSiteStaffAccess(meta.permission_flags);
  } catch (err) {
    if (err instanceof SkinsApiError && err.status === 401) {
      return false;
    }
    throw err;
  }
}
