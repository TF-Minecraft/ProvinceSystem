import type { MapId } from "@/app/components/map/types";
import { isEditorTier } from "@/app/lib/map/editor/editorTiers";
import type { EditorTier } from "@/lib/map/api";

export function parseRequiredEditorMapIdParam(value: string | null): MapId | null {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "main" || normalized === "dev") {
    return normalized;
  }
  return null;
}

export function parseEditorTierParam(value: string | null): EditorTier {
  const normalized = (value || "").trim().toLowerCase();
  return isEditorTier(normalized) ? normalized : "county";
}
