/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProfilePage from "./page";
import { getAccount, startLinkedProfileSession, type Account } from "../../lib/account/api";
import { logoutCharacter } from "../../lib/characters/api";
import { getProfileDashboard, type ProfileDashboard } from "../../lib/profile/api";
import { getSession, setSession } from "../../lib/profile/session";
import { getSkinThumbnail, startSkinFromProfile } from "../../lib/skins/api";
import { getSession as getSkinsSession } from "../../lib/skins/session";
import { StartRefusedError } from "../../lib/profile/start";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("../../lib/account/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/account/api")>(),
  getAccount: vi.fn(),
  signOut: vi.fn(),
  startLinkedProfileSession: vi.fn(),
}));
vi.mock("../../lib/profile/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/profile/api")>(),
  getProfileDashboard: vi.fn(),
}));
vi.mock("../../lib/skins/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/skins/api")>(),
  getSkinThumbnail: vi.fn(),
  startSkinFromProfile: vi.fn(),
}));
vi.mock("../../lib/characters/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/characters/api")>(),
  logoutCharacter: vi.fn(),
}));

const UUID = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8";

function account(linked: boolean): Account {
  return {
    user: { discord_user_id: "1", discord_username: "steve", discord_global_name: null, avatar_url: "a.png" },
    guild: { member: true, checked_at: null, fresh: true },
    minecraft: linked
      ? { player_uuid: UUID, minecraft_name: "SteveMC", linked_at: "z", in_grace: false, grace_until: null }
      : null,
    patreon: null,
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://www.tfminecraft.net/api");
  vi.mocked(startLinkedProfileSession).mockResolvedValue({
    session_token: "linked-token", player_uuid: UUID, expires_at: "2099-01-01T00:00:00Z", scope: "profile", realm_id: "main",
  });
  vi.mocked(getProfileDashboard).mockResolvedValue(dashboard());
  vi.mocked(getSkinThumbnail).mockResolvedValue(null);
});

const READY = { can_start: true, reason: null, next_at: null } as const;

function dashboard(extra: Partial<ProfileDashboard> = {}): ProfileDashboard {
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
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

it("opens without a code for a linked Discord account, on the tab in the address", async () => {
  window.history.replaceState(null, "", "/profile?tab=skins");
  vi.mocked(getAccount).mockResolvedValue(account(true));
  render(<ProfilePage />);
  expect(await screen.findByText("SteveMC")).toBeTruthy();
  expect(getProfileDashboard).toHaveBeenCalledWith("linked-token");
  expect(screen.queryByText(/token create profile/)).toBeNull();
  expect(screen.getByRole("button", { name: "Skins" }).className).toContain("bg-");
  expect(screen.getByRole("button", { name: "Characters" }).className).not.toContain("bg-");
});

it("leaves Discord sign-out to Account", async () => {
  vi.mocked(getAccount).mockResolvedValue(account(true));
  render(<ProfilePage />);
  await screen.findByText("SteveMC");
  expect(screen.queryByRole("button", { name: /Sign out|Log out/ })).toBeNull();
  expect(screen.queryByText(/Supporter/)).toBeNull();
});

it("ends a code session with Log out", async () => {
  setSession({ session_token: "code-token", player_uuid: UUID, expires_at: "2099-01-01T00:00:00Z", scope: "profile" });
  render(<ProfilePage />);
  fireEvent.click(await screen.findByRole("button", { name: "Log out" }));
  expect(await screen.findByText(/token create profile/)).toBeTruthy();
  expect(logoutCharacter).toHaveBeenCalledWith("code-token");
  expect(getSession()).toBeNull();
});

it("lays skins out as a wardrobe and starts a new one without a code", async () => {
  window.history.replaceState(null, "", "/profile?tab=skins");
  vi.mocked(getAccount).mockResolvedValue(account(true));
  vi.mocked(getProfileDashboard).mockResolvedValue(dashboard({ skins: [SKIN] }));
  vi.mocked(startSkinFromProfile).mockResolvedValue({
    session_token: "skin-token", player_uuid: UUID, expires_at: "2099-01-01T00:00:00Z", code_id: 7,
    scope: "skin", skin_kinds: ["handheld"],
  });
  render(<ProfilePage />);
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
  window.history.replaceState(null, "", "/profile?tab=skins");
  vi.mocked(getAccount).mockResolvedValue(account(true));
  const nextAt = new Date(Date.now() + 3 * 86400000 - 60000).toISOString();
  vi.mocked(getProfileDashboard).mockResolvedValue(
    dashboard({ can_start: { skin: { can_start: false, reason: "cooldown", next_at: nextAt }, drink: READY } })
  );
  render(<ProfilePage />);
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
  window.history.replaceState(null, "", "/profile?tab=skins");
  vi.mocked(getAccount).mockResolvedValue(account(true));
  vi.mocked(startSkinFromProfile).mockRejectedValue(new StartRefusedError("rank", null));
  render(<ProfilePage />);
  fireEvent.click(await screen.findByRole("button", { name: "New skin" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Your rank can’t make skins");
  expect(push).not.toHaveBeenCalled();
});

it("offers Discord sign-in, then the in-game code, when signed out", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  render(<ProfilePage />);
  const link = await screen.findByRole("link", { name: "Sign in with Discord" });
  expect(link.getAttribute("href")).toContain("return_to=%2Fprofile");
  expect(screen.getByText(/Or run/).textContent).toContain("/token create profile");
  expect(startLinkedProfileSession).not.toHaveBeenCalled();
});

it("points a signed-in but unlinked account to linking", async () => {
  vi.mocked(getAccount).mockResolvedValue(account(false));
  render(<ProfilePage />);
  expect((await screen.findByRole("link", { name: "Link your Minecraft account" })).getAttribute("href")).toBe("/account");
});

it("keeps the code form alone when Discord sign-in is unavailable", async () => {
  vi.mocked(getAccount).mockRejectedValue(new Error("503"));
  render(<ProfilePage />);
  expect((await screen.findByText(/token create profile/)).closest("p")?.textContent).toMatch(/^Run/);
  expect(screen.queryByRole("link", { name: "Sign in with Discord" })).toBeNull();
});
