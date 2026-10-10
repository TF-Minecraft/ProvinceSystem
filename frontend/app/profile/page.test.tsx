/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProfilePage from "./page";
import { getAccount, signOut, startLinkedProfileSession, type Account } from "../../lib/account/api";
import { logoutCharacter } from "../../lib/characters/api";
import { getProfileDashboard } from "../../lib/profile/api";
import { getSession } from "../../lib/profile/session";

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
vi.mock("../../lib/profile/patreon", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/profile/patreon")>(),
  getPatreonStatus: vi.fn().mockRejectedValue(new Error("off")),
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
  vi.mocked(getProfileDashboard).mockResolvedValue({
    characters: [], max_alive_characters: 5, skins: [], drinks: [], custom_items: [],
  });
});
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
  expect(await screen.findByText(/Opened through your/)).toBeTruthy();
  expect(getProfileDashboard).toHaveBeenCalledWith("linked-token");
  expect(screen.queryByText(/token create profile/)).toBeNull();
  expect(screen.getByRole("button", { name: "Skins" }).className).toContain("bg-");
  expect(screen.getByRole("button", { name: "Characters" }).className).not.toContain("bg-");
});

it("signs out of Discord too when signing out of a Profile opened through Discord", async () => {
  vi.mocked(getAccount).mockResolvedValue(account(true));
  render(<ProfilePage />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
  expect(logoutCharacter).toHaveBeenCalledWith("linked-token");
  expect(signOut).toHaveBeenCalled();
  expect(getSession()).toBeNull();
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
