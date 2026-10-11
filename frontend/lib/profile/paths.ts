import type { ProfileTab } from "./tabs";

/**
 * Profile's addresses. A character, skin or drink opens inside its tab: `?tab=skins&skin=new` is the
 * editor, `&skin=<id>` one skin and `?tab=characters&character=<id>` one character.
 */
type ItemParam = "character" | "skin" | "drink";
const ITEM_PARAMS: Partial<Record<ProfileTab, ItemParam>> = { characters: "character", skins: "skin", drinks: "drink" };

/** The query parameter naming the item open in a tab, if that tab has one. */
export function itemParam(tab: ProfileTab | null): ItemParam | null {
  return (tab && ITEM_PARAMS[tab]) || null;
}

export function profileHref(tab: ProfileTab | null, item: string | null = null): string {
  const param = itemParam(tab);
  if (param && item) return `/profile?tab=${tab}&${param}=${encodeURIComponent(item)}`;
  return !tab || tab === "characters" ? "/profile" : `/profile?tab=${tab}`;
}

export function characterPath(id: string): string {
  return profileHref("characters", id);
}

export function skinPath(id: string): string {
  return profileHref("skins", id);
}

export function drinkPath(id: string): string {
  return profileHref("drinks", id);
}
