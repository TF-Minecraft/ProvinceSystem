import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as skinsApi from "@/lib/skins/api";
import { hasSiteStaffAccess, playerMetaHasSiteStaffAccess, SITE_STAFF_PERMISSION } from "@/lib/site/staffAccess";

function meta(permissionFlags: Record<string, boolean>) {
  return {
    name_colour_stops: 0,
    allow_drink_texture: false,
    allow_drink_message: false,
    max_alive_characters: null,
    wardrobe_skin_slots: 0,
    max_3d_pair_bytes: 0,
    skin_token_cooldown_days: 0,
    skin_kinds: [],
    allow_armor_3d_helmet: false,
    permission_flags: permissionFlags,
    meta_synced: true,
  };
}

describe("staffAccess", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("playerMetaHasSiteStaffAccess checks tfmc.map.staff", () => {
    expect(playerMetaHasSiteStaffAccess({ [SITE_STAFF_PERMISSION]: true })).toBe(true);
    expect(playerMetaHasSiteStaffAccess({ [SITE_STAFF_PERMISSION]: false })).toBe(false);
    expect(playerMetaHasSiteStaffAccess({})).toBe(false);
    expect(playerMetaHasSiteStaffAccess(undefined)).toBe(false);
  });

  it("hasSiteStaffAccess returns true for staff flag", async () => {
    vi.spyOn(skinsApi, "getPlayerMeta").mockResolvedValue(meta({ [SITE_STAFF_PERMISSION]: true }));

    await expect(hasSiteStaffAccess("staff-token")).resolves.toBe(true);
    expect(skinsApi.getPlayerMeta).toHaveBeenCalledWith("staff-token");
  });

  it("hasSiteStaffAccess returns false when staff flag missing", async () => {
    vi.spyOn(skinsApi, "getPlayerMeta").mockResolvedValue(meta({}));

    await expect(hasSiteStaffAccess("player-token")).resolves.toBe(false);
  });

  it("hasSiteStaffAccess returns false on 401", async () => {
    vi.spyOn(skinsApi, "getPlayerMeta").mockRejectedValue(new skinsApi.SkinsApiError("Unauthorized", 401));

    await expect(hasSiteStaffAccess("expired-token")).resolves.toBe(false);
  });

  it("hasSiteStaffAccess returns false for empty token", async () => {
    const spy = vi.spyOn(skinsApi, "getPlayerMeta");

    await expect(hasSiteStaffAccess("")).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
