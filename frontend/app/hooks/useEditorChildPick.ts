"use client";

import { useMemo } from "react";

import { buildTitleProvinceRegionIndex } from "@/app/hooks/regionPick";
import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import type { TitleLayers } from "@/app/lib/titleProvinces";
import type { EditorTier } from "@/lib/map/api";

/** Province id -> the child title holding it, for editor child picking. */
export type ChildPickIndex = Map<number, string>;

function draftToLayer(draft: TitleDraft): Record<string, { provinces?: number[]; titles?: string[] }> {
  const layer: Record<string, { provinces?: number[]; titles?: string[] }> = {};
  for (const [id, entry] of Object.entries(draft)) {
    layer[id] = { provinces: entry.provinces, titles: entry.titles };
  }
  return layer;
}

/**
 * Child membership by province id, built from the child draft and the
 * already-loaded title layers along the painter's chain — never through a
 * display colour, so black or duplicate-coloured children stay pickable.
 * The child tier's own layer comes from `childDraft` (the pick-id source),
 * not the separately fetched copy in `titleLayers`. Null while a layer the
 * chain needs has not loaded.
 */
export function buildChildPickIndex(
  childTier: EditorTier | null,
  childDraft: TitleDraft,
  titleLayers: TitleLayers | null,
): ChildPickIndex | null {
  if (!childTier || !titleLayers) return null;

  const layers: TitleLayers =
    childTier === "county" ? titleLayers : { ...titleLayers, [childTier]: draftToLayer(childDraft) };

  return buildTitleProvinceRegionIndex(childTier, childDraft, layers);
}

export function useEditorChildPick(
  childTier: EditorTier | null,
  childDraft: TitleDraft,
  titleLayers: TitleLayers | null,
  ready: boolean,
): ChildPickIndex | null {
  return useMemo(
    () => (ready ? buildChildPickIndex(childTier, childDraft, titleLayers) : null),
    [ready, childTier, childDraft, titleLayers],
  );
}
