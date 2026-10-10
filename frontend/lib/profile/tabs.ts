/** Profile's tabs, in order; `?tab=` picks one. Shared by the server page and the panel. */
export const PROFILE_TABS = ["characters", "skins", "drinks", "items", "accounts"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function profileTab(value: unknown): ProfileTab | null {
  return PROFILE_TABS.find((tab) => tab === value) ?? null;
}
