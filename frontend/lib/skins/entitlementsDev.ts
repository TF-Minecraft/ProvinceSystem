/** Dev fixture entitlements when catalog has not synced (local / ui-dev). */

import type { CatalogEntitlements } from "./catalog";

const NOBLE_KINDS = [
  "handheld",
  "large_handheld",
  "bow",
  "large_bow",
  "crossbow",
  "book",
];

/** Matches ArmourShop permission-groups.yml (ui-dev uses ascended-level unlock). */
export const DEV_CATALOG_ENTITLEMENTS: CatalogEntitlements = {
  defaults: {
    name_colour_stops: 0,
    max_3d_pair_bytes: 30720,
    skin_token_cooldown_days: -1,
    skin_kinds: [],
    allow_armor_3d_helmet: false,
  },
  groups: [
    {
      id: "noble",
      tier: 1,
      permission: "rpchar.group.noble",
      display_name: "Noble",
      name_colour_stops: 1,
      max_3d_pair_bytes: 30720,
      skin_token_cooldown_days: 28,
      skin_kinds: NOBLE_KINDS,
      allow_armor_3d_helmet: false,
    },
    {
      id: "gilded",
      tier: 2,
      permission: "rpchar.group.gilded",
      display_name: "Gilded",
      name_colour_stops: 2,
      max_3d_pair_bytes: 30720,
      skin_token_cooldown_days: 21,
      skin_kinds: ["armor_set"],
      allow_armor_3d_helmet: false,
    },
    {
      id: "ascended",
      tier: 3,
      permission: "rpchar.group.ascended",
      display_name: "Ascended",
      name_colour_stops: 20,
      max_3d_pair_bytes: 30720,
      skin_token_cooldown_days: 14,
      skin_kinds: ["item_3d", "shield", "helmet_3d", "mask", "gun"],
      allow_armor_3d_helmet: true,
    },
    {
      id: "legacy",
      tier: 4,
      permission: "rpchar.group.legacy",
      display_name: "Legacy",
      name_colour_stops: 20,
      max_3d_pair_bytes: 30720,
      skin_token_cooldown_days: 7,
      skin_kinds: [],
      allow_armor_3d_helmet: true,
    },
  ],
};

/** Resolved ascended-level kinds for local upload smoke without a redeem. */
export const DEV_SESSION_SKIN_KINDS = [
  ...NOBLE_KINDS,
  "armor_set",
  "item_3d",
  "shield",
  "helmet_3d",
  "mask",
  "gun",
];
