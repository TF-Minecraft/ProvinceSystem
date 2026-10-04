import type { Slot } from "./types";

/** Texture path: T("materials/coke.png") -> "/wiki/textures/materials/coke.png" */
export const T = (path: string) => `/wiki/textures/${path}`;

/** Block-model JSON path: M("magic-station.json") -> "/wiki/models/magic-station.json" */
export const M = (path: string) => `/wiki/models/${path}`;

/** Vanilla texture shorthand: V("diamond.png") -> "/wiki/textures/vanilla/diamond.png" */
export const V = (file: string) => T(`vanilla/${file}`);

/** A blank cell in a 3x3 crafting grid. */
export const empty: Slot = { name: "", qty: 0 };

/** URL-safe slug from a display name. Every cross-link URL is built with this. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
