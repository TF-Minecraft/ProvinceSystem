import type { EditorTitleEntry, TitleDraft } from "@/app/hooks/useEditorDraft";
import { tweakRgbNear } from "@/app/lib/map/titleRgb";

export type ToggleChildInParentOptions = {
  childRgb?: string;
  usedRgbs?: readonly string[];
};

export function toggleChildInParent(
  entry: EditorTitleEntry,
  childId: string,
  options?: ToggleChildInParentOptions,
): EditorTitleEntry {
  const titles = [...(entry.titles ?? [])];
  const index = titles.indexOf(childId);

  if (index >= 0) {
    titles.splice(index, 1);
    return { ...entry, titles };
  }

  titles.push(childId);

  let rgb = entry.rgb;
  if (titles.length === 1 && options?.childRgb) {
    rgb = tweakRgbNear(options.childRgb, [...(options.usedRgbs ?? [])]);
  }

  return { ...entry, titles, rgb };
}

export function removeTitleFromDraft(draft: TitleDraft, titleId: string): TitleDraft {
  const next = { ...draft };
  delete next[titleId];
  return next;
}
