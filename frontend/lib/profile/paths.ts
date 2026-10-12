import type { ProfileTab } from "./tabs";

/**
 * Profile's addresses. A character, skin, drink or custom item opens inside its tab: `?tab=skins&skin=new`
 * is the editor, `&skin=<id>` one skin, `?tab=characters&character=<id>` one character and
 * `?tab=items&item=<character id>/<kit key>` one custom item.
 */
type ItemParam = "character" | "skin" | "drink" | "item";
const ITEM_PARAMS: Partial<Record<ProfileTab, ItemParam>> = {
  characters: "character",
  skins: "skin",
  drinks: "drink",
  items: "item",
};

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

/** A custom item's id in Profile's address: its character, then its kit key. */
export function customItemId(characterId: string, kitKey: string): string {
  return `${characterId}/${kitKey}`;
}

export function parseCustomItemId(id: string): { characterId: string; kitKey: string } | null {
  const cut = id.lastIndexOf("/");
  if (cut <= 0 || cut === id.length - 1) return null;
  return { characterId: id.slice(0, cut), kitKey: id.slice(cut + 1) };
}
