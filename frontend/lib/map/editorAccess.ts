import type { MapId } from "@/app/components/map/types";
import { isCharacterUiDev } from "@/lib/characters/uiDev";
import { fetchMapApi } from "@/lib/map/api";

const EDITABLE_MAP_IDS: MapId[] = ["main", "dev"];

/** Product gate: editor UI hidden until explicitly re-enabled. */
export function isMapEditorEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MAP_EDITOR_ENABLED === "1";
}

export function editorUrl(mapId: MapId): string {
  return `/map/editor?map=${encodeURIComponent(mapId)}`;
}

export async function probeCanEditMap(mapId: MapId, sessionToken: string): Promise<boolean> {
  if (!isMapEditorEnabled()) {
    return false;
  }

  if (isCharacterUiDev() && EDITABLE_MAP_IDS.includes(mapId)) {
    return true;
  }

  const token = sessionToken.trim();
  if (!token) {
    return false;
  }

  const res = await fetchMapApi(`/${mapId}/editor/provinces`, {
    sessionToken: token,
  });
  return res.ok;
}
