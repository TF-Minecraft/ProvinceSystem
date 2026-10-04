/** UI-dev stubs for lore-item editor (no live API). */

import type { LoreItemRow, LoreItemsResponse } from "./api";
import creationCatalogDev from "./fixtures/creationCatalog.dev.json";

export const UI_DEV_LORE_CHARACTER_ID = "ui-dev-char-1";

let uiDevCached: LoreItemRow | null = null;

function buildFixtureItem(): LoreItemRow {
  const kit = (creationCatalogDev as { editable_kit?: unknown[] })
    .editable_kit?.[0] as
    | {
        kit_key?: string;
        path?: string;
        skin_png?: string;
        base_set?: string;
        preview?: {
          display_name?: string;
          lore?: string[];
          material?: string;
          custom_model_data?: number;
        };
      }
    | undefined;

  const basePreview = {
    display_name: kit?.preview?.display_name || "Iron Hunting Knife",
    lore: Array.isArray(kit?.preview?.lore)
      ? kit!.preview!.lore!.map(String)
      : ["A sturdy blade for trail work."],
    material: kit?.preview?.material || "IRON_SWORD",
    ...(typeof kit?.preview?.custom_model_data === "number"
      ? { custom_model_data: kit.preview.custom_model_data }
      : {}),
  };

  return {
    kit_key: kit?.kit_key || "iron_hunting_knife",
    path: kit?.path || "m.tools.IRON_HUNTING_KNIFE",
    skin_png: kit?.skin_png || "knife_skin",
    base_set: kit?.base_set || "knives",
    "2d_template": "handheld",
    "3d_template": "item_3d",
    eligible: true,
    base_preview: basePreview,
    preview: { ...basePreview, lore: [...basePreview.lore] },
    draft: {
      display_name: "Trail Knife",
      lore: ["§7Forged for §cMira§7 in the border wars."],
      existing_skin_id: null,
      submission_id: null,
      submission_status: null,
      deny_reason: null,
      state: "draft",
      name_colours: ["#55ff55"],
      name_styles: ["bold"],
    },
    pickable_skins: [
      {
        id: "ui_dev_sample_knife",
        display_name: "Sample Trail Knife",
        kind: "handheld",
        ia_namespace: "tfmc_submissions",
        staff: false,
      },
      {
        id: "smithing_knife_staff",
        display_name: "Smithing Knife",
        kind: "handheld",
        ia_namespace: "tfmc_armorshop",
        staff: true,
      },
    ],
  };
}

export function uiDevLoreItemsResponse(
  characterId: string = UI_DEV_LORE_CHARACTER_ID
): LoreItemsResponse {
  if (!uiDevCached) {
    uiDevCached = buildFixtureItem();
  }
  return { character_id: characterId, items: [uiDevCached] };
}

export function uiDevApplyCustomise(
  prev: LoreItemRow,
  input: {
    displayName: string;
    lore: string[];
    existingSkinId?: string | null;
    textureFile?: File | null;
    unsignedFile?: File | null;
    signedFile?: File | null;
    modelFile?: File | null;
    use3d?: boolean;
    nameColours?: string[];
    nameStyles?: string[];
  }
): LoreItemRow & { ok: boolean } {
  const base = prev.base_preview;
  const name = input.displayName.trim() || base.display_name;
  const customLore = input.lore.map((l) => l.trim()).filter(Boolean);
  const hasTexture = Boolean(
    input.textureFile || (input.unsignedFile && input.signedFile)
  );
  const prevDenied =
    String(prev.draft.state || "").toLowerCase() === "denied" ||
    String(prev.draft.submission_status || "").toLowerCase() === "denied";
  if (
    prevDenied &&
    !hasTexture &&
    !(input.existingSkinId && String(input.existingSkinId).trim())
  ) {
    throw new Error(
      "Skin was denied. Choose a different skin (upload or pick) and submit again."
    );
  }

  let existing = prev.draft.existing_skin_id;
  let submissionId = prev.draft.submission_id;
  let submissionStatus = prev.draft.submission_status;
  let state = prev.draft.state || "draft";
  let denyReason = prev.draft.deny_reason ?? null;

  if (hasTexture) {
    existing = null;
    submissionId = "ui-dev-pending-submission";
    submissionStatus = "pending";
    state = "pending_skin";
    denyReason = null;
  } else if (input.existingSkinId) {
    existing = input.existingSkinId;
    submissionId = null;
    submissionStatus = null;
    state = "ready";
    denyReason = null;
  }

  const next: LoreItemRow & { ok: boolean } = {
    ok: true,
    ...prev,
    preview: {
      ...base,
      display_name: name,
      lore: [...base.lore, ...customLore],
    },
    draft: {
      display_name: input.displayName.trim(),
      lore: customLore,
      existing_skin_id: existing,
      submission_id: submissionId,
      submission_status: submissionStatus,
      deny_reason: denyReason,
      state,
      name_colours: input.nameColours || [],
      name_styles: input.nameStyles || [],
    },
  };
  uiDevCached = next;
  return next;
}

export function uiDevDeleteCustomise(): void {
  uiDevCached = null;
}
