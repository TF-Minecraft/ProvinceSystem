/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getSession as getDrinksSession, setSession as setDrinksSession } from "../drinks/session";
import { getSession as getSkinsSession, setSession as setSkinsSession } from "../skins/session";
import { getSession } from "./session";
import { getCodeWardrobe, readCodeSessions, signInWithCode } from "./codes";

const BASE = { player_uuid: "p", expires_at: "2099-01-01T00:00:00Z" };

function respond(status: number, body: unknown) {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://example.test/api");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("stores a skin code's session and opens the Skins tab", async () => {
  respond(200, { ...BASE, session_token: "s", code_id: 3, scope: "skin_staff", staff: true, skin_kinds: ["Armor"] });
  expect(await signInWithCode(" ABCD ")).toEqual({ tab: "skins", profile: null });
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://example.test/api/profile/redeem");
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ code: "ABCD" });
  expect(getSkinsSession()).toMatchObject({ session_token: "s", staff: true, skin_kinds: ["armor"] });
  expect(getSkinsSession()?.from_profile).toBeUndefined();
  expect(getSession()).toBeNull();
});

it("stores a drink code's session and opens the Drinks tab", async () => {
  respond(200, { ...BASE, session_token: "d", code_id: 4, scope: "drink", allow_drink_texture: true });
  expect(await signInWithCode("X")).toEqual({ tab: "drinks", profile: null });
  expect(getDrinksSession()).toMatchObject({ session_token: "d", allow_drink_texture: true });
});

it("opens Profile itself for a profile code", async () => {
  respond(200, { ...BASE, session_token: "p1", scope: "profile", realm_id: "dev" });
  const signIn = await signInWithCode("X");
  expect(signIn.tab).toBeNull();
  expect(getSession()).toMatchObject({ session_token: "p1", scope: "profile", realm_id: "dev" });
});

it("passes the server's reason on", async () => {
  respond(400, { detail: "Code has expired" });
  await expect(signInWithCode("X")).rejects.toThrow("Code has expired");
});

it("counts only code sessions Profile didn't start", () => {
  setSkinsSession({ ...BASE, session_token: "s", from_profile: true });
  setDrinksSession({ ...BASE, session_token: "d" });
  expect(readCodeSessions()).toMatchObject({ skins: null, drinks: { session_token: "d" } });
  setDrinksSession({ ...BASE, session_token: "d", expires_at: "2000-01-01T00:00:00Z" });
  expect(readCodeSessions().drinks).toBeNull();
});

it("reads a code's wardrobe and whether it can start one", async () => {
  respond(200, { kind: "skin", items: [{ id: "a" }], can_start: { can_start: false, reason: "used" } });
  expect(await getCodeWardrobe("t")).toEqual({
    items: [{ id: "a" }],
    can_start: { can_start: false, reason: "used", next_at: null },
  });
  respond(401, { detail: "Invalid or expired session" });
  await expect(getCodeWardrobe("t")).rejects.toMatchObject({ status: 401 });
});
