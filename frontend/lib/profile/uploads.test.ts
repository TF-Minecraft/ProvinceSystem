/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { logoutCharacter } from "../characters/api";
import { getSession as getDrinksSession, setSession as setDrinksSession } from "../drinks/session";
import { getSession as getSkinsSession, setSession as setSkinsSession } from "../skins/session";
import { endProfileUploads } from "./uploads";

vi.mock("../characters/api", () => ({ logoutCharacter: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });

const BASE = { player_uuid: "p", expires_at: "2099-01-01T00:00:00Z" };

it("ends uploads started from Profile and revokes them", async () => {
  setSkinsSession({ ...BASE, session_token: "skin", from_profile: true });
  setDrinksSession({ ...BASE, session_token: "drink", from_profile: true });
  await endProfileUploads();
  expect(getSkinsSession()).toBeNull();
  expect(getDrinksSession()).toBeNull();
  expect(vi.mocked(logoutCharacter).mock.calls.map(([t]) => t).sort()).toEqual(["drink", "skin"]);
});

it("leaves uploads redeemed from an in-game code", async () => {
  setSkinsSession({ ...BASE, session_token: "code-skin" });
  await endProfileUploads();
  expect(getSkinsSession()?.session_token).toBe("code-skin");
  expect(logoutCharacter).not.toHaveBeenCalled();
});
