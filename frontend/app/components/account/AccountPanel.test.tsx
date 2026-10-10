/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AccountPanel from "./AccountPanel";
import {
  AccountApiError,
  getAccount,
  getAccountOverview,
  linkMinecraft,
  previewMinecraftLink,
  signOut,
  startLinkedProfileSession,
  startMicrosoftLink,
  unlinkAccountPatreon,
  type Account,
  type AccountMinecraft,
} from "../../../lib/account/api";
import { getProfileDashboard, type ProfileDashboard } from "../../../lib/profile/api";
import { getSession, setSession } from "../../../lib/profile/session";

vi.mock("../../../lib/account/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/account/api")>(),
  getAccount: vi.fn(),
  getAccountOverview: vi.fn(),
  previewMinecraftLink: vi.fn(),
  linkMinecraft: vi.fn(),
  signOut: vi.fn(),
  unlinkMinecraft: vi.fn(),
  startAccountPatreonLink: vi.fn(),
  startLinkedProfileSession: vi.fn(),
  startMicrosoftLink: vi.fn(),
  unlinkAccountPatreon: vi.fn(),
}));
vi.mock("../../../lib/profile/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/profile/api")>(),
  getProfileDashboard: vi.fn(),
}));
vi.mock("../../../lib/characters/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/characters/api")>(),
  logoutCharacter: vi.fn(),
}));

const UUID = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8";

function linked(overrides: Partial<AccountMinecraft> = {}): AccountMinecraft {
  return {
    player_uuid: UUID,
    minecraft_name: "SteveMC",
    linked_at: "2026-09-01T00:00:00Z",
    in_grace: false,
    grace_until: null,
    ...overrides,
  };
}

function dashboard(): ProfileDashboard {
  return {
    characters: [
      { status: "ALIVE" },
      { status: "dead" },
      { status: "pending" },
    ] as unknown as ProfileDashboard["characters"],
    max_alive_characters: 5,
    skins: [
      { id: "a", kind: "armor", slug: "a", display_name: "A", status: "pending", created_at: "z" },
      { id: "b", kind: "armor", slug: "b", display_name: "B", status: "approved", created_at: "z" },
    ],
    drinks: [],
    custom_items: [],
  };
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    user: {
      discord_user_id: "123",
      discord_username: "steve_tfmc",
      discord_global_name: "Steve",
      avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",
    },
    guild: { member: true, checked_at: "2026-10-05T07:00:00Z", fresh: true },
    minecraft: null,
    patreon: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://www.tfminecraft.net/api");
  vi.mocked(getAccountOverview).mockResolvedValue({ activity: null, rank: null });
  vi.mocked(startLinkedProfileSession).mockResolvedValue({
    session_token: "linked-token", player_uuid: UUID, expires_at: "2099-01-01T00:00:00Z", scope: "profile", realm_id: "main",
  });
  vi.mocked(getProfileDashboard).mockResolvedValue(dashboard());
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("offers Discord sign-in when signed out, with the callback notice", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  render(<AccountPanel signin="expired" />);
  const link = await screen.findByRole("link", { name: "Sign in with Discord" });
  expect(link.getAttribute("href")).toBe(
    "https://www.tfminecraft.net/api/auth/discord/start?return_to=%2Faccount"
  );
  expect(screen.getByRole("alert").textContent).toContain("took too long");
});

it("says when sign-in is not configured", async () => {
  vi.mocked(getAccount).mockRejectedValue(new AccountApiError("discord_auth_disabled", 503));
  render(<AccountPanel signin={null} />);
  expect(await screen.findByText("Discord sign-in isn’t available yet.")).toBeTruthy();
});

it("shows an existing Minecraft link", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked({ link_method: "microsoft" }) }));
  render(<AccountPanel signin={null} />);
  const row = await screen.findByLabelText("Minecraft account");
  expect(row.textContent).toContain("SteveMC");
  expect(row.textContent).toContain("Linked with Microsoft");
  expect(within(row).getByRole("button", { name: "Unlink" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("SteveMC");
});

it("shows the linked player's head, rank, time on the server and Profile counts", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    minecraft: linked(),
    patreon: { linked: true, tier_name: "Noble" },
  }));
  vi.mocked(getAccountOverview).mockResolvedValue({
    activity: { first_seen: 1_740_960_000, last_seen: 1_790_000_000, online: true, server_label: "Vardera" },
    rank: "Builder",
  });
  const { container } = render(<AccountPanel signin={null} />);
  expect(await screen.findByText("Builder")).toBeTruthy();
  expect(screen.getByText("Noble supporter")).toBeTruthy();
  expect(container.querySelector("header")?.textContent).toMatch(/Online now on Vardera · playing since/);
  const head = container.querySelector("header img");
  expect(head?.getAttribute("src")).toBe(`https://www.tfminecraft.net/api/account/minecraft/head?u=${UUID}`);
  const tiles = await screen.findByRole("navigation", { name: "Your Profile" });
  const links = within(tiles).getAllByRole("link");
  expect(links.map((l) => l.getAttribute("href"))).toEqual([
    "/profile?tab=characters", "/profile?tab=skins", "/profile?tab=drinks", "/profile?tab=items",
  ]);
  expect(links[0].textContent).toBe("1 / 5Characters1 waiting");
  expect(links[1].textContent).toBe("2Skins1 waiting");
  // The Profile session is kept for the Profile page, marked as opened through Discord.
  expect(getSession()).toMatchObject({ session_token: "linked-token", source: "discord" });
  expect(getProfileDashboard).toHaveBeenCalledWith("linked-token");
});

it("reuses a stored Profile session for the same player", async () => {
  setSession({ session_token: "kept", player_uuid: UUID.toUpperCase(), expires_at: "2099-01-01T00:00:00Z" }, true);
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  render(<AccountPanel signin={null} />);
  await screen.findByRole("navigation", { name: "Your Profile" });
  expect(startLinkedProfileSession).not.toHaveBeenCalled();
  expect(getProfileDashboard).toHaveBeenCalledWith("kept");
});

it("still shows the account when the overview and Profile can't load", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getAccountOverview).mockRejectedValue(new AccountApiError("down", 500));
  vi.mocked(startLinkedProfileSession).mockRejectedValue(new AccountApiError("down", 500));
  render(<AccountPanel signin={null} />);
  expect((await screen.findByLabelText("Minecraft account")).textContent).toContain("SteveMC");
  await vi.waitFor(() => expect(startLinkedProfileSession).toHaveBeenCalled());
  expect(screen.queryByRole("navigation", { name: "Your Profile" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("previews then links a code, naming both accounts", async () => {
  vi.mocked(getAccount).mockResolvedValueOnce(account()).mockResolvedValueOnce(account({
    minecraft: { player_uuid: "u", minecraft_name: "SteveMC", linked_at: "2026-10-05T07:01:00Z", in_grace: false, grace_until: null },
  }));
  vi.mocked(previewMinecraftLink).mockResolvedValue({ player_uuid: "u", minecraft_name: "SteveMC", expires_at: "z" });
  vi.mocked(linkMinecraft).mockResolvedValue(null);
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link with a code from in game" }));
  fireEvent.change(screen.getByLabelText("Link code"), { target: { value: "abcd1234ef56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((await screen.findByText(/Link Minecraft account/)).textContent).toBe(
    "Link Minecraft account SteveMC to Discord @steve_tfmc?"
  );
  fireEvent.click(screen.getByRole("button", { name: "Link account" }));
  expect(await screen.findByRole("button", { name: "Unlink" })).toBeTruthy();
  expect(linkMinecraft).toHaveBeenCalledWith("abcd1234ef56");
});

it("asks for a fresh Discord check when the guild check is stale", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  vi.mocked(previewMinecraftLink).mockResolvedValue({ player_uuid: "u", minecraft_name: "SteveMC", expires_at: "z" });
  vi.mocked(linkMinecraft).mockRejectedValue(new AccountApiError("guild_check_stale", 403));
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link with a code from in game" }));
  fireEvent.change(screen.getByLabelText("Link code"), { target: { value: "ABCD-1234-EF56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("button", { name: "Link account" }));
  expect((await screen.findByRole("link", { name: "Confirm with Discord" })).getAttribute("href")).toContain(
    "/auth/discord/start"
  );
});

it("shows code errors from the server", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  vi.mocked(previewMinecraftLink).mockRejectedValue(new AccountApiError("Link code has expired", 400));
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link with a code from in game" }));
  fireEvent.change(screen.getByLabelText("Link code"), { target: { value: "ABCD-1234-EF56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Link code has expired");
});

it("asks non-members to join the Discord first", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    guild: { member: false, checked_at: null, fresh: false, can_recheck: true },
  }));
  render(<AccountPanel signin={null} />);
  const row = await screen.findByLabelText("Minecraft account");
  expect(within(row).getByRole("link", { name: "TFMC Discord" }).getAttribute("href")).toBe("https://discord.gg/tfmc");
  expect(within(row).getByRole("button", { name: "I’ve joined, check again" })).toBeTruthy();
  expect(within(row).queryByRole("button", { name: /code/ })).toBeNull();
});

it("offers Patreon when enabled and unlinked", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ patreon: { linked: false } }));
  render(<AccountPanel signin={null} />);
  expect(await screen.findByRole("button", { name: "Connect Patreon" })).toBeTruthy();
});

it("shows a cancelled re-check notice while still signed in", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  render(<AccountPanel signin="denied" />);
  expect((await screen.findByRole("alert")).textContent).toBe("Discord sign-in was cancelled.");
});

it("explains a failed sign-out that left the session active", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  vi.mocked(signOut).mockRejectedValue(new Error("offline"));
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect((await screen.findByRole("alert")).textContent).toBe("We couldn’t sign you out just now. Please try again.");
});

it("returns to signed out after signing out", async () => {
  vi.mocked(getAccount).mockResolvedValueOnce(account()).mockResolvedValueOnce(null);
  vi.mocked(signOut).mockResolvedValue({ ok: true });
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
});

it("shows the grace deadline with a time", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    minecraft: { player_uuid: "u", minecraft_name: "SteveMC", linked_at: "2026-09-01T00:00:00Z", in_grace: true, grace_until: "2026-10-05T08:30:00Z" },
  }));
  render(<AccountPanel signin={null} />);
  const text = (await screen.findByText(/You’ve left the TFMC Discord/)).textContent || "";
  expect(text).toMatch(/\d{1,2}:\d{2}/);
});

it("lists Discord, Minecraft and Patreon in one card", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked(), patreon: { linked: false } }));
  render(<AccountPanel signin={null} />);
  const rows = within(await screen.findByRole("list", { name: "Connected accounts" })).getAllByRole("listitem");
  expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["Discord account", "Minecraft account", "Patreon"]);
  expect(rows[0].textContent).toContain("@steve_tfmc");
  expect(within(rows[0]).getByRole("button", { name: "Sign out" })).toBeTruthy();
  expect(rows[1].textContent).toContain("SteveMC");
  expect(rows[2].textContent).toContain("Not connected");
});

it("leaves Patreon out when Patreon linking is off", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  render(<AccountPanel signin={null} />);
  await screen.findByLabelText("Minecraft account");
  expect(screen.queryByLabelText("Patreon")).toBeNull();
});

it("invites a connected Patreon without a tier to support, and disconnects after confirming", async () => {
  vi.mocked(getAccount)
    .mockResolvedValueOnce(account({ patreon: { linked: true, patreon_name: "Wonder" } }))
    .mockResolvedValueOnce(account({ patreon: { linked: false } }));
  vi.mocked(unlinkAccountPatreon).mockResolvedValue({ unlinked: true });
  render(<AccountPanel signin={null} />);
  const row = await screen.findByLabelText("Patreon");
  expect(row.textContent).toContain("No active tier");
  expect(row.textContent).toContain("Connected as Wonder");
  expect(within(row).getByRole("link", { name: /Become a supporter/ }).getAttribute("href")).toBe(
    "https://www.patreon.com/c/tfmcrp"
  );
  fireEvent.click(within(row).getByRole("button", { name: "Disconnect" }));
  expect(unlinkAccountPatreon).not.toHaveBeenCalled();
  fireEvent.click(within(row).getByRole("button", { name: "Disconnect" }));
  expect(await screen.findByRole("button", { name: "Connect Patreon" })).toBeTruthy();
  expect(unlinkAccountPatreon).toHaveBeenCalledTimes(1);
});

it("thanks a supporter by tier and skips the supporter link", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ patreon: { linked: true, tier_name: "Gilded" } }));
  render(<AccountPanel signin={null} />);
  const row = await screen.findByLabelText("Patreon");
  expect(row.textContent).toContain("Supporting as Gilded. Thank you!");
  expect(within(row).queryByRole("link")).toBeNull();
});

it("drops a Profile session opened through Discord when signing out", async () => {
  vi.mocked(getAccount).mockResolvedValueOnce(account({ minecraft: linked() })).mockResolvedValueOnce(null);
  vi.mocked(signOut).mockResolvedValue({ ok: true });
  render(<AccountPanel signin={null} />);
  await screen.findByRole("navigation", { name: "Your Profile" });
  expect(getSession()?.source).toBe("discord");
  fireEvent.click(within(screen.getByLabelText("Discord account")).getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
  expect(getSession()).toBeNull();
});

it("offers Microsoft first, with the in-game code as a fallback", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  vi.mocked(startMicrosoftLink).mockResolvedValue("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?x=1");
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  render(<AccountPanel signin={null} />);
  const row = await screen.findByLabelText("Minecraft account");
  const toggle = within(row).getByRole("button", { name: "Use a code" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(within(row).getByLabelText("Link code").closest("[hidden]")).not.toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(within(row).getByLabelText("Link code").closest("[hidden]")).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "Sign in with Microsoft" }));
  await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?x=1"
  ));
  vi.unstubAllGlobals();
});

it("keeps only the code form when Microsoft is not set up", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: false }));
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link with a code from in game" }));
  expect(screen.getByLabelText("Link code")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sign in with Microsoft" })).toBeNull();
});

it("asks for a fresh Discord check before opening Microsoft", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  vi.mocked(startMicrosoftLink).mockRejectedValue(new AccountApiError("guild_check_stale", 403));
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in with Microsoft" }));
  expect((await screen.findByRole("link", { name: "Sign in with Discord" })).getAttribute("href")).toContain(
    "/auth/discord/start"
  );
});

it("explains why a Microsoft link failed", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  render(<AccountPanel signin={null} minecraft="no_java_profile" />);
  expect((await screen.findByRole("alert")).textContent).toContain("doesn’t own Minecraft: Java Edition");
});

it("confirms a Microsoft link from the account itself", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    microsoft_link: true,
    minecraft: linked({ linked_at: "2026-10-10T09:00:00Z", link_method: "microsoft" }),
  }));
  render(<AccountPanel signin={null} minecraft="linked" />);
  expect((await screen.findByRole("status")).textContent).toBe("Linked SteveMC with Microsoft.");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("drops a Profile session opened through Discord even when the account then fails to reload", async () => {
  vi.mocked(getAccount)
    .mockResolvedValueOnce(account({ minecraft: linked() }))
    .mockRejectedValueOnce(new AccountApiError("down", 500));
  vi.mocked(signOut).mockResolvedValue({ ok: true });
  render(<AccountPanel signin={null} />);
  await screen.findByRole("navigation", { name: "Your Profile" });
  fireEvent.click(within(screen.getByLabelText("Discord account")).getByRole("button", { name: "Sign out" }));
  expect(await screen.findByText(/couldn’t load your account/)).toBeTruthy();
  expect(getSession()).toBeNull();
});

it("keeps a pending code link's outcome when the form is closed and reopened", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  vi.mocked(previewMinecraftLink).mockResolvedValue({ player_uuid: "u", minecraft_name: "SteveMC", expires_at: "z" });
  let reject: (err: unknown) => void = () => undefined;
  vi.mocked(linkMinecraft).mockReturnValue(new Promise((_, no) => { reject = no; }));
  render(<AccountPanel signin={null} />);
  const toggle = await screen.findByRole("button", { name: "Use a code" });
  fireEvent.click(toggle);
  fireEvent.change(screen.getByLabelText("Link code"), { target: { value: "ABCD-1234-EF56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("button", { name: "Link account" }));
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  reject(new AccountApiError("guild_check_stale", 403));
  expect(await screen.findByRole("link", { name: "Confirm with Discord" })).toBeTruthy();
});

it("checks again for a player who has joined without signing in again", async () => {
  vi.mocked(getAccount)
    .mockResolvedValueOnce(account({
      microsoft_link: true,
      guild: { member: false, checked_at: null, fresh: false, can_recheck: true },
    }))
    .mockResolvedValueOnce(account({ microsoft_link: true }));
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "I’ve joined, check again" }));
  expect(await screen.findByRole("button", { name: "Sign in with Microsoft" })).toBeTruthy();
  expect(getAccount).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("link", { name: "Sign in with Discord" })).toBeNull();
});

it("says when Discord still doesn't show the player in the server", async () => {
  const outside = { member: false, checked_at: null, fresh: false, can_recheck: true };
  vi.mocked(getAccount)
    .mockResolvedValueOnce(account({ guild: outside }))
    .mockResolvedValueOnce(account({ guild: outside }));
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "I’ve joined, check again" }));
  expect((await screen.findByRole("alert")).textContent).toContain("doesn’t show you in the TFMC server yet");
});

it.each([false, undefined])("falls back to a Discord sign-in when the site can't ask Discord (%s)", async (canRecheck) => {
  vi.mocked(getAccount).mockResolvedValue(account({
    guild: { member: false, checked_at: null, fresh: false, can_recheck: canRecheck },
  }));
  render(<AccountPanel signin={null} />);
  const row = await screen.findByLabelText("Minecraft account");
  expect(within(row).getByRole("link", { name: "I’ve joined, check again" }).getAttribute("href")).toContain(
    "/auth/discord/start"
  );
});
