import { readPngSize } from "../skins/sizes";

export const WARDROBE_INVALID_PNG_MESSAGE = "Image needs to be a valid PNG (did you rename a JPEG/WebP?)";

export const WARDROBE_SIZE_MESSAGE = "Skin must be exactly 64×64 pixels.";

const MAX_PNG_BYTES = 2 * 1024 * 1024;

/** Match backend wardrobe upload rules (magic bytes, 64×64, size cap). */
export async function assertWardrobeSkinPng(file: File): Promise<void> {
  if (!file.size) {
    throw new Error(WARDROBE_INVALID_PNG_MESSAGE);
  }
  if (file.size > MAX_PNG_BYTES) {
    throw new Error("PNG is too large (max 2 MB).");
  }
  let size: { w: number; h: number };
  try {
    size = await readPngSize(file);
  } catch {
    throw new Error(WARDROBE_INVALID_PNG_MESSAGE);
  }
  if (size.w !== 64 || size.h !== 64) {
    throw new Error(WARDROBE_SIZE_MESSAGE);
  }
}

/** Map server wardrobe PNG errors to player-facing copy. */
export function friendlyWardrobeUploadError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("not a valid png") || lower.includes("not a png")) {
    return WARDROBE_INVALID_PNG_MESSAGE;
  }
  return message;
}
