import type { ProfileTab } from "./tabs";

/**
 * Profile's addresses. A skin or drink opens inside its tab: `?tab=skins&skin=new` is the editor and
 * `&skin=<id>` one skin. The old /skins, /drinks and /profile/{skins,drinks}/* addresses redirect here
 * (next.config.ts).
 */
const ITEM_PARAMS: Partial<Record<ProfileTab, "skin" | "drink">> = { skins: "skin", drinks: "drink" };

/** The query parameter naming the skin or drink open in a tab, if that tab has one. */
export function itemParam(tab: ProfileTab | null): "skin" | "drink" | null {
  return (tab && ITEM_PARAMS[tab]) || null;
}

export function profileHref(tab: ProfileTab | null, item: string | null = null): string {
  const param = itemParam(tab);
  if (param && item) return `/profile?tab=${tab}&${param}=${encodeURIComponent(item)}`;
  return !tab || tab === "characters" ? "/profile" : `/profile?tab=${tab}`;
}

export function skinPath(id: string): string {
  return profileHref("skins", id);
}

export function drinkPath(id: string): string {
  return profileHref("drinks", id);
}
