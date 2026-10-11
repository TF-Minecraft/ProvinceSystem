/** Profile's skin and drink pages. The old /skins and /drinks addresses redirect here (next.config.ts). */
export const NEW_SKIN_PATH = "/profile/skins/new";
export const NEW_DRINK_PATH = "/profile/drinks/new";

export function skinPath(id: string): string {
  return `/profile/skins/${encodeURIComponent(id)}`;
}

export function drinkPath(id: string): string {
  return `/profile/drinks/${encodeURIComponent(id)}`;
}
