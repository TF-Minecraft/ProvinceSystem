import type { EditorTitleEntry, TitleDraft } from "@/app/hooks/useEditorDraft";
import { tweakRgbNear } from "@/app/lib/map/titleRgb";

export type ToggleProvinceOptions = {
  provinceRgb?: string;
  usedRgbs?: readonly string[];
};

export function toggleProvinceInCounty(
  entry: EditorTitleEntry,
  provinceId: number,
  options?: ToggleProvinceOptions,
): EditorTitleEntry {
  const provinces = [...(entry.provinces ?? [])];
  const index = provinces.indexOf(provinceId);

  if (index >= 0) {
    provinces.splice(index, 1);
    return { ...entry, provinces };
  }

  provinces.push(provinceId);

  let rgb = entry.rgb;
  if (provinces.length === 1 && options?.provinceRgb) {
    rgb = tweakRgbNear(options.provinceRgb, options.usedRgbs ?? []);
  }

  return { ...entry, provinces, rgb };
}

export function removeCountyFromDraft(draft: TitleDraft, countyId: string): TitleDraft {
  const next = { ...draft };
  delete next[countyId];
  return next;
}
