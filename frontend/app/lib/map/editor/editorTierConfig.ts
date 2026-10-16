import type { TitleLayers } from "@/app/lib/titleProvinces";
import { resolveCountyProvinces, resolveDuchyProvinces, resolveKingdomProvinces } from "@/app/lib/titleProvinces";
import type { EditorTier } from "@/lib/map/api";

export type ChildTierEditorConfig = {
  childTier: EditorTier;
  childLabel: string;
  childLabelPlural: string;
  parentLabel: string;
  parentLabelPlural: string;
  prerequisiteChildTier: EditorTier;
  prerequisiteMessage: string;
  layersNeeded: EditorTier[];
  resolveChildProvinces: (childId: string, layers: TitleLayers) => number[];
  emptyStateMessage: string;
  newButtonLabel: string;
  memberCountLabel: (count: number) => string;
  deleteConfirmLabel: string;
  sidebarEmptyState: string;
};

export const CHILD_TIER_EDITOR_CONFIG: Partial<Record<EditorTier, ChildTierEditorConfig>> = {
  duchy: {
    childTier: "county",
    childLabel: "County",
    childLabelPlural: "counties",
    parentLabel: "duchy",
    parentLabelPlural: "duchies",
    prerequisiteChildTier: "county",
    prerequisiteMessage: "Save counties before editing duchies.",
    layersNeeded: ["county"],
    resolveChildProvinces: resolveCountyProvinces,
    emptyStateMessage: "Select a duchy or create new",
    newButtonLabel: "New duchy",
    memberCountLabel: (n) => `${n} counties`,
    deleteConfirmLabel: "duchy",
    sidebarEmptyState: "Select a duchy or create new.",
  },
  kingdom: {
    childTier: "duchy",
    childLabel: "Duchy",
    childLabelPlural: "duchies",
    parentLabel: "kingdom",
    parentLabelPlural: "kingdoms",
    prerequisiteChildTier: "duchy",
    prerequisiteMessage: "Save duchies before editing kingdoms.",
    layersNeeded: ["county", "duchy"],
    resolveChildProvinces: resolveDuchyProvinces,
    emptyStateMessage: "Select a kingdom or create new",
    newButtonLabel: "New kingdom",
    memberCountLabel: (n) => `${n} duchies`,
    deleteConfirmLabel: "kingdom",
    sidebarEmptyState: "Select a kingdom or create new.",
  },
  empire: {
    childTier: "kingdom",
    childLabel: "Kingdom",
    childLabelPlural: "kingdoms",
    parentLabel: "empire",
    parentLabelPlural: "empires",
    prerequisiteChildTier: "kingdom",
    prerequisiteMessage: "Save kingdoms before editing empires.",
    layersNeeded: ["county", "duchy", "kingdom"],
    resolveChildProvinces: resolveKingdomProvinces,
    emptyStateMessage: "Select an empire or create new",
    newButtonLabel: "New empire",
    memberCountLabel: (n) => `${n} kingdoms`,
    deleteConfirmLabel: "empire",
    sidebarEmptyState: "Select an empire or create new.",
  },
};

export function getChildTierConfig(tier: EditorTier): ChildTierEditorConfig | null {
  return CHILD_TIER_EDITOR_CONFIG[tier] ?? null;
}

export function isChildTierEditor(tier: EditorTier): boolean {
  return tier in CHILD_TIER_EDITOR_CONFIG;
}
