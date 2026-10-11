import { fetchWardrobeTextureBlob, getWardrobe } from "./api";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load skin image"));
    img.src = src;
  });
}

/** The face (head and hat layer) of the skin the character wears, as an 8×8 PNG data URL; null without one. */
export async function characterFace(sessionToken: string, characterId: string): Promise<string | null> {
  const wardrobe = await getWardrobe(sessionToken, characterId);
  const slot = wardrobe.slots.find((s) => s.slot === wardrobe.active_slot && s.filled);
  if (!slot) return null;
  const url = await fetchWardrobeTextureBlob(sessionToken, characterId, String(slot.slot), slot.updated_at);
  try {
    const img = await loadImage(url);
    if (img.naturalWidth !== 64) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
    // A blank face (such as the masked template) is no portrait.
    if (!ctx.getImageData(0, 0, 8, 8).data.some((v, i) => i % 4 === 3 && v > 0)) return null;
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
