/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { resolveOwnerToken, setSession } from "./session";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

const future = new Date(Date.now() + 60_000).toISOString();

function wardrobe(session: { session_token: string } | null, valid: boolean) {
  return { getSession: () => session, isSessionValid: () => valid, clearSession: vi.fn() };
}

it("prefers the wardrobe's own valid session", () => {
  setSession({ session_token: "profile", player_uuid: "u", expires_at: future });
  expect(resolveOwnerToken(wardrobe({ session_token: "own" }, true))).toBe("own");
});

it("falls back to Profile and keeps the expired wardrobe session", () => {
  setSession({ session_token: "profile", player_uuid: "u", expires_at: future });
  const store = wardrobe({ session_token: "own" }, false);
  expect(resolveOwnerToken(store)).toBe("profile");
  expect(store.clearSession).not.toHaveBeenCalled();
});

it("clears an expired wardrobe session when Profile has none", () => {
  const store = wardrobe({ session_token: "own" }, false);
  expect(resolveOwnerToken(store)).toBeNull();
  expect(store.clearSession).toHaveBeenCalledOnce();
});
