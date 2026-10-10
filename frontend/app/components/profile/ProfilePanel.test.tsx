/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProfilePanel from "./ProfilePanel";
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
import { StartRefusedError } from "../../../lib/profile/start";
import { logoutCharacter } from "../../../lib/characters/api";
import { getSkinThumbnail, startSkinFromProfile } from "../../../lib/skins/api";
import { getSession as getSkinsSession } from "../../../lib/skins/session";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

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
vi.mock("../../../lib/skins/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/skins/api")>(),
  getSkinThumbnail: vi.fn(),
  startSkinFromProfile: vi.fn(),
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
  vi.mocked(getSkinThumbnail).mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

it("offers Discord sign-in when signed out, with the callback notice", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  render(<ProfilePanel tab="accounts" signin="expired" />);
  const link = await screen.findByRole("link", { name: "Sign in with Discord" });
  expect(link.getAttribute("href")).toBe(
    "https://www.tfminecraft.net/api/auth/discord/start?return_to=%2Fprofile%3Ftab%3Daccounts"
  );
  expect(screen.getByRole("alert").textContent).toContain("took too long");
});

it("says when sign-in is not configured", async () => {
  vi.mocked(getAccount).mockRejectedValue(new AccountApiError("discord_auth_disabled", 503));
  render(<ProfilePanel tab="accounts" signin={null} />);
  expect(await screen.findByText("Discord sign-in isn’t available yet.")).toBeTruthy();
});

it("shows an existing Minecraft link", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked({ link_method: "microsoft" }) }));
  render(<ProfilePanel tab="accounts" signin={null} />);
  const row = await screen.findByLabelText("Minecraft account");
  expect(row.textContent).toContain("SteveMC");
  expect(row.textContent).toContain("Linked with Microsoft");
  expect(within(row).getByRole("button", { name: "Unlink" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("SteveMC");
});

it("shows the linked player's head, rank, time on the server and Profile's tabs", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    minecraft: linked(),
    patreon: { linked: true, tier_name: "Noble" },
  }));
  vi.mocked(getAccountOverview).mockResolvedValue({
    activity: { first_seen: 1_740_960_000, last_seen: 1_790_000_000, online: true, server_label: "Vardera" },
    rank: "Builder",
  });
  const { container } = render(<ProfilePanel tab="accounts" signin={null} />);
  expect(await screen.findByText("Builder")).toBeTruthy();
  expect(screen.getByText("Noble supporter")).toBeTruthy();
  expect(container.querySelector("header")?.textContent).toMatch(/Online now on Vardera · playing since/);
  const head = container.querySelector("header img");
  expect(head?.getAttribute("src")).toBe(`https://www.tfminecraft.net/api/account/minecraft/head?u=${UUID}`);
  const tabs = within(screen.getByRole("navigation", { name: "Profile sections" })).getAllByRole("button");
  expect(tabs.map((t) => t.textContent)).toEqual(["Characters", "Skins", "Drinks", "Custom items", "Linked accounts"]);
  expect(tabs[4].getAttribute("aria-current")).toBe("page");
  // The Profile session is kept for later visits, marked as opened through Discord.
  expect(getSession()).toMatchObject({ session_token: "linked-token", source: "discord" });
  expect(getProfileDashboard).toHaveBeenCalledWith("linked-token");
});

it("names the server a player was last on once", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getAccountOverview).mockResolvedValue({
    activity: { first_seen: null, last_seen: Date.now() / 1000 - 86400 * 2, online: false, server_label: "Vardera" },
    rank: null,
  });
  const { container } = render(<ProfilePanel tab="accounts" signin={null} />);
  await screen.findByRole("navigation", { name: "Profile sections" });
  expect(container.querySelector("header")?.textContent).toContain("Last on Vardera 2 days ago");
});

it("reuses a stored Profile session for the same player", async () => {
  setSession({ session_token: "kept", player_uuid: UUID.toUpperCase(), expires_at: "2099-01-01T00:00:00Z" }, true);
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  render(<ProfilePanel tab="accounts" signin={null} />);
  await screen.findByRole("navigation", { name: "Profile sections" });
  expect(startLinkedProfileSession).not.toHaveBeenCalled();
  expect(getProfileDashboard).toHaveBeenCalledWith("kept");
});

it("holds the outline until the overview and Profile arrive, then shows them together", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  let finish: (value: ProfileDashboard) => void = () => undefined;
  vi.mocked(getProfileDashboard).mockReturnValue(new Promise((done) => { finish = done; }));
  render(<ProfilePanel tab="accounts" signin={null} />);
  await vi.waitFor(() => expect(getProfileDashboard).toHaveBeenCalled());
  expect(screen.getByText("Loading your profile…")).toBeTruthy();
  expect(screen.queryByLabelText("Minecraft account")).toBeNull();
  finish(dashboard());
  expect(await screen.findByRole("navigation", { name: "Profile sections" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("SteveMC");
  expect(screen.queryByText("Loading your profile…")).toBeNull();
});

it("shows the account while Profile is still loading if it is slow", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
    vi.mocked(getProfileDashboard).mockReturnValue(new Promise(() => undefined));
    render(<ProfilePanel tab="accounts" signin={null} />);
    await vi.waitFor(() => expect(getProfileDashboard).toHaveBeenCalled());
    expect(screen.queryByLabelText("Minecraft account")).toBeNull();
    await vi.advanceTimersByTimeAsync(2500);
    expect((await screen.findByLabelText("Minecraft account")).textContent).toContain("SteveMC");
    fireEvent.click(screen.getByRole("button", { name: "Skins" }));
    expect(screen.getByText("Loading…")).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

it("shapes the outline like the page drawn last time", async () => {
  vi.mocked(getAccount).mockReturnValue(new Promise(() => undefined));
  const shape = { signedIn: true, subline: 0, chips: false, tabs: true, rows: 2 } as const;
  render(<ProfilePanel tab="accounts" signin={null} shape={shape} />);
  expect(screen.getByText("Skins")).toBeTruthy();
  expect(screen.getByText("Minecraft")).toBeTruthy();
  expect(screen.queryByText("Patreon")).toBeNull();
  cleanup();
  // Another tab has no card to outline.
  render(<ProfilePanel tab="skins" signin={null} shape={shape} />);
  expect(screen.getByText("Skins")).toBeTruthy();
  expect(screen.queryByText("Minecraft")).toBeNull();
  cleanup();
  render(<ProfilePanel tab="accounts" signin={null} shape={{ ...shape, signedIn: false }} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Profile");
  expect(screen.queryByText("Linked accounts")).toBeNull();
});

it("remembers what it drew for the next outline", async () => {
  const set = vi.spyOn(Document.prototype, "cookie", "set");
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  render(<ProfilePanel tab="accounts" signin={null} />);
  await screen.findByRole("navigation", { name: "Profile sections" });
  // No activity, rank or Patreon; Profile's tabs are open.
  await vi.waitFor(() => expect(set).toHaveBeenLastCalledWith(expect.stringMatching(/^tfmc_profile_shape=10012[-;]/)));
  set.mockRestore();
});

it("still shows the account when the overview and Profile can't load, without Profile's tabs", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getAccountOverview).mockRejectedValue(new AccountApiError("down", 500));
  vi.mocked(startLinkedProfileSession).mockRejectedValue(new AccountApiError("down", 500));
  render(<ProfilePanel tab="accounts" signin={null} />);
  expect((await screen.findByLabelText("Minecraft account")).textContent).toContain("SteveMC");
  await vi.waitFor(() => expect(startLinkedProfileSession).toHaveBeenCalled());
  expect(screen.queryByRole("navigation", { name: "Profile sections" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("previews then links a code, naming both accounts", async () => {
  vi.mocked(getAccount).mockResolvedValueOnce(account()).mockResolvedValueOnce(account({
    minecraft: { player_uuid: "u", minecraft_name: "SteveMC", linked_at: "2026-10-05T07:01:00Z", in_grace: false, grace_until: null },
  }));
  vi.mocked(previewMinecraftLink).mockResolvedValue({ player_uuid: "u", minecraft_name: "SteveMC", expires_at: "z" });
  vi.mocked(linkMinecraft).mockResolvedValue(null);
  render(<ProfilePanel tab="accounts" signin={null} />);
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
  render(<ProfilePanel tab="accounts" signin={null} />);
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
  render(<ProfilePanel tab="accounts" signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link with a code from in game" }));
  fireEvent.change(screen.getByLabelText("Link code"), { target: { value: "ABCD-1234-EF56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Link code has expired");
});

it("asks non-members to join the Discord first", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    guild: { member: false, checked_at: null, fresh: false, can_recheck: true },
  }));
  render(<ProfilePanel tab="accounts" signin={null} />);
  const row = await screen.findByLabelText("Minecraft account");
  expect(within(row).getByRole("link", { name: "TFMC Discord" }).getAttribute("href")).toBe("https://discord.gg/tfmc");
  expect(within(row).getByRole("button", { name: "I’ve joined, check again" })).toBeTruthy();
  expect(within(row).queryByRole("button", { name: /code/ })).toBeNull();
});

it("offers Patreon when enabled and unlinked", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ patreon: { linked: false } }));
  render(<ProfilePanel tab="accounts" signin={null} />);
  expect(await screen.findByRole("button", { name: "Connect Patreon" })).toBeTruthy();
});

it("shows a cancelled re-check notice while still signed in", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  render(<ProfilePanel tab="accounts" signin="denied" />);
  expect((await screen.findByRole("alert")).textContent).toBe("Discord sign-in was cancelled.");
});

it("explains a failed sign-out that left the session active", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  vi.mocked(signOut).mockRejectedValue(new Error("offline"));
  render(<ProfilePanel tab="accounts" signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect((await screen.findByRole("alert")).textContent).toBe("We couldn’t sign you out just now. Please try again.");
});

it("returns to signed out after signing out", async () => {
  vi.mocked(getAccount).mockResolvedValueOnce(account()).mockResolvedValueOnce(null);
  vi.mocked(signOut).mockResolvedValue({ ok: true });
  render(<ProfilePanel tab="accounts" signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
});

it("shows the grace deadline with a time", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    minecraft: { player_uuid: "u", minecraft_name: "SteveMC", linked_at: "2026-09-01T00:00:00Z", in_grace: true, grace_until: "2026-10-05T08:30:00Z" },
  }));
  render(<ProfilePanel tab="accounts" signin={null} />);
  const text = (await screen.findByText(/You’ve left the TFMC Discord/)).textContent || "";
  expect(text).toMatch(/\d{1,2}:\d{2}/);
});

it("lists Discord, Minecraft and Patreon in one card", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked(), patreon: { linked: false } }));
  render(<ProfilePanel tab="accounts" signin={null} />);
  const rows = within(await screen.findByRole("list", { name: "Connected accounts" })).getAllByRole("listitem");
  expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["Discord account", "Minecraft account", "Patreon"]);
  expect(rows[0].textContent).toContain("@steve_tfmc");
  expect(within(rows[0]).getByRole("button", { name: "Sign out" })).toBeTruthy();
  expect(rows[1].textContent).toContain("SteveMC");
  expect(rows[2].textContent).toContain("Not connected");
});

it("leaves Patreon out when Patreon linking is off", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  render(<ProfilePanel tab="accounts" signin={null} />);
  await screen.findByLabelText("Minecraft account");
  expect(screen.queryByLabelText("Patreon")).toBeNull();
});

it("invites a connected Patreon without a tier to support, and disconnects after confirming", async () => {
  vi.mocked(getAccount)
    .mockResolvedValueOnce(account({ patreon: { linked: true, patreon_name: "Wonder" } }))
    .mockResolvedValueOnce(account({ patreon: { linked: false } }));
  vi.mocked(unlinkAccountPatreon).mockResolvedValue({ unlinked: true });
  render(<ProfilePanel tab="accounts" signin={null} />);
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
  render(<ProfilePanel tab="accounts" signin={null} />);
  const row = await screen.findByLabelText("Patreon");
  expect(row.textContent).toContain("Supporting as Gilded. Thank you!");
  expect(within(row).queryByRole("link")).toBeNull();
});

it("drops a Profile session opened through Discord when signing out", async () => {
  vi.mocked(getAccount).mockResolvedValueOnce(account({ minecraft: linked() })).mockResolvedValueOnce(null);
  vi.mocked(signOut).mockResolvedValue({ ok: true });
  render(<ProfilePanel tab="accounts" signin={null} />);
  await screen.findByRole("navigation", { name: "Profile sections" });
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
  render(<ProfilePanel tab="accounts" signin={null} />);
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
  render(<ProfilePanel tab="accounts" signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link with a code from in game" }));
  expect(screen.getByLabelText("Link code")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sign in with Microsoft" })).toBeNull();
});

it("asks for a fresh Discord check before opening Microsoft", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  vi.mocked(startMicrosoftLink).mockRejectedValue(new AccountApiError("guild_check_stale", 403));
  render(<ProfilePanel tab="accounts" signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in with Microsoft" }));
  expect((await screen.findByRole("link", { name: "Sign in with Discord" })).getAttribute("href")).toContain(
    "/auth/discord/start"
  );
});

it("explains why a Microsoft link failed", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  render(<ProfilePanel tab="accounts" signin={null} minecraft="no_java_profile" />);
  expect((await screen.findByRole("alert")).textContent).toContain("doesn’t own Minecraft: Java Edition");
});

it("confirms a Microsoft link from the account itself", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    microsoft_link: true,
    minecraft: linked({ linked_at: "2026-10-10T09:00:00Z", link_method: "microsoft" }),
  }));
  render(<ProfilePanel tab="accounts" signin={null} minecraft="linked" />);
  expect((await screen.findByRole("status")).textContent).toBe("Linked SteveMC with Microsoft.");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("drops a Profile session opened through Discord even when the account then fails to reload", async () => {
  vi.mocked(getAccount)
    .mockResolvedValueOnce(account({ minecraft: linked() }))
    .mockRejectedValueOnce(new AccountApiError("down", 500));
  vi.mocked(signOut).mockResolvedValue({ ok: true });
  render(<ProfilePanel tab="accounts" signin={null} />);
  await screen.findByRole("navigation", { name: "Profile sections" });
  fireEvent.click(within(screen.getByLabelText("Discord account")).getByRole("button", { name: "Sign out" }));
  expect(await screen.findByText(/couldn’t load your account/)).toBeTruthy();
  expect(getSession()).toBeNull();
});

it("keeps a pending code link's outcome when the form is closed and reopened", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  vi.mocked(previewMinecraftLink).mockResolvedValue({ player_uuid: "u", minecraft_name: "SteveMC", expires_at: "z" });
  let reject: (err: unknown) => void = () => undefined;
  vi.mocked(linkMinecraft).mockReturnValue(new Promise((_, no) => { reject = no; }));
  render(<ProfilePanel tab="accounts" signin={null} />);
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
  render(<ProfilePanel tab="accounts" signin={null} />);
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
  render(<ProfilePanel tab="accounts" signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "I’ve joined, check again" }));
  expect((await screen.findByRole("alert")).textContent).toContain("doesn’t show you in the TFMC server yet");
});

it.each([false, undefined])("falls back to a Discord sign-in when the site can't ask Discord (%s)", async (canRecheck) => {
  vi.mocked(getAccount).mockResolvedValue(account({
    guild: { member: false, checked_at: null, fresh: false, can_recheck: canRecheck },
  }));
  render(<ProfilePanel tab="accounts" signin={null} />);
  const row = await screen.findByLabelText("Minecraft account");
  expect(within(row).getByRole("link", { name: "I’ve joined, check again" }).getAttribute("href")).toContain(
    "/auth/discord/start"
  );
});

const READY = { can_start: true, reason: null, next_at: null } as const;

function wardrobe(extra: Partial<ProfileDashboard> = {}): ProfileDashboard {
  return {
    characters: [], max_alive_characters: 5, skins: [], drinks: [], custom_items: [],
    can_start: { skin: READY, drink: READY },
    ...extra,
  };
}

const SKIN = {
  id: "sub-1", kind: "handheld", slug: "emberfang", display_name: "Emberfang", status: "applied",
  created_at: "2026-10-01T00:00:00Z",
};

it("opens on Characters without a code for a linked Discord account", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  render(<ProfilePanel />);
  expect((await screen.findByRole("button", { name: "Characters" })).getAttribute("aria-current")).toBe("page");
  expect(getProfileDashboard).toHaveBeenCalledWith("linked-token");
  expect(screen.queryByText(/token create profile/)).toBeNull();
  expect(screen.queryByLabelText("Minecraft account")).toBeNull();
});

it("opens on the tab in the address and keeps the address in step with the tabs", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  render(<ProfilePanel tab="skins" />);
  expect((await screen.findByRole("button", { name: "Skins" })).className).toContain("bg-");
  expect(screen.getByRole("button", { name: "Characters" }).className).not.toContain("bg-");
  fireEvent.click(screen.getByRole("button", { name: "Linked accounts" }));
  expect(window.location.search).toBe("?tab=accounts");
  expect(screen.getByLabelText("Minecraft account")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Characters" }));
  expect(window.location.pathname + window.location.search).toBe("/profile");
});

it("shows only Linked accounts to a Discord account without a Minecraft link", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  render(<ProfilePanel tab="skins" />);
  expect(await screen.findByRole("heading", { level: 2, name: "Linked accounts" })).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Profile sections" })).toBeNull();
  expect(screen.getByRole("button", { name: "Link with a code from in game" })).toBeTruthy();
  expect(startLinkedProfileSession).not.toHaveBeenCalled();
});

it("ends a code session with Log out, and offers Discord under Linked accounts", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  setSession({ session_token: "code-token", player_uuid: UUID, expires_at: "2099-01-01T00:00:00Z", scope: "profile" });
  render(<ProfilePanel tab="accounts" />);
  expect((await screen.findByRole("link", { name: "Sign in with Discord" })).getAttribute("href")).toContain(
    "return_to=%2Fprofile%3Ftab%3Daccounts"
  );
  expect(getProfileDashboard).toHaveBeenCalledWith("code-token");
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(await screen.findByText(/token create profile/)).toBeTruthy();
  expect(logoutCharacter).toHaveBeenCalledWith("code-token");
  expect(getSession()).toBeNull();
});

it("leaves no Log out for a session opened through Discord", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  render(<ProfilePanel />);
  await screen.findByRole("navigation", { name: "Profile sections" });
  expect(screen.queryByRole("button", { name: /Log out/ })).toBeNull();
});

it("keeps the in-game code behind Use a code when signed out", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  render(<ProfilePanel />);
  const link = await screen.findByRole("link", { name: "Sign in with Discord" });
  expect(link.getAttribute("href")).toContain("return_to=%2Fprofile");
  const toggle = screen.getByRole("button", { name: "Use a code" });
  const form = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(form.hidden).toBe(true);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(form.hidden).toBe(false);
  expect(form.textContent).toContain("/token create profile");
  expect(startLinkedProfileSession).not.toHaveBeenCalled();
});

it("shows the code form open when Discord sign-in is unavailable", async () => {
  vi.mocked(getAccount).mockRejectedValue(new AccountApiError("discord_auth_disabled", 503));
  render(<ProfilePanel />);
  expect((await screen.findByText(/token create profile/)).closest("[hidden]")).toBeNull();
  expect(screen.queryByRole("link", { name: "Sign in with Discord" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Use a code" })).toBeNull();
});

it("lays skins out as a wardrobe and starts a new one without a code", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ skins: [SKIN] }));
  vi.mocked(startSkinFromProfile).mockResolvedValue({
    session_token: "skin-token", player_uuid: UUID, expires_at: "2099-01-01T00:00:00Z", code_id: 7,
    scope: "skin", skin_kinds: ["handheld"],
  });
  render(<ProfilePanel tab="skins" />);
  const card = await screen.findByRole("link", { name: /Emberfang/ });
  expect(card.getAttribute("href")).toBe("/skins/sub-1");
  expect(card.textContent).toContain("Live");
  expect(card.textContent).toContain("Handheld");
  expect(screen.getByText("Use a code").getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "New skin" }));
  await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/skins"));
  expect(startSkinFromProfile).toHaveBeenCalledWith("linked-token");
  expect(getSkinsSession()).toMatchObject({ session_token: "skin-token", from_profile: true });
});

it("shows when the next skin is ready and keeps codes behind Use a code", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  const nextAt = new Date(Date.now() + 3 * 86400000 - 60000).toISOString();
  vi.mocked(getProfileDashboard).mockResolvedValue(
    wardrobe({ can_start: { skin: { can_start: false, reason: "cooldown", next_at: nextAt }, drink: READY } })
  );
  render(<ProfilePanel tab="skins" />);
  expect(await screen.findByText("In 3 days")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New skin" })).toBeNull();
  const toggle = screen.getByRole("button", { name: "Use a code" });
  const form = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(form.hidden).toBe(true);
  fireEvent.click(toggle);
  expect(form.hidden).toBe(false);
  expect(form.textContent).toContain("/token create skin");
});

it("explains a refused start", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe());
  vi.mocked(startSkinFromProfile).mockRejectedValue(new StartRefusedError("rank", null));
  render(<ProfilePanel tab="skins" />);
  fireEvent.click(await screen.findByRole("button", { name: "New skin" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Your rank can’t make skins");
  expect(push).not.toHaveBeenCalled();
});
