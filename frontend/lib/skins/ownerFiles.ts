import type { SubmissionPublic } from "./api";
import { ARMOR_FIELDS } from "./sizes";

/**
 * The stored files a skin's 3D viewer needs, keyed by the upload form's field names
 * (armour fields are `<tier>_<field>`). Mirrors backend/src/skins/storage.py.
 */
export function ownerFileNames(row: Pick<SubmissionPublic, "kind" | "slug" | "tiers">): Record<string, string> {
  const { kind, slug } = row;
  switch (kind) {
    case "armor_set": {
      const names: Record<string, string> = {};
      for (const tier of row.tiers ?? []) {
        for (const field of ARMOR_FIELDS) names[`${tier}_${field}`] = `${tier}_${field}.png`;
        names[`${tier}_helmet_texture`] = `${tier}_helmet_texture.png`;
        names[`${tier}_helmet_model`] = `${tier}_helmet_model.json`;
      }
      return names;
    }
    case "bow":
    case "large_bow":
      return { texture: `${slug}.png`, pull_0: `${slug}_0.png`, pull_1: `${slug}_1.png`, pull_2: `${slug}_2.png` };
    case "crossbow":
      return {
        texture: `${slug}.png`,
        pull_0: `${slug}_0.png`,
        pull_1: `${slug}_1.png`,
        pull_2: `${slug}_2.png`,
        charged: `${slug}_charged.png`,
      };
    case "item_3d":
    case "shield":
    case "helmet_3d":
    case "mask":
      return { texture: `${slug}.png`, model: `${slug}.json` };
    case "gun":
      return {
        texture: `${slug}.png`,
        carry_model: `${slug}_carry.json`,
        reload_model: `${slug}_reload.json`,
        aim_model: `${slug}_aim.json`,
      };
    case "book":
      return { unsigned: `${slug}_unsigned.png`, signed: `${slug}_signed.png` };
    default:
      return { texture: `${slug}.png` };
  }
}
