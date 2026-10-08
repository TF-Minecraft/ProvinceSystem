import type { WikiCommandSet, WikiSection } from "./types";

// ---------- MMOInventory: Extra Equipment Slots ----------

/** No player command exists for the live inventory. It is `type: vanilla`, so slots sit in your normal inventory. */
export const equipmentSlotsCommands: WikiCommandSet = {
  system: "MMOInventory",
  href: "/wiki/equipment-slots",
  commands: [],
  excludedStaffCommands: ["/mmoinventory (/rpginventory, /mmoinv, /rpginv): admin reload and inspect"],
};

export const equipmentSlotsSection: WikiSection = {
  nav: {
    href: "/wiki/equipment-slots",
    label: "Equipment Slots",
    category: "character",
    blurb: "Four extra accessory slots: Ring, Amulet and two Artifacts: living in your normal inventory.",
  },
  commands: equipmentSlotsCommands,
};
