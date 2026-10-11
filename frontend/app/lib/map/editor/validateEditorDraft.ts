import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import { parseRgbString } from "@/app/lib/map/titleRgb";
import type { EditorTier, EditorTitleDraft } from "@/lib/map/api";

import { findDuplicateChildIds } from "./childTitleAssignment";
import { findDuplicateProvinceIds } from "./countyAssignment";
import { getChildTierConfig } from "./editorTierConfig";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type ValidateEditorDraftOptions = {
  tier: EditorTier;
  draft: TitleDraft;
  childTierSnapshot?: TitleDraft;
  prerequisiteChildTierDirty?: boolean;
};

export function savePrerequisiteMessage(tier: EditorTier): string | null {
  const config = getChildTierConfig(tier);
  if (!config) return null;
  return config.prerequisiteMessage.replace("editing", "saving");
}

export function serializeTitleDraftForSave(draft: TitleDraft, tier: EditorTier): EditorTitleDraft {
  const out: EditorTitleDraft = {};
  for (const [id, entry] of Object.entries(draft)) {
    const base = { name: entry.name, rgb: entry.rgb };
    if (tier === "county") {
      out[id] = { ...base, provinces: [...(entry.provinces ?? [])] };
    } else {
      out[id] = { ...base, titles: [...(entry.titles ?? [])] };
    }
  }
  return out;
}

export function validateEditorDraft(options: ValidateEditorDraftOptions): ValidationResult {
  const { tier, draft, childTierSnapshot = {}, prerequisiteChildTierDirty } = options;
  const errors: string[] = [];

  if (prerequisiteChildTierDirty) {
    const message = savePrerequisiteMessage(tier);
    if (message) errors.push(message);
  }

  if (!draft || Object.keys(draft).length === 0) {
    errors.push("Title data must be a non-empty object");
    return { ok: false, errors };
  }

  const seenRgb = new Set<string>();
  const provinceOwner = new Map<number, string>();
  const childOwner = new Map<string, string>();
  const childConfig = getChildTierConfig(tier);
  const childTier = childConfig?.childTier;

  for (const [rawId, entry] of Object.entries(draft)) {
    const titleId = rawId.trim();
    if (!titleId) {
      errors.push("Title ids must be non-empty strings");
      continue;
    }

    const name = entry.name;
    if (!name || !name.trim()) {
      errors.push(`Title '${titleId}' requires a non-empty name`);
    }

    const parsedRgb = parseRgbString(entry.rgb);
    if (!parsedRgb) {
      errors.push(`Title '${titleId}' has invalid rgb (use R,G,B with 0-255)`);
    } else {
      const rgb = entry.rgb.trim();
      if (seenRgb.has(rgb)) {
        errors.push(`Duplicate rgb '${rgb}' in tier '${tier}'`);
      }
      seenRgb.add(rgb);
    }

    if (tier === "county") {
      const provinces = entry.provinces;
      if (!Array.isArray(provinces)) {
        errors.push(`County '${titleId}' requires a provinces array`);
      } else {
        for (const item of provinces) {
          if (!Number.isInteger(item)) {
            errors.push(`County '${titleId}' provinces must contain integers only`);
            break;
          }
          if (provinceOwner.has(item)) {
            const other = provinceOwner.get(item)!;
            errors.push(`Province ${item} is assigned to both '${other}' and '${titleId}'`);
          }
          provinceOwner.set(item, titleId);
        }
      }
    } else if (childTier) {
      const titles = entry.titles;
      if (!Array.isArray(titles)) {
        errors.push(`Title '${titleId}' requires a titles array`);
      } else {
        for (const item of titles) {
          const childId = String(item).trim();
          if (!childId) {
            errors.push(`Title '${titleId}' has an empty child id in titles`);
            continue;
          }
          if (!childTierSnapshot[childId]) {
            errors.push(`Title '${titleId}' references unknown ${childTier} '${childId}'`);
          }
          if (childOwner.has(childId)) {
            const other = childOwner.get(childId)!;
            errors.push(`${childTier} '${childId}' is assigned to both '${other}' and '${titleId}'`);
          }
          childOwner.set(childId, titleId);
        }
      }
    }
  }

  const duplicateProvinces = findDuplicateProvinceIds(draft);
  for (const pid of duplicateProvinces) {
    if (!errors.some((e) => e.includes(`Province ${pid}`))) {
      errors.push(`Province ${pid} is assigned to multiple counties`);
    }
  }

  const duplicateChildren = findDuplicateChildIds(draft);
  for (const childId of duplicateChildren) {
    if (childTier && !errors.some((e) => e.includes(`'${childId}' is assigned to both`))) {
      errors.push(`${childTier} '${childId}' is assigned to multiple parent titles`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}
