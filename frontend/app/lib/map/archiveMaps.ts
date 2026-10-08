import type { AccessibleMapEntry } from "@/lib/map/api";
import type { MapId } from "@/app/components/map/types";

const LIVE_SOCKET_IDS = new Set(["main", "dev"]);

function displayNameKey(entry: AccessibleMapEntry): string {
  return (entry.display_name || entry.id).trim().toLowerCase();
}

/**
 * Frozen chapters for the Earlier chapters picker. `main` and `dev` never appear,
 * even if someone sets `archived: true` on them in yaml.
 */
export function archivedChapterMaps(
  maps: AccessibleMapEntry[] | null | undefined
): AccessibleMapEntry[] {
  const chapters = (maps ?? []).filter(
    (entry) => entry.archived === true && !LIVE_SOCKET_IDS.has(entry.id)
  );
  return [...chapters].sort((a, b) => {
    const byName = displayNameKey(a).localeCompare(displayNameKey(b));
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
}

/**
 * True only when the accessible list has this id with `archived: true`.
 * A missing row is live chrome until the list lands.
 */
export function isArchivedMap(
  mapId: MapId,
  maps: AccessibleMapEntry[] | null | undefined
): boolean {
  const entry = (maps ?? []).find((item) => item.id === mapId);
  return entry?.archived === true;
}

/**
 * Live maps always show Review History (no index fetch). Archived chapters
 * show it only when the accessible list says they have captured days.
 */
export function showReviewHistory(
  mapId: MapId,
  maps: AccessibleMapEntry[] | null | undefined
): boolean {
  if (!isArchivedMap(mapId, maps)) return true;
  const entry = (maps ?? []).find((item) => item.id === mapId);
  return entry?.has_chronicle_days === true;
}
