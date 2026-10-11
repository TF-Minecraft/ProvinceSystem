import type { MapId } from "@/app/components/map/types";
import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import { EDITOR_TITLE_TIERS } from "@/app/lib/map/editor/editorTiers";
import type { EditorTier } from "@/lib/map/api";
import { strToU8, zipSync } from "fflate";

import { serializeTitleDraftForSave } from "./validateEditorDraft";

export const EDITOR_TIER_FILES: Record<EditorTier, string> = {
  county: "county.json",
  duchy: "duchy.json",
  kingdom: "kingdom.json",
  empire: "empire.json",
};

export function editorTitlesZipFilename(mapId: MapId, date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mapId}-titles-${yyyy}-${mm}-${dd}.zip`;
}

export function buildEditorTitlesZip(drafts: Record<EditorTier, TitleDraft>): Uint8Array {
  const files: Record<string, Uint8Array> = {};

  for (const tier of EDITOR_TITLE_TIERS) {
    const serialized = serializeTitleDraftForSave(drafts[tier], tier);
    const json = `${JSON.stringify(serialized, null, 2)}\n`;
    files[EDITOR_TIER_FILES[tier]] = strToU8(json);
  }

  return zipSync(files);
}
