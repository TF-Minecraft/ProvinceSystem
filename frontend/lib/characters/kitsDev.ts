/** UI-dev fixture for character kits pages. */

import type { CharacterKitsResponse } from "./api";
import { UI_DEV_LORE_CHARACTER_ID } from "./loreItemsDev";

export function uiDevCharacterKits(characterId: string): CharacterKitsResponse {
  return {
    character_id: characterId || UI_DEV_LORE_CHARACTER_ID,
    kits: [
      {
        id: "starter",
        display_name: "Starter",
        cooldown_hours: 48,
        once_per_character: true,
        status: "eligible",
        claimable: true,
        cooldown: { seconds_remaining: 0, hours: 48 },
        items: [
          {
            path: "m.tools.IRON_HUNTING_KNIFE",
            amount: 1,
            editable: true,
            kit_key: "iron_hunting_knife",
            skin_png: "knife_skin",
            base_set: "knives",
            preview: {
              display_name: "Iron Hunting Knife",
              lore: ["A starter blade."],
              material: "IRON_SWORD",
              custom_model_data: 1001,
            },
            customise: {
              display_name: "Malonin's Knife",
              lore: ["A custom trail blade."],
              existing_skin_id: "ui_dev_sample_knife",
              submission_id: null,
              submission_status: null,
              state: "ready",
            },
          },
          {
            path: "v.WRITABLE_BOOK",
            amount: 1,
            editable: true,
            kit_key: "writable_book",
            skin_png: "journal_skin",
            skin_png_signed: "journal_skin_signed",
            base_set: "books",
            preview: {
              display_name: "Journal",
              lore: [],
              material: "WRITABLE_BOOK",
            },
            customise: {
              display_name: "Border Journal",
              lore: [],
              existing_skin_id: null,
              submission_id: "ui-dev-pending-book",
              submission_status: "pending",
              state: "pending_skin",
            },
          },
          {
            path: "m.currency.GOLD_COIN",
            amount: 32,
            editable: false,
          },
          {
            path: "c.dry_ration(type=dry_ration;quality=1)",
            amount: 32,
            editable: false,
            display_name: "Dry Ration",
          },
        ],
      },
    ],
  };
}
