import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountApiError,
  discordSignInUrl,
  getAccount,
  linkMinecraft,
  needsGuildRecheck,
  signInMessage,
  startAccountPatreonLink,
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

  it("maps sign-in statuses to messages", () => {
    expect(signInMessage(null)).toBeNull();
    expect(signInMessage("denied")).toBe("Discord sign-in was cancelled.");
    expect(signInMessage("weird")).toBe(signInMessage("error"));
  });
});
