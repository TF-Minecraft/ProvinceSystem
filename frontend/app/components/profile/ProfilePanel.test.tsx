/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
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
import { ProfileApiError, getProfileDashboard, type ProfileDashboard } from "../../../lib/profile/api";
import { getSession, setSession } from "../../../lib/profile/session";
import { StartRefusedError } from "../../../lib/profile/start";
import {
  deletePendingCreate,
  getCreationCatalog,
  listCharacterKits,
  logoutCharacter,
  type CreationCatalog,
} from "../../../lib/characters/api";
import {
  getSubmissionFile,
  getSkinThumbnail,
  getSubmission,
  redeemCode,
  startSkinFromProfile,
} from "../../../lib/skins/api";
import { getSession as getSkinsSession, setSession as setSkinsSession } from "../../../lib/skins/session";
import { getCodeWardrobe, signInWithCode } from "../../../lib/profile/codes";

// Like Next.js, useSearchParams follows pushState, replaceState and Back.
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  function subscribe(onChange: () => void) {
    window.addEventListener("popstate", onChange);
    window.addEventListener("test:url", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("test:url", onChange);
    };
  }
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
  };
});
for (const method of ["pushState", "replaceState"] as const) {
  const original = window.history[method].bind(window.history);
  window.history[method] = (...args: Parameters<History["pushState"]>) => {
    original(...args);
    window.dispatchEvent(new Event("test:url"));
  };
}

/** Puts the page at Profile's address for a tab, and a skin open in it. */
function visit(tab: string, skin?: string) {
  window.history.replaceState(null, "", skin ? `/profile?tab=${tab}&skin=${skin}` : `/profile?tab=${tab}`);
}

vi.mock("../../../lib/account/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/account/api")>()),
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
  ...(await importOriginal<typeof import("../../../lib/profile/api")>()),
  getProfileDashboard: vi.fn(),
}));
vi.mock("../../../lib/skins/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/skins/api")>()),
  getSkinThumbnail: vi.fn(),
  getSubmission: vi.fn(),
  getSubmissionFile: vi.fn(),
  getPlayerMeta: vi.fn(() => new Promise(() => undefined)),
  redeemCode: vi.fn(),
  startSkinFromProfile: vi.fn(),
}));
// The editor is tested on its own; here it only has to open in the tab and hand back a submission.
vi.mock("../skins/UploadForm", () => ({
  default: ({ onSubmitted }: { onSubmitted: (id: string) => void }) => (
    <button type="button" onClick={() => onSubmitted("sub-2")}>
      Submit skin
    </button>
  ),
}));
vi.mock("../../../lib/profile/codes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/profile/codes")>()),
  getCodeWardrobe: vi.fn(),
  signInWithCode: vi.fn(),
}));
vi.mock("../../../lib/characters/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/characters/api")>()),
  getCreationCatalog: vi.fn(),
  logoutCharacter: vi.fn(),
  characterFace: vi.fn(async () => null),
  characterFigure: vi.fn(async () => null),
  deletePendingCreate: vi.fn(),
  listCharacterKits: vi.fn(),
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
    session_token: "linked-token",
    player_uuid: UUID,
    expires_at: "2099-01-01T00:00:00Z",
    scope: "profile",
    realm_id: "main",
  });
  vi.mocked(getProfileDashboard).mockResolvedValue(dashboard());
  vi.mocked(getSkinThumbnail).mockResolvedValue(null);
  vi.mocked(getCreationCatalog).mockRejectedValue(new Error("offline"));
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
  visit("accounts");
  render(<ProfilePanel signin="expired" />);
  const link = await screen.findByRole("link", { name: "Sign in with Discord" });
  expect(link.getAttribute("href")).toBe(
    "https://www.tfminecraft.net/api/auth/discord/start?return_to=%2Fprofile%3Ftab%3Daccounts",
  );
  expect(screen.getByRole("alert").textContent).toContain("took too long");
});

it("says when sign-in is not configured", async () => {
  vi.mocked(getAccount).mockRejectedValue(new AccountApiError("discord_auth_disabled", 503));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  expect(await screen.findByText("Discord sign-in isn’t available yet.")).toBeTruthy();
});

it("shows an existing Minecraft link", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked({ link_method: "microsoft" }) }));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  const row = await screen.findByLabelText("Minecraft account");
  expect(row.textContent).toContain("SteveMC");
  expect(row.textContent).toContain("Linked with Microsoft");
  expect(within(row).getByRole("button", { name: "Unlink" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("SteveMC");
});

it("shows the linked player's head, rank, time on the server and Profile's tabs", async () => {
  vi.mocked(getAccount).mockResolvedValue(
    account({
      minecraft: linked(),
      patreon: { linked: true, tier_name: "Noble" },
    }),
  );
  vi.mocked(getAccountOverview).mockResolvedValue({
    activity: { first_seen: 1_740_960_000, last_seen: 1_790_000_000, online: true, server_label: "Vardera" },
    rank: "Builder",
  });
  visit("accounts");
  const { container } = render(<ProfilePanel signin={null} />);
  expect(await screen.findByText("Builder")).toBeTruthy();
  expect(screen.getByText("Noble supporter")).toBeTruthy();
  expect(container.querySelector("header")?.textContent).toMatch(/Online now on Vardera · playing since/);
  const head = container.querySelector("header img");
  expect(head?.getAttribute("src")).toBe(`https://www.tfminecraft.net/api/account/minecraft/head?u=${UUID}`);
  const tabs = within(screen.getByRole("tablist", { name: "Profile sections" })).getAllByRole("tab");
  expect(tabs.map((t) => t.textContent)).toEqual(["Characters", "Skins", "Drinks", "Custom items", "Linked accounts"]);
  expect(tabs[4].getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[4].id);
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
  visit("accounts");
  const { container } = render(<ProfilePanel signin={null} />);
  await screen.findByRole("tablist", { name: "Profile sections" });
  expect(container.querySelector("header")?.textContent).toContain("Last on Vardera 2 days ago");
});

it("reuses a stored Profile session for the same player", async () => {
  setSession({ session_token: "kept", player_uuid: UUID.toUpperCase(), expires_at: "2099-01-01T00:00:00Z" }, true);
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  await screen.findByRole("tablist", { name: "Profile sections" });
  expect(startLinkedProfileSession).not.toHaveBeenCalled();
  expect(getProfileDashboard).toHaveBeenCalledWith("kept");
});

it("holds the outline until the overview and Profile arrive, then shows them together", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  let finish: (value: ProfileDashboard) => void = () => undefined;
  vi.mocked(getProfileDashboard).mockReturnValue(
    new Promise((done) => {
      finish = done;
    }),
  );
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  await vi.waitFor(() => expect(getProfileDashboard).toHaveBeenCalled());
  expect(screen.getByText("Loading your profile…")).toBeTruthy();
  expect(screen.queryByLabelText("Minecraft account")).toBeNull();
  finish(dashboard());
  expect(await screen.findByRole("tablist", { name: "Profile sections" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("SteveMC");
  expect(screen.queryByText("Loading your profile…")).toBeNull();
});

it("shows the account while Profile is still loading if it is slow", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
    vi.mocked(getProfileDashboard).mockReturnValue(new Promise(() => undefined));
    visit("accounts");
    render(<ProfilePanel signin={null} />);
    await vi.waitFor(() => expect(getProfileDashboard).toHaveBeenCalled());
    expect(screen.queryByLabelText("Minecraft account")).toBeNull();
    await vi.advanceTimersByTimeAsync(2500);
    expect((await screen.findByLabelText("Minecraft account")).textContent).toContain("SteveMC");
    fireEvent.click(screen.getByRole("tab", { name: "Skins" }));
    expect(screen.getByText("Loading…")).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

it("shapes the outline like the page drawn last time", async () => {
  vi.mocked(getAccount).mockReturnValue(new Promise(() => undefined));
  const shape = { signedIn: true, subline: 0, chips: false, tabs: true, rows: 2 } as const;
  visit("accounts");
  render(<ProfilePanel signin={null} shape={shape} />);
  expect(screen.getByText("Skins")).toBeTruthy();
  expect(screen.getByText("Minecraft")).toBeTruthy();
  expect(screen.queryByText("Patreon")).toBeNull();
  cleanup();
  // Another tab has no card to outline.
  visit("skins");
  render(<ProfilePanel signin={null} shape={shape} />);
  expect(screen.getByText("Skins")).toBeTruthy();
  expect(screen.queryByText("Minecraft")).toBeNull();
  cleanup();
  visit("accounts");
  render(<ProfilePanel signin={null} shape={{ ...shape, signedIn: false }} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Profile");
  expect(screen.queryByText("Linked accounts")).toBeNull();
});

it("remembers what it drew for the next outline", async () => {
  const set = vi.spyOn(Document.prototype, "cookie", "set");
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  await screen.findByRole("tablist", { name: "Profile sections" });
  // No activity, rank or Patreon; Profile's tabs are open.
  await vi.waitFor(() => expect(set).toHaveBeenLastCalledWith(expect.stringMatching(/^tfmc_profile_shape=10012[-;]/)));
  set.mockRestore();
});

it("still shows the account when the overview and Profile can't load, without Profile's tabs", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getAccountOverview).mockRejectedValue(new AccountApiError("down", 500));
  vi.mocked(startLinkedProfileSession).mockRejectedValue(new AccountApiError("down", 500));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  expect((await screen.findByLabelText("Minecraft account")).textContent).toContain("SteveMC");
  await vi.waitFor(() => expect(startLinkedProfileSession).toHaveBeenCalled());
  expect(screen.queryByRole("tablist", { name: "Profile sections" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("previews then links a code, naming both accounts", async () => {
  vi.mocked(getAccount)
    .mockResolvedValueOnce(account())
    .mockResolvedValueOnce(
      account({
        minecraft: {
          player_uuid: "u",
          minecraft_name: "SteveMC",
          linked_at: "2026-10-05T07:01:00Z",
          in_grace: false,
          grace_until: null,
        },
      }),
    );
  vi.mocked(previewMinecraftLink).mockResolvedValue({ player_uuid: "u", minecraft_name: "SteveMC", expires_at: "z" });
  vi.mocked(linkMinecraft).mockResolvedValue(null);
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link with a code from in game" }));
  fireEvent.change(screen.getByLabelText("Link code"), { target: { value: "abcd1234ef56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((await screen.findByText(/Link Minecraft account/)).textContent).toBe(
    "Link Minecraft account SteveMC to Discord @steve_tfmc?",
  );
  fireEvent.click(screen.getByRole("button", { name: "Link account" }));
  expect(await screen.findByRole("button", { name: "Unlink" })).toBeTruthy();
  expect(linkMinecraft).toHaveBeenCalledWith("abcd1234ef56");
});

it("asks for a fresh Discord check when the guild check is stale", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  vi.mocked(previewMinecraftLink).mockResolvedValue({ player_uuid: "u", minecraft_name: "SteveMC", expires_at: "z" });
  vi.mocked(linkMinecraft).mockRejectedValue(new AccountApiError("guild_check_stale", 403));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link with a code from in game" }));
  fireEvent.change(screen.getByLabelText("Link code"), { target: { value: "ABCD-1234-EF56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("button", { name: "Link account" }));
  expect((await screen.findByRole("link", { name: "Confirm with Discord" })).getAttribute("href")).toContain(
    "/auth/discord/start",
  );
});

it("shows code errors from the server", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  vi.mocked(previewMinecraftLink).mockRejectedValue(new AccountApiError("Link code has expired", 400));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link with a code from in game" }));
  fireEvent.change(screen.getByLabelText("Link code"), { target: { value: "ABCD-1234-EF56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Link code has expired");
});

it("asks non-members to join the Discord first", async () => {
  vi.mocked(getAccount).mockResolvedValue(
    account({
      guild: { member: false, checked_at: null, fresh: false, can_recheck: true },
    }),
  );
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  const row = await screen.findByLabelText("Minecraft account");
  expect(within(row).getByRole("link", { name: "TFMC Discord" }).getAttribute("href")).toBe("https://discord.gg/tfmc");
  expect(within(row).getByRole("button", { name: "I’ve joined, check again" })).toBeTruthy();
  expect(within(row).queryByRole("button", { name: /code/ })).toBeNull();
});

it("offers Patreon when enabled and unlinked", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ patreon: { linked: false } }));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  expect(await screen.findByRole("button", { name: "Connect Patreon" })).toBeTruthy();
});

it("shows a cancelled re-check notice while still signed in", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  visit("accounts");
  render(<ProfilePanel signin="denied" />);
  expect((await screen.findByRole("alert")).textContent).toBe("Discord sign-in was cancelled.");
});

it("explains a failed sign-out that left the session active", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  vi.mocked(signOut).mockRejectedValue(new Error("offline"));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect((await screen.findByRole("alert")).textContent).toBe("We couldn’t sign you out just now. Please try again.");
});

it("returns to signed out after signing out", async () => {
  vi.mocked(getAccount).mockResolvedValueOnce(account()).mockResolvedValueOnce(null);
  vi.mocked(signOut).mockResolvedValue({ ok: true });
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
});

it("shows the grace deadline with a time", async () => {
  vi.mocked(getAccount).mockResolvedValue(
    account({
      minecraft: {
        player_uuid: "u",
        minecraft_name: "SteveMC",
        linked_at: "2026-09-01T00:00:00Z",
        in_grace: true,
        grace_until: "2026-10-05T08:30:00Z",
      },
    }),
  );
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  const text = (await screen.findByText(/You’ve left the TFMC Discord/)).textContent || "";
  expect(text).toMatch(/\d{1,2}:\d{2}/);
});

it("lists Discord, Minecraft and Patreon in one card", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked(), patreon: { linked: false } }));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  const rows = within(await screen.findByRole("list", { name: "Connected accounts" })).getAllByRole("listitem");
  expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
    "Discord account",
    "Minecraft account",
    "Patreon",
  ]);
  expect(rows[0].textContent).toContain("@steve_tfmc");
  expect(within(rows[0]).getByRole("button", { name: "Sign out" })).toBeTruthy();
  expect(rows[1].textContent).toContain("SteveMC");
  expect(rows[2].textContent).toContain("Not connected");
});

it("leaves Patreon out when Patreon linking is off", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  await screen.findByLabelText("Minecraft account");
  expect(screen.queryByLabelText("Patreon")).toBeNull();
});

it("invites a connected Patreon without a tier to support, and disconnects after confirming", async () => {
  vi.mocked(getAccount)
    .mockResolvedValueOnce(account({ patreon: { linked: true, patreon_name: "Wonder" } }))
    .mockResolvedValueOnce(account({ patreon: { linked: false } }));
  vi.mocked(unlinkAccountPatreon).mockResolvedValue({ unlinked: true });
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  const row = await screen.findByLabelText("Patreon");
  expect(row.textContent).toContain("No active tier");
  expect(row.textContent).toContain("Connected as Wonder");
  expect(
    within(row)
      .getByRole("link", { name: /Become a supporter/ })
      .getAttribute("href"),
  ).toBe("https://www.patreon.com/c/tfmcrp");
  fireEvent.click(within(row).getByRole("button", { name: "Disconnect" }));
  expect(unlinkAccountPatreon).not.toHaveBeenCalled();
  fireEvent.click(within(row).getByRole("button", { name: "Disconnect" }));
  expect(await screen.findByRole("button", { name: "Connect Patreon" })).toBeTruthy();
  expect(unlinkAccountPatreon).toHaveBeenCalledTimes(1);
});

it("thanks a supporter by tier and skips the supporter link", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ patreon: { linked: true, tier_name: "Gilded" } }));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  const row = await screen.findByLabelText("Patreon");
  expect(row.textContent).toContain("Supporting as Gilded. Thank you!");
  expect(within(row).queryByRole("link")).toBeNull();
});

it("drops a Profile session opened through Discord when signing out", async () => {
  vi.mocked(getAccount)
    .mockResolvedValueOnce(account({ minecraft: linked() }))
    .mockResolvedValueOnce(null);
  vi.mocked(signOut).mockResolvedValue({ ok: true });
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  await screen.findByRole("tablist", { name: "Profile sections" });
  expect(getSession()?.source).toBe("discord");
  fireEvent.click(within(screen.getByLabelText("Discord account")).getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
  expect(getSession()).toBeNull();
});

it("offers Microsoft first, with the in-game code as a fallback", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  vi.mocked(startMicrosoftLink).mockResolvedValue(
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?x=1",
  );
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  const row = await screen.findByLabelText("Minecraft account");
  const toggle = within(row).getByRole("button", { name: "Use a code" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(within(row).getByLabelText("Link code").closest("[hidden]")).not.toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(within(row).getByLabelText("Link code").closest("[hidden]")).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "Sign in with Microsoft" }));
  await vi.waitFor(() =>
    expect(assign).toHaveBeenCalledWith("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?x=1"),
  );
  vi.unstubAllGlobals();
});

it("keeps only the code form when Microsoft is not set up", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: false }));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Link with a code from in game" }));
  expect(screen.getByLabelText("Link code")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sign in with Microsoft" })).toBeNull();
});

it("asks for a fresh Discord check before opening Microsoft", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  vi.mocked(startMicrosoftLink).mockRejectedValue(new AccountApiError("guild_check_stale", 403));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in with Microsoft" }));
  expect((await screen.findByRole("link", { name: "Sign in with Discord" })).getAttribute("href")).toContain(
    "/auth/discord/start",
  );
});

it("explains why a Microsoft link failed", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  visit("accounts");
  render(<ProfilePanel signin={null} minecraft="no_java_profile" />);
  expect((await screen.findByRole("alert")).textContent).toContain("doesn’t own Minecraft: Java Edition");
});

it("confirms a Microsoft link from the account itself", async () => {
  vi.mocked(getAccount).mockResolvedValue(
    account({
      microsoft_link: true,
      minecraft: linked({ linked_at: "2026-10-10T09:00:00Z", link_method: "microsoft" }),
    }),
  );
  visit("accounts");
  render(<ProfilePanel signin={null} minecraft="linked" />);
  expect((await screen.findByRole("status")).textContent).toBe("Linked SteveMC with Microsoft.");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("drops a Profile session opened through Discord even when the account then fails to reload", async () => {
  vi.mocked(getAccount)
    .mockResolvedValueOnce(account({ minecraft: linked() }))
    .mockRejectedValueOnce(new AccountApiError("down", 500));
  vi.mocked(signOut).mockResolvedValue({ ok: true });
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  await screen.findByRole("tablist", { name: "Profile sections" });
  fireEvent.click(within(screen.getByLabelText("Discord account")).getByRole("button", { name: "Sign out" }));
  expect(await screen.findByText(/couldn’t load your account/)).toBeTruthy();
  expect(getSession()).toBeNull();
});

it("keeps a pending code link's outcome when the form is closed and reopened", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  vi.mocked(previewMinecraftLink).mockResolvedValue({ player_uuid: "u", minecraft_name: "SteveMC", expires_at: "z" });
  let reject: (err: unknown) => void = () => undefined;
  vi.mocked(linkMinecraft).mockReturnValue(
    new Promise((_, no) => {
      reject = no;
    }),
  );
  visit("accounts");
  render(<ProfilePanel signin={null} />);
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
    .mockResolvedValueOnce(
      account({
        microsoft_link: true,
        guild: { member: false, checked_at: null, fresh: false, can_recheck: true },
      }),
    )
    .mockResolvedValueOnce(account({ microsoft_link: true }));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
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
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "I’ve joined, check again" }));
  expect((await screen.findByRole("alert")).textContent).toContain("doesn’t show you in the TFMC server yet");
});

it.each([false, undefined])(
  "falls back to a Discord sign-in when the site can't ask Discord (%s)",
  async (canRecheck) => {
    vi.mocked(getAccount).mockResolvedValue(
      account({
        guild: { member: false, checked_at: null, fresh: false, can_recheck: canRecheck },
      }),
    );
    visit("accounts");
    render(<ProfilePanel signin={null} />);
    const row = await screen.findByLabelText("Minecraft account");
    expect(within(row).getByRole("link", { name: "I’ve joined, check again" }).getAttribute("href")).toContain(
      "/auth/discord/start",
    );
  },
);

const READY = { can_start: true, reason: null, next_at: null } as const;

function wardrobe(extra: Partial<ProfileDashboard> = {}): ProfileDashboard {
  return {
    characters: [],
    max_alive_characters: 5,
    skins: [],
    drinks: [],
    custom_items: [],
    can_start: { skin: READY, drink: READY },
    ...extra,
  };
}

const SKIN = {
  id: "sub-1",
  kind: "handheld",
  slug: "emberfang",
  display_name: "Emberfang",
  status: "applied",
  created_at: "2026-10-01T00:00:00Z",
};

it("opens on Characters without a code for a linked Discord account", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  render(<ProfilePanel />);
  expect((await screen.findByRole("tab", { name: "Characters" })).getAttribute("aria-selected")).toBe("true");
  expect(getProfileDashboard).toHaveBeenCalledWith("linked-token");
  expect(screen.queryByText(/token create profile/)).toBeNull();
  expect(screen.queryByLabelText("Minecraft account")).toBeNull();
});

it("names races from the catalogue", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(
    wardrobe({
      characters: [
        { id: "c1", status: "rejected", name: "Brin", race: "half_orc", error: "slot full" },
      ] as unknown as ProfileDashboard["characters"],
    }),
  );
  vi.mocked(getCreationCatalog).mockResolvedValue({
    races: [{ id: "half_orc", name: "Half-Orc" }],
  } as unknown as CreationCatalog);
  render(<ProfilePanel />);
  expect(await screen.findByText("Half-Orc")).toBeTruthy();
});

it("reloads characters when the page comes back into view", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe());
  render(<ProfilePanel />);
  expect(await screen.findByText("0 of 5 slots used")).toBeTruthy();
  const before = vi.mocked(getProfileDashboard).mock.calls.length;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  expect(getProfileDashboard).toHaveBeenCalledTimes(before);
  vi.mocked(getProfileDashboard).mockResolvedValue(
    wardrobe({
      characters: [{ id: "c1", status: "ALIVE", name: "Brin" }] as unknown as ProfileDashboard["characters"],
      max_alive_characters: 6,
    }),
  );
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  expect(await screen.findByText("1 of 6 slots used")).toBeTruthy();
  expect(screen.getByText("Brin")).toBeTruthy();
  vi.restoreAllMocks();
});

it("opens on the tab in the address and keeps the address in step with the tabs", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  visit("skins");
  render(<ProfilePanel />);
  expect((await screen.findByRole("tab", { name: "Skins" })).className).toContain("bg-");
  expect(screen.getByRole("tab", { name: "Characters" }).className).not.toContain("bg-");
  fireEvent.click(screen.getByRole("tab", { name: "Linked accounts" }));
  expect(window.location.search).toBe("?tab=accounts");
  expect(screen.getByLabelText("Minecraft account")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Characters" }));
  expect(window.location.pathname + window.location.search).toBe("/profile");
});

it("shows only Linked accounts to a Discord account without a Minecraft link", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  visit("skins");
  render(<ProfilePanel />);
  expect(await screen.findByRole("heading", { level: 2, name: "Linked accounts" })).toBeTruthy();
  expect(screen.queryByRole("tablist", { name: "Profile sections" })).toBeNull();
  expect(screen.getByRole("button", { name: "Link with a code from in game" })).toBeTruthy();
  expect(startLinkedProfileSession).not.toHaveBeenCalled();
});

it("ends a code session with Log out, and offers Discord under Linked accounts", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  setSession({ session_token: "code-token", player_uuid: UUID, expires_at: "2099-01-01T00:00:00Z", scope: "profile" });
  visit("accounts");
  render(<ProfilePanel />);
  expect((await screen.findByRole("link", { name: "Sign in with Discord" })).getAttribute("href")).toContain(
    "return_to=%2Fprofile%3Ftab%3Daccounts",
  );
  expect(getProfileDashboard).toHaveBeenCalledWith("code-token");
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(await screen.findByText(/token create profile/)).toBeTruthy();
  expect(logoutCharacter).toHaveBeenCalledWith("code-token");
  expect(getSession()).toBeNull();
});

it("asks for a fresh linked session once when the server refuses the stored one", async () => {
  setSession(
    { session_token: "revoked", player_uuid: UUID, expires_at: "2099-01-01T00:00:00Z", source: "discord" },
    true,
  );
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockImplementation(async (token) => {
    if (token === "revoked") throw new ProfileApiError("expired", 401);
    return dashboard();
  });
  render(<ProfilePanel />);
  await vi.waitFor(() => expect(getProfileDashboard).toHaveBeenCalledWith("linked-token"));
  expect((await screen.findByRole("tab", { name: "Characters" })).getAttribute("aria-selected")).toBe("true");
  expect(startLinkedProfileSession).toHaveBeenCalledTimes(1);
});

it("stops after one fresh linked session if the server refuses that too", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockRejectedValue(new ProfileApiError("expired", 401));
  render(<ProfilePanel />);
  await screen.findByRole("heading", { level: 2, name: "Linked accounts" });
  expect(startLinkedProfileSession).toHaveBeenCalledTimes(2);
  expect(getProfileDashboard).toHaveBeenCalledTimes(2);
});

it("leaves no Log out for a session opened through Discord", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  render(<ProfilePanel />);
  await screen.findByRole("tablist", { name: "Profile sections" });
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
    session_token: "skin-token",
    player_uuid: UUID,
    expires_at: "2099-01-01T00:00:00Z",
    code_id: 7,
    scope: "skin",
    skin_kinds: ["handheld"],
  });
  visit("skins");
  render(<ProfilePanel />);
  const card = await screen.findByRole("link", { name: /Emberfang/ });
  expect(card.getAttribute("href")).toBe("/profile?tab=skins&skin=sub-1");
  expect(card.textContent).toContain("Live");
  expect(card.textContent).toContain("Handheld");
  expect(screen.getByText("Use a code").getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "New skin" }));
  // The editor opens in the tab, under the same header and tabs.
  expect(await screen.findByRole("heading", { level: 2, name: "New skin" })).toBeTruthy();
  expect(window.location.search).toBe("?tab=skins&skin=new");
  expect(screen.getByRole("tab", { name: "Skins" }).getAttribute("aria-selected")).toBe("true");
  expect(startSkinFromProfile).toHaveBeenCalledWith("linked-token");
  expect(getSkinsSession()).toMatchObject({ session_token: "skin-token", from_profile: true });
  fireEvent.click(screen.getByRole("link", { name: "← Skins" }));
  expect(await screen.findByRole("link", { name: /Emberfang/ })).toBeTruthy();
  expect(window.location.search).toBe("?tab=skins");
});

const CHARACTERS = [
  { id: "c1", status: "ALIVE", name: "Vaelthir", description: "A quiet scout." },
  { id: "c2", status: "pending", name: "Mira" },
  {
    id: "c3",
    status: "DEAD",
    name: "Old Tamsin",
    died_at: null,
    estate: {
      death_id: "d-3",
      status: "DECIDED",
      revision: 0,
      due_at: "2026-10-14T09:00:00Z",
      decided_at: "2026-10-14T09:01:00Z",
      heir_name: "Kira",
      recipients: { money: { kind: "CHARACTER", name: "Kira" }, guild_locks: { kind: "WAITING", name: null } },
      money_moved_cents: 34025,
      participants: { thievery: { outcome: "DONE", revision: 0, counts: { locks: 297 } } },
    },
  },
] as unknown as ProfileDashboard["characters"];

it("opens a character in its tab, and Back returns to the list", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ characters: CHARACTERS }));
  render(<ProfilePanel />);
  fireEvent.click(await screen.findByRole("link", { name: /Vaelthir/ }));
  expect(await screen.findByRole("heading", { level: 2, name: "Vaelthir" })).toBeTruthy();
  expect(screen.getByText("A quiet scout.")).toBeTruthy();
  expect(window.location.search).toBe("?tab=characters&character=c1");
  expect(screen.getByRole("tab", { name: "Characters" }).getAttribute("aria-selected")).toBe("true");
  // Focus moves to the character's name, and back to its card on the list.
  expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "Vaelthir" }));
  window.history.back();
  const card = await screen.findByRole("link", { name: /Vaelthir/ });
  expect(window.location.search).toBe("");
  await vi.waitFor(() => expect(document.activeElement).toBe(card));
  // Forward and Back again still come back to the card.
  window.history.forward();
  expect(await screen.findByRole("heading", { level: 2, name: "Vaelthir" })).toBeTruthy();
  window.history.back();
  const again = await screen.findByRole("link", { name: /Vaelthir/ });
  await vi.waitFor(() => expect(document.activeElement).toBe(again));
});

it("sends a character's address back to the list when it can't be opened", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ characters: CHARACTERS }));
  window.history.replaceState(null, "", "/profile?tab=characters&character=gone");
  render(<ProfilePanel />);
  expect(await screen.findByRole("link", { name: /Vaelthir/ })).toBeTruthy();
  expect(window.location.search).toBe("");
});

it("opens a dead character's memorial: death, heir and where the estate went", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ characters: CHARACTERS }));
  render(<ProfilePanel />);
  fireEvent.click(await screen.findByRole("link", { name: /Old Tamsin/ }));
  expect(await screen.findByRole("heading", { level: 2, name: "Old Tamsin" })).toBeTruthy();
  expect(window.location.search).toBe("?tab=characters&character=c3");
  const value = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
  expect(value("Died")).toBe("Before records began");
  expect(value("Heir")).toBe("Kira");
  expect(value("Estate")).toBe("Passed on 14 Oct 2026");
  expect(value("Money")).toBe("Kira (340.25)");
  expect(value("Guild locks")).toBe("Waiting for a guild leader");
  expect(value("Moved")).toBe("297 locks");
  expect(screen.queryByRole("link", { name: /Wardrobe/ })).toBeNull();
});

it("cancels a pending character from its sheet and returns to the list", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ characters: CHARACTERS }));
  vi.mocked(deletePendingCreate).mockResolvedValue(undefined as never);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  window.history.replaceState(null, "", "/profile?tab=characters&character=c2");
  render(<ProfilePanel />);
  expect(await screen.findByText("Being added to the server. You can still edit kits and wardrobe.")).toBeTruthy();
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ characters: CHARACTERS.slice(0, 1) }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel submission" }));
  expect(await screen.findByRole("link", { name: /Vaelthir/ })).toBeTruthy();
  expect(deletePendingCreate).toHaveBeenCalledWith("linked-token", "c2");
  expect(window.location.search).toBe("");
  await vi.waitFor(() => expect(screen.queryByText("Mira")).toBeNull());
});

it("opens a skin in its tab, and Back returns to the wardrobe", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ skins: [SKIN] }));
  vi.mocked(getSubmission).mockResolvedValue({
    ...SKIN,
    grip_preset: null,
    base_set: null,
    deny_reason: null,
    reviewed_at: null,
    applied_at: null,
  });
  vi.mocked(getSubmissionFile).mockReturnValue(new Promise(() => undefined));
  visit("skins");
  render(<ProfilePanel />);
  fireEvent.click(await screen.findByRole("link", { name: /Emberfang/ }));
  expect(await screen.findByRole("heading", { level: 2, name: "Emberfang" })).toBeTruthy();
  expect(window.location.search).toBe("?tab=skins&skin=sub-1");
  expect(getSubmission).toHaveBeenCalledWith("sub-1", "linked-token");
  window.history.back();
  expect(await screen.findByRole("link", { name: /Emberfang/ })).toBeTruthy();
  expect(window.location.search).toBe("?tab=skins");
  expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
});

it("opens a skin's address in the tab, and a submit shows the new skin in the editor's place", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ skins: [SKIN] }));
  vi.mocked(getSubmission).mockResolvedValue({
    ...SKIN,
    id: "sub-2",
    display_name: "Frostbite",
    grip_preset: null,
    base_set: null,
    deny_reason: null,
    reviewed_at: null,
    applied_at: null,
  });
  vi.mocked(getSubmissionFile).mockReturnValue(new Promise(() => undefined));
  setSkinsSession({ ...SKIN_CODE, from_profile: true });
  visit("skins", "new");
  render(<ProfilePanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Submit skin" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Frostbite" })).toBeTruthy();
  expect(window.location.search).toBe("?tab=skins&skin=sub-2");
  // The wardrobe reloads for the new skin, and ← (no earlier entry here) replaces this one with it.
  await vi.waitFor(() => expect(getProfileDashboard).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("link", { name: "← Skins" }));
  expect(await screen.findByRole("link", { name: /Emberfang/ })).toBeTruthy();
  expect(window.location.search).toBe("?tab=skins");
});

it("sends the editor's address back to the wardrobe without a session for it", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ skins: [SKIN] }));
  visit("skins", "new");
  render(<ProfilePanel />);
  expect(await screen.findByRole("link", { name: /Emberfang/ })).toBeTruthy();
  expect(window.location.search).toBe("?tab=skins");
});

it("closes an open skin when the address leaves it, as the header's Profile link does", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ skins: [SKIN] }));
  vi.mocked(getSubmission).mockResolvedValue({
    ...SKIN,
    grip_preset: null,
    base_set: null,
    deny_reason: null,
    reviewed_at: null,
    applied_at: null,
  });
  vi.mocked(getSubmissionFile).mockReturnValue(new Promise(() => undefined));
  visit("skins", "sub-1");
  render(<ProfilePanel />);
  expect(await screen.findByRole("heading", { level: 2, name: "Emberfang" })).toBeTruthy();
  act(() => window.history.pushState(null, "", "/profile"));
  expect(screen.getByRole("tab", { name: "Characters" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
});

it("leaves an editor with no session in place, once, even when effects run twice", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ skins: [SKIN] }));
  const back = vi.spyOn(window.history, "back");
  visit("skins", "new");
  render(
    <StrictMode>
      <ProfilePanel />
    </StrictMode>,
  );
  expect(await screen.findByRole("link", { name: /Emberfang/ })).toBeTruthy();
  expect(window.location.search).toBe("?tab=skins");
  expect(back).not.toHaveBeenCalled();
  back.mockRestore();
});

it("keeps a skin's address through Discord sign-in", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  visit("skins", "sub-1");
  render(<ProfilePanel />);
  const link = await screen.findByRole("link", { name: "Sign in with Discord" });
  expect(new URL(link.getAttribute("href")!).searchParams.get("return_to")).toBe("/profile?tab=skins&skin=sub-1");
});

it("shows when the next skin is ready and keeps codes behind Use a code", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  const nextAt = new Date(Date.now() + 3 * 86400000 - 60000).toISOString();
  vi.mocked(getProfileDashboard).mockResolvedValue(
    wardrobe({ can_start: { skin: { can_start: false, reason: "cooldown", next_at: nextAt }, drink: READY } }),
  );
  visit("skins");
  render(<ProfilePanel />);
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
  visit("skins");
  render(<ProfilePanel />);
  fireEvent.click(await screen.findByRole("button", { name: "New skin" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Your rank can’t make skins");
  expect(screen.queryByRole("heading", { level: 2, name: "New skin" })).toBeNull();
});

it("shows a viewed player's accounts with every action disabled", async () => {
  vi.mocked(getAccount).mockResolvedValue(
    account({
      minecraft: linked(),
      patreon: { linked: false },
      viewing_as: { staff_name: "boss", expires_at: "2099-01-01T00:00:00Z" },
    }),
  );
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  const card = await screen.findByRole("list", { name: "Connected accounts" });
  expect(screen.getByText("View only: you can’t change their accounts.")).toBeTruthy();
  const buttons = within(card).getAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual(expect.arrayContaining(["Sign out", "Unlink"]));
  // Browsers send no clicks to these (jsdom does). The card stays readable, so it isn't inert.
  for (const button of buttons) expect((button as HTMLButtonElement).matches(":disabled")).toBe(true);
  expect(card.closest("fieldset")?.hasAttribute("inert")).toBe(false);
});

it("offers no Discord sign-in link during a view, which would leave it", async () => {
  vi.mocked(getAccount).mockResolvedValue(
    account({
      guild: { member: false, checked_at: null, fresh: false, can_recheck: false },
      viewing_as: { staff_name: "boss", expires_at: "2099-01-01T00:00:00Z" },
    }),
  );
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  const card = await screen.findByRole("list", { name: "Connected accounts" });
  expect(within(card).queryByRole("link", { name: /check again|Sign in with Discord/ })).toBeNull();
  expect(
    (within(card).getByRole("button", { name: "I’ve joined, check again" }) as HTMLButtonElement).matches(":disabled"),
  ).toBe(true);
});

it("leaves the card usable outside a view", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  visit("accounts");
  render(<ProfilePanel signin={null} />);
  const card = await screen.findByRole("list", { name: "Connected accounts" });
  expect(screen.queryByText(/View only/)).toBeNull();
  expect((within(card).getByRole("button", { name: "Sign out" }) as HTMLButtonElement).matches(":disabled")).toBe(
    false,
  );
});

const SKIN_CODE = {
  session_token: "skin-code",
  player_uuid: UUID,
  expires_at: "2099-01-01T00:00:00Z",
  scope: "skin",
};

it("opens just the Skins wardrobe for a skin code, with the editor one click away", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  vi.mocked(signInWithCode).mockImplementation(async () => {
    setSkinsSession(SKIN_CODE);
    return { tab: "skins", profile: null };
  });
  vi.mocked(getCodeWardrobe).mockResolvedValue({ items: [SKIN], can_start: READY });
  render(<ProfilePanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Use a code" }));
  fireEvent.change(screen.getByLabelText("Log in with code"), { target: { value: "SKIN-CODE" } });
  fireEvent.click(screen.getByRole("button", { name: "Enter" }));
  const card = await screen.findByRole("link", { name: /Emberfang/ });
  expect(card.getAttribute("href")).toBe("/profile?tab=skins&skin=sub-1");
  expect(getCodeWardrobe).toHaveBeenCalledWith("skin-code");
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Skins", "Linked accounts"]);
  expect(window.location.search).toBe("?tab=skins");
  expect(screen.getByText("Opened with an in-game code.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "New skin" }));
  expect(await screen.findByRole("button", { name: "Submit skin" })).toBeTruthy();
  expect(window.location.search).toBe("?tab=skins&skin=new");
  expect(startSkinFromProfile).not.toHaveBeenCalled();
  expect(getProfileDashboard).not.toHaveBeenCalled();
});

it("follows a second skin code entered in the code wardrobe", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  setSkinsSession(SKIN_CODE);
  vi.mocked(getCodeWardrobe).mockResolvedValue({
    items: [SKIN],
    can_start: { can_start: false, reason: "used", next_at: null },
  });
  vi.mocked(redeemCode).mockResolvedValue({ ...SKIN_CODE, session_token: "skin-code-2", code_id: 8 });
  visit("skins");
  render(<ProfilePanel />);
  expect(await screen.findByText("Code used")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use a code" }));
  fireEvent.change(screen.getByLabelText("Skin code"), { target: { value: "SKIN-TWO" } });
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(await screen.findByRole("button", { name: "Submit skin" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "← Skins" }));
  await vi.waitFor(() => expect(getCodeWardrobe).toHaveBeenLastCalledWith("skin-code-2"));
  expect(getSkinsSession()?.session_token).toBe("skin-code-2");
});

it("says when a code has made its skin, and Log out ends the code", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  setSkinsSession(SKIN_CODE);
  vi.mocked(getCodeWardrobe).mockResolvedValue({
    items: [SKIN],
    can_start: { can_start: false, reason: "used", next_at: null },
  });
  visit("characters");
  render(<ProfilePanel />);
  expect(await screen.findByText("Code used")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New skin" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Skins" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
  expect(logoutCharacter).toHaveBeenCalledWith("skin-code");
  expect(getSkinsSession()).toBeNull();
});

it("leaves skin sessions Profile started out of the code view", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  setSkinsSession({ ...SKIN_CODE, from_profile: true });
  render(<ProfilePanel />);
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
  expect(getCodeWardrobe).not.toHaveBeenCalled();
});

it("falls back to sign-in when a code's session has run out", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  setSkinsSession(SKIN_CODE);
  vi.mocked(getCodeWardrobe).mockRejectedValue(new ProfileApiError("expired", 401));
  visit("skins");
  render(<ProfilePanel />);
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
  expect(getSkinsSession()).toBeNull();
});

it("opens the code form on the Skins and Drinks tabs", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  visit("drinks");
  render(<ProfilePanel />);
  const toggle = await screen.findByRole("button", { name: "Use a code" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const form = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(form.hidden).toBe(false);
  expect(form.textContent).toContain("/token create profile, skin or drink");
});

it("lets a Discord account without a Minecraft link open a wardrobe with a code", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  vi.mocked(signInWithCode).mockImplementation(async () => {
    setSkinsSession(SKIN_CODE);
    return { tab: "skins", profile: null };
  });
  vi.mocked(getCodeWardrobe).mockResolvedValue({ items: [SKIN], can_start: READY });
  visit("skins");
  render(<ProfilePanel />);
  const toggle = await screen.findByRole("button", { name: "Enter code" });
  // The Skins tab opens with the form showing.
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  fireEvent.change(screen.getByLabelText("Log in with code"), { target: { value: "SKIN-CODE" } });
  fireEvent.click(screen.getByRole("button", { name: "Enter" }));
  expect(await screen.findByRole("link", { name: /Emberfang/ })).toBeTruthy();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Skins", "Linked accounts"]);
  expect(screen.queryByRole("button", { name: "Enter code" })).toBeNull();
});

const CUSTOM_ITEM = {
  character_id: "c1",
  character_name: "Aldric",
  kit_key: "iron_hunting_knife",
  kit_id: "starter",
  display_name: "Exhumer's Spade",
  state: "denied",
  deny_reason: "Too bright",
};

it("opens a custom item in its own tab rather than the character's kits", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ custom_items: [CUSTOM_ITEM] }));
  vi.mocked(listCharacterKits).mockResolvedValue({
    character_id: "c1",
    kits: [
      {
        id: "starter",
        display_name: "Starter",
        cooldown_hours: 0,
        once_per_character: true,
        status: "eligible",
        claimable: true,
        items: [
          {
            path: "MI.iron_hunting_knife",
            amount: 1,
            editable: true,
            kit_key: "iron_hunting_knife",
            preview: { display_name: "Iron Hunting Knife", lore: ["§7A knife."], material: "IRON_SWORD" },
            customise: {
              display_name: "Exhumer's Spade",
              lore: ["Used for too long"],
              existing_skin_id: null,
              submission_id: null,
              submission_status: null,
              state: "denied",
            },
          },
        ],
      },
    ],
  });
  visit("items");
  render(<ProfilePanel />);
  const card = await screen.findByRole("link", { name: /Exhumer's Spade/ });
  // The card keeps to the grid's height; the reason is on the item's page.
  expect(screen.queryByText("Too bright")).toBeNull();
  expect(card.getAttribute("href")).toBe("/profile?tab=items&item=c1%2Firon_hunting_knife");
  fireEvent.click(card);
  expect(await screen.findByRole("heading", { level: 2, name: "Exhumer's Spade" })).toBeTruthy();
  expect(window.location.search).toBe("?tab=items&item=c1%2Firon_hunting_knife");
  expect(listCharacterKits).toHaveBeenCalledWith("linked-token", "c1");
  expect(screen.getByText("Too bright")).toBeTruthy();
  expect(screen.getByText("Used for too long")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Edit item" }).getAttribute("href")).toBe(
    "/character/c1/kits/starter/edit/iron_hunting_knife",
  );
  window.history.back();
  expect(await screen.findByRole("link", { name: /Exhumer's Spade/ })).toBeTruthy();
  expect(window.location.search).toBe("?tab=items");
});

it("opens a character's kits inside Profile, and ← returns to the character", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(
    wardrobe({ characters: CHARACTERS, custom_items: [{ ...CUSTOM_ITEM, character_name: "Vaelthir" }] }),
  );
  vi.mocked(listCharacterKits).mockResolvedValue({
    character_id: "c1",
    kits: [
      {
        id: "starter",
        display_name: "Starter",
        cooldown_hours: 0,
        once_per_character: true,
        status: "granted",
        claimable: false,
        items: [
          {
            path: "MI.iron_hunting_knife",
            amount: 1,
            editable: true,
            kit_key: "iron_hunting_knife",
            customise: { display_name: "Exhumer's Spade", lore: [], state: "applied" },
          },
          { path: "m.currency.GOLD_COIN", amount: 32, editable: false },
        ],
      },
    ],
  });
  window.history.replaceState(null, "", "/profile?tab=characters&character=c1");
  render(<ProfilePanel />);
  fireEvent.click(await screen.findByRole("link", { name: "Kits" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Starter kit" })).toBeTruthy();
  expect(window.location.search).toBe("?tab=characters&character=c1&view=kits");
  // Profile's tabs stay; config names are cased like item names.
  expect(screen.getByRole("tab", { name: "Characters" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("Gold Coin")).toBeTruthy();
  expect(screen.getByText("Claimed")).toBeTruthy();
  // A customised item opens in Custom items, and Back returns to the kit.
  fireEvent.click(screen.getByRole("link", { name: "View" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Exhumer's Spade" })).toBeTruthy();
  expect(window.location.search).toBe("?tab=items&item=c1%2Firon_hunting_knife");
  window.history.back();
  expect(await screen.findByRole("heading", { level: 2, name: "Starter kit" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "← Vaelthir" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Vaelthir" })).toBeTruthy();
  expect(window.location.search).toBe("?tab=characters&character=c1");
});

it("offers to customise an unclaimed kit's items and sends a direct kits address back to its character", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ minecraft: linked() }));
  vi.mocked(getProfileDashboard).mockResolvedValue(wardrobe({ characters: CHARACTERS }));
  vi.mocked(listCharacterKits).mockResolvedValue({
    character_id: "c1",
    kits: [
      {
        id: "starter",
        display_name: "Starter",
        cooldown_hours: 0,
        once_per_character: true,
        status: "eligible",
        claimable: true,
        items: [
          {
            path: "MI.iron_hunting_knife",
            amount: 1,
            editable: true,
            kit_key: "iron_hunting_knife",
            preview: { display_name: "Iron Hunting Knife", lore: [], material: "IRON_SWORD" },
          },
        ],
      },
    ],
  });
  window.history.replaceState(null, "", "/profile?tab=characters&character=c1&view=kits");
  render(<ProfilePanel />);
  expect(await screen.findByText("Iron Hunting Knife")).toBeTruthy();
  expect(screen.getByText("/rpcharacter kit starter")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Customise" }).getAttribute("href")).toBe(
    "/character/c1/kits/starter/edit/iron_hunting_knife",
  );
  fireEvent.click(screen.getByRole("link", { name: "← Vaelthir" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Vaelthir" })).toBeTruthy();
  expect(window.location.search).toBe("?tab=characters&character=c1");
});
