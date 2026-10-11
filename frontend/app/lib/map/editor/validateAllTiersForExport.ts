import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import { EDITOR_TITLE_TIERS } from "@/app/lib/map/editor/editorTiers";
import type { EditorTier } from "@/lib/map/api";

import { validateEditorDraft, type ValidationResult } from "./validateEditorDraft";

const TIER_LABELS: Record<EditorTier, string> = {
  county: "County",
  duchy: "Duchy",
  kingdom: "Kingdom",
  empire: "Empire",
};

const CHILD_TIER_FOR: Partial<Record<EditorTier, EditorTier>> = {
  duchy: "county",
  kingdom: "duchy",
  empire: "kingdom",
};

export type TierDraftMap = Record<EditorTier, TitleDraft>;

export function validateAllTiersForExport(drafts: TierDraftMap): ValidationResult {
  const errors: string[] = [];

  for (const tier of EDITOR_TITLE_TIERS) {
    const draft = drafts[tier];
    if (tier !== "county" && Object.keys(draft).length === 0) {
      continue;
    }

    const childTier = CHILD_TIER_FOR[tier];
    const childTierSnapshot = childTier ? drafts[childTier] : {};

    const result = validateEditorDraft({
      tier,
      draft: drafts[tier],
      childTierSnapshot,
    });

    if (!result.ok) {
      const label = TIER_LABELS[tier];
      for (const message of result.errors) {
        errors.push(`${label}: ${message}`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}
