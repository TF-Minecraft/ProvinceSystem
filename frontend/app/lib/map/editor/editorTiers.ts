import type { EditorTier } from "@/lib/map/api";

export const EDITOR_TITLE_TIERS: EditorTier[] = [
  "county",
  "duchy",
  "kingdom",
  "empire",
];

export function isEditorTier(value: string): value is EditorTier {
  return EDITOR_TITLE_TIERS.includes(value as EditorTier);
}
