/** Wardrobe lock labels from catalog slot_limits groups (RPC sync). */

import type { SlotLimits } from "./api";
import { parseNameRuns, type LoreRun } from "./lorePreview";
import type { ArmModel } from "../skins/steveMannequin";

export type RankLockLabel = {
  /** Plain fallback text */
  plain: string;
  /** Coloured runs from group display_name when available */
  runs: LoreRun[];
};

function visibleGroups(slotLimits: SlotLimits | undefined) {
  const groups = slotLimits?.groups;
  if (!Array.isArray(groups)) return [];
  return groups
    .filter((g) => g && g.visible !== false)
    .slice()
    .sort((a, b) => Number(a.tier ?? 0) - Number(b.tier ?? 0));
}

/**
 * Lowest-tier visible group that grants at least `minSlots` swappable skins.
 * Rank names / thresholds come only from catalog (RPC), never hardcoded.
 */
export function groupUnlockingSlots(
  slotLimits: SlotLimits | undefined,
  minSlots: number
): { id?: string; display_name?: string; wardrobe_skin_slots?: number } | null {
  for (const g of visibleGroups(slotLimits)) {
    const n = Number(g.wardrobe_skin_slots ?? 0);
    if (n >= minSlots) return g;
  }
  return null;
}

/**
 * How many swappable slots a frame needs to unlock.
 * Structural (base=1, Skin 2 needs 2, Skin 3 needs 3) — not which rank name.
 */
export function minSlotsForExtra(slot: string): number {
  const key = String(slot || "").toLowerCase();
  if (key === "extra_2") return 3;
  if (key === "extra_1") return 2;
  return 0;
}

/** Lock copy for a wardrobe extra slot from catalog groups. */
export function lockLabelForSlot(
  slot: string,
  slotLimits: SlotLimits | undefined
): RankLockLabel {
  const minSlots = minSlotsForExtra(slot);
  if (minSlots <= 0) {
    return { plain: "a higher rank", runs: [{ text: "a higher rank", color: "#e8a0a0" }] };
  }
  const group = groupUnlockingSlots(slotLimits, minSlots);
  const display = String(group?.display_name || "").trim();
  if (display) {
    const runs = parseNameRuns(display);
    if (runs.length > 0) {
      const last = runs[runs.length - 1]!;
      return {
        plain: `${runs.map((r) => r.text).join("")}+`,
        runs: [
          ...runs.slice(0, -1),
          { ...last, text: `${last.text}+` },
        ],
      };
    }
  }
  // Catalog missing / no group grants this many slots — do not invent rank names.
  return {
    plain: "a higher rank",
    runs: [{ text: "a higher rank", color: "#e8a0a0" }],
  };
}

/** Map stored wardrobe slot model to preview arm model. */
export function wardrobeSlotToArmModel(model?: string | null): ArmModel {
  return String(model || "").trim().toLowerCase() === "slim" ? "slim" : "default";
}

/** Map preview arm model to wardrobe API / storage value. */
export function armModelToWardrobeModel(model: ArmModel): "classic" | "slim" {
  return model === "slim" ? "slim" : "classic";
}
