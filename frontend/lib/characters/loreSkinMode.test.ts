import { describe, expect, it } from "vitest";

import type { LoreItemRow } from "./api";
import { resolveInitialSkinMode } from "./loreSkinMode";

function item(
  overrides: Omit<Partial<LoreItemRow>, "draft"> & { draft?: Partial<LoreItemRow["draft"]> } = {}
): LoreItemRow {
  const base: LoreItemRow = {
    kit_key: "iron_hunting_knife",
    path: "m.tools.IRON_HUNTING_KNIFE",
    skin_png: "knife_skin",
    base_set: "knives",
    "2d_template": "handheld",
    eligible: true,
    base_preview: {
      display_name: "Knife",
      lore: [],
      material: "IRON_SWORD",
    },
    preview: {
      display_name: "Knife",
      lore: [],
      material: "IRON_SWORD",
    },
    draft: {
      display_name: "",
      lore: [],
      existing_skin_id: null,
      submission_id: null,
      submission_status: null,
      state: "draft",
    },
    pickable_skins: [],
  };
  return {
    ...base,
    ...overrides,
    draft: { ...base.draft, ...(overrides.draft ?? {}) },
    pickable_skins: overrides.pickable_skins ?? base.pickable_skins,
  };
}

describe("resolveInitialSkinMode", () => {
  it("picks when existing_skin_id is set", () => {
    expect(
      resolveInitialSkinMode(
        item({ draft: { existing_skin_id: "player-knife" } })
      )
    ).toBe("pick");
  });

  it("uploads when pending_skin has submission_id", () => {
    expect(
      resolveInitialSkinMode(
        item({
          pickable_skins: [
            {
              id: "player-knife",
              display_name: "Knife",
              kind: "handheld",
            },
          ],
          draft: {
            state: "pending_skin",
            submission_id: "player-knife",
          },
        })
      )
    ).toBe("upload");
  });

  it("picks when pickable skins exist on a clean draft", () => {
    expect(
      resolveInitialSkinMode(
        item({
          pickable_skins: [
            {
              id: "player-knife",
              display_name: "Knife",
              kind: "handheld",
            },
          ],
        })
      )
    ).toBe("pick");
  });

  it("uploads when no pickable skins on a clean draft", () => {
    expect(resolveInitialSkinMode(item())).toBe("upload");
  });
});
