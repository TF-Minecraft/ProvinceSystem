import { describe, expect, it } from "vitest";
import {
  selectSupporterPanelState,
  type PatreonStatus,
} from "./patreon";

describe("supporter panel state", () => {
  it("shows connect for an unlinked account", () => {
    expect(selectSupporterPanelState({ linked: false })).toBe("not_linked");
  });

  it("shows the linked tier when there is no grace period", () => {
    expect(
      selectSupporterPanelState({ linked: true, tier_key: "gilded" })
    ).toBe("linked_tier");
  });

  it("prioritizes grace when the account still has an effective tier", () => {
    expect(
      selectSupporterPanelState({
        linked: true,
        tier_key: "noble",
        grace_until: "2026-10-10T00:00:00Z",
      })
    ).toBe("grace");
  });

  it("shows linked without an active tier", () => {
    const status: PatreonStatus = { linked: true, tier_key: null };
    expect(selectSupporterPanelState(status)).toBe("linked_no_tier");
  });
});
