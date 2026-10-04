import type { WikiCommandSet, WikiSection } from "./types";

export type ScrollTier = { scroll: string; skinsRequiringIt: number };

/** Scroll cost distribution across all 297 skin definitions. */
export const scrollTiers: ScrollTier[] = [
  { scroll: "Common Item Skin Scroll", skinsRequiringIt: 83 },
  { scroll: "Rare Item Skin Scroll", skinsRequiringIt: 76 },
  { scroll: "Legendary Item Skin Scroll", skinsRequiringIt: 50 },
  { scroll: "Epic Item Skin Scroll", skinsRequiringIt: 47 },
];

export type DonatorTier = {
  group: string;
  tokenCooldown: string;
  skinKindsUnlocked: string;
  armour3d: boolean;
};

/**
 * `permission-groups.yml`: governs minting your own skin token to upload a
 * custom skin through the website, not browsing the shop's built-in skins.
 */
export const donatorTiers: DonatorTier[] = [
  { group: "Commoner", tokenCooldown: "Cannot mint tokens", skinKindsUnlocked: "None", armour3d: false },
  {
    group: "Noble",
    tokenCooldown: "28 days",
    skinKindsUnlocked: "Handheld, large handheld, bow, large bow, crossbow, book",
    armour3d: false,
  },
  {
    group: "Gilded",
    tokenCooldown: "21 days",
    skinKindsUnlocked: "Previous tier plus armour sets",
    armour3d: false,
  },
  {
    group: "Ascended",
    tokenCooldown: "14 days",
    skinKindsUnlocked: "Previous tiers plus 3D items, shields, 3D helmets and guns",
    armour3d: true,
  },
  {
    group: "Legacy",
    tokenCooldown: "7 days",
    skinKindsUnlocked: "Everything from every lower tier",
    armour3d: true,
  },
];

export const armourShopCommands: WikiCommandSet = {
  system: "Armour Shop",
  href: "/wiki/armour-shop",
  commands: [
    {
      command: "/armourshop",
      description: "Opens the skin shop: pick Armour skins or Item skins, then a category, then a skin to apply.",
    },
  ],
  excludedStaffCommands: [
    "/armourshop reload",
    "/armourshop token create …",
    "/armourshop token delete <code>",
    "/armourshop listtokens",
    "/armourshop pack pull",
    "/armourshop pack sync",
    "/armourshop catalog sync",
    "/armourshop submission delete <id>",
    "/armourshop skin delete <id>",
  ],
};

export const armourShopSection: WikiSection = {
  nav: {
    href: "/wiki/armour-shop",
    label: "Armour Shop",
    category: "social",
    blurb: "Spend a Skin Scroll to restyle the armour or weapon you're holding: pure cosmetics, stats untouched.",
  },
  commands: armourShopCommands,
};
