import { afterEach, describe, expect, it, vi } from "vitest";
import {
  selectSupporterPanelState,
  unlinkPatreon,
  type PatreonStatus,
} from "./patreon";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("sends JSON with the website unlink request", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.invalid");
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unlinked: true }) });
  vi.stubGlobal("fetch", fetchMock);
  await unlinkPatreon("session-token");
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/patreon\/link\/unlink$/);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    method: "POST", body: "{}", headers: { "Content-Type": "application/json", Authorization: "Bearer session-token" },
  });
});

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
