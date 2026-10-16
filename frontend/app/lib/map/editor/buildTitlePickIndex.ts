import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import { parseRgbString } from "@/app/lib/map/titleRgb";

export type TitlePickIndex = {
  width: number;
  height: number;
  imageData: ImageData;
  rgbToTitleId: Record<string, string>;
};

export function buildRgbToTitleId(draft: TitleDraft): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [titleId, entry] of Object.entries(draft)) {
    const parsed = parseRgbString(entry.rgb);
    if (!parsed) continue;
    const rgb = `${parsed[0]},${parsed[1]},${parsed[2]}`;
    map[rgb] = titleId;
  }
  return map;
}

export function pickTitleIdAt(
  imageData: ImageData,
  x: number,
  y: number,
  rgbToTitleId: Record<string, string>,
): string | null {
  const { width, height, data } = imageData;
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return null;
  }
  const offset = (y * width + x) * 4;
  // Transparent is no title, whatever colour it carries: reading the RGB
  // alone would claim every empty pixel for a black-coloured title.
  if (data[offset + 3] === 0) {
    return null;
  }
  const rgb = `${data[offset]!},${data[offset + 1]!},${data[offset + 2]!}`;
  return rgbToTitleId[rgb] ?? null;
}

export function buildTitlePickIndex(draft: TitleDraft, imageData: ImageData): TitlePickIndex {
  return {
    width: imageData.width,
    height: imageData.height,
    imageData,
    rgbToTitleId: buildRgbToTitleId(draft),
  };
}
