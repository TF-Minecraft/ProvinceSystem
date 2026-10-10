import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountApiError,
  discordSignInUrl,
  getAccount,
  linkMinecraft,
  minecraftLinkMessage,
  needsGuildRecheck,
  signInMessage,
  signOut,
  startAccountPatreonLink,
  startMicrosoftLink,
} from "./api";

const fetchMock = vi.fn();

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://www.tfminecraft.net/api/");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("account api", () => {
  it("builds the Discord sign-in URL with an encoded return path", () => {
    expect(discordSignInUrl("/account?x=1")).toBe(
      "https://www.tfminecraft.net/api/auth/discord/start?return_to=%2Faccount%3Fx%3D1"
    );
  });

  it("sends the session cookie and returns null when signed out", async () => {
    fetchMock.mockReturnValueOnce(json(401, { detail: "not_signed_in" }));
    expect(await getAccount()).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.tfminecraft.net/api/account");
    expect(init.credentials).toBe("include");
  });

  it("surfaces other failures with the server detail", async () => {
    fetchMock.mockReturnValueOnce(json(503, { detail: "discord_auth_disabled" }));
    await expect(getAccount()).rejects.toMatchObject({ status: 503, message: "discord_auth_disabled" });
  });

  it("posts the link code as JSON", async () => {
    fetchMock.mockReturnValueOnce(json(200, { minecraft: { player_uuid: "u", minecraft_name: "Steve" } }));
    expect(await linkMinecraft("ABCD-1234-EF56")).toMatchObject({ minecraft_name: "Steve" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ code: "ABCD-1234-EF56" }));
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("rejects a Patreon start without an authorise URL", async () => {
    fetchMock.mockReturnValueOnce(json(200, {}));
    await expect(startAccountPatreonLink()).rejects.toBeInstanceOf(AccountApiError);
  });

  it("recognises a stale guild check", () => {
    expect(needsGuildRecheck(new AccountApiError("guild_check_stale", 403))).toBe(true);
    expect(needsGuildRecheck(new AccountApiError("not_guild_member", 403))).toBe(false);
  });

  it("refuses an empty success body except on sign-out", async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response(null, { status: 200 })));
    await expect(getAccount()).rejects.toMatchObject({ message: "Unexpected empty response" });
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response(null, { status: 200 })));
    await expect(signOut()).resolves.toBeNull();
  });

  it("maps sign-in statuses to messages", () => {
    expect(signInMessage(null)).toBeNull();
    expect(signInMessage("constructor")).toBe(signInMessage("error"));
    expect(signInMessage("toString")).toBe(signInMessage("error"));
    expect(signInMessage("denied")).toBe("Discord sign-in was cancelled.");
    expect(signInMessage("weird")).toBe(signInMessage("error"));
  });

  it("starts the Microsoft link and only follows a Microsoft sign-in URL", async () => {
    const url = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?state=s";
    fetchMock.mockReturnValueOnce(json(200, { authorize_url: url }));
    await expect(startMicrosoftLink()).resolves.toBe(url);
    expect(fetchMock.mock.calls[0][0]).toBe("https://www.tfminecraft.net/api/account/minecraft/microsoft/start");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include" });
    fetchMock.mockReturnValueOnce(json(200, { authorize_url: "https://evil.example/" }));
    await expect(startMicrosoftLink()).rejects.toBeInstanceOf(AccountApiError);
  });

  it("explains Microsoft link outcomes, defaulting to a generic error", () => {
    expect(minecraftLinkMessage(null)).toBeNull();
    expect(minecraftLinkMessage("linked")).toBeNull();
    expect(minecraftLinkMessage("denied")).toBe("Microsoft sign-in was cancelled.");
    expect(minecraftLinkMessage("minecraft_taken")).toContain("different Discord account");
    expect(minecraftLinkMessage("toString")).toContain("couldn’t connect with Microsoft");
    expect(minecraftLinkMessage("something")).toContain("couldn’t connect with Microsoft");
  });
});
