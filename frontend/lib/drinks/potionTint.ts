/** Compose tinted potion_overlay + untinted glass_bottle (vanilla layer tint). */

import { getApiBase } from "../site/api";

export type DrinkAssetImages = {
  overlay: HTMLImageElement;
  bottle: HTMLImageElement;
  width: number;
  height: number;
};

function parseHex(color: string): { r: number; g: number; b: number } | null {
  const text = (color || "").trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(text)) return null;
  return {
    r: parseInt(text.slice(1, 3), 16),
    g: parseInt(text.slice(3, 5), 16),
    b: parseInt(text.slice(5, 7), 16),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

export function drinkAssetUrl(filename: string): string {
  return `${getApiBase()}/drinks/assets/${filename}`;
}

/** API assets (DrinkBuilder sync); fall back to bundled /public/drinks/assets for local dev. */
async function loadDrinkAsset(filename: string): Promise<HTMLImageElement> {
  try {
    return await loadImage(drinkAssetUrl(filename));
  } catch {
    return loadImage(`/drinks/assets/${filename}`);
  }
}

let cachedAssets: DrinkAssetImages | null = null;

/** Load overlay + bottle once (cached for preview tint updates). */
export async function loadDrinkAssetImages(): Promise<DrinkAssetImages> {
  if (cachedAssets) return cachedAssets;
  const [overlay, bottle] = await Promise.all([
    loadDrinkAsset("potion_overlay.png"),
    loadDrinkAsset("glass_bottle.png"),
  ]);
  const width = Math.max(overlay.naturalWidth || 16, bottle.naturalWidth || 16);
  const height = Math.max(
    overlay.naturalHeight || 16,
    bottle.naturalHeight || 16
  );
  cachedAssets = { overlay, bottle, width, height };
  return cachedAssets;
}

export function composeTintedPotionCanvas(
  color: string,
  assets: DrinkAssetImages
): HTMLCanvasElement | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const { overlay, bottle, width, height } = assets;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(overlay, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0) continue;
    data[i] = Math.floor((data[i]! * rgb.r) / 255);
    data[i + 1] = Math.floor((data[i + 1]! * rgb.g) / 255);
    data[i + 2] = Math.floor((data[i + 2]! * rgb.b) / 255);
  }
  ctx.putImageData(imageData, 0, 0);
  ctx.drawImage(bottle, 0, 0, width, height);
  return canvas;
}
