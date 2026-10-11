/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import PlayerFrame, { usePlayer } from "./PlayerFrame";
import { AccountApiError } from "../../../lib/account/api";
import { viewSiteAs } from "../../../lib/account/viewAs";
import { getAdminMe, getPlayer, type PlayerProfile as Profile } from "../../../lib/admin/api";

const UUID = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => `/admin/players/${UUID}/movement`,
}));
vi.mock("../../../lib/account/viewAs", () => ({ viewSiteAs: vi.fn() }));
vi.mock("../../../lib/admin/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/admin/api")>()),
  getAdminMe: vi.fn(),
  getPlayer: vi.fn(),
}));

const PROFILE = {
  uuid: UUID, minecraft_name: "MrEnzo99", past_names: [], first_seen: null, last_seen: null, online: true,
  discord: null, account: null, characters: [], coreprotect: { status: "available", server_label: "Vardera", ping_seconds: 60 },
} as unknown as Profile;

function Name() {
  return <p>Page for {usePlayer()?.profile.minecraft_name}</p>;
}

beforeEach(() => {
  vi.mocked(getPlayer).mockResolvedValue(PROFILE);
  vi.mocked(getAdminMe).mockResolvedValue({ capabilities: ["view_player_movement"] } as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps the player's header and tabs over the movement page, and hands the page the player", async () => {
  render(<PlayerFrame uuid={UUID}><Name /></PlayerFrame>);
  expect(await screen.findByText("Page for MrEnzo99")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "MrEnzo99" })).toBeTruthy();
  const tabs = screen.getByRole("navigation", { name: "Player" });
  expect((await within(tabs).findByRole("link", { name: "Movement" })).getAttribute("aria-current")).toBe("page");
  expect(getPlayer).toHaveBeenCalledTimes(1);
});

it("holds its page back until the player has loaded", () => {
  vi.mocked(getPlayer).mockReturnValue(new Promise(() => undefined));
  render(<PlayerFrame uuid={UUID}><Name /></PlayerFrame>);
  expect(screen.getByText("Loading…")).toBeTruthy();
  expect(screen.queryByText(/Page for/)).toBeNull();
});

const PLAYER_ACCOUNT = { user_id: 7, role: "player" };

it("lets an admin view the site as a player with a site account", async () => {
  vi.mocked(getPlayer).mockResolvedValue({ ...PROFILE, account: PLAYER_ACCOUNT } as unknown as Profile);
  vi.mocked(getAdminMe).mockResolvedValue({ capabilities: ["view_as_player"] } as never);
  vi.mocked(viewSiteAs).mockRejectedValue(new AccountApiError("target_is_staff", 403));
  render(<PlayerFrame uuid={UUID}><Name /></PlayerFrame>);
  fireEvent.click(await screen.findByRole("button", { name: "View the site as them →" }));
  expect(viewSiteAs).toHaveBeenCalledWith(7);
  expect((await screen.findByRole("alert")).textContent).toBe("You can only view the site as players, not staff.");
});

it.each([
  ["a mod", ["view_players"], PLAYER_ACCOUNT],
  ["a staff account", ["view_as_player"], { user_id: 7, role: "mod" }],
  ["no site account", ["view_as_player"], null],
])("offers no view for %s", async (_name, capabilities, account) => {
  vi.mocked(getPlayer).mockResolvedValue({ ...PROFILE, account } as unknown as Profile);
  vi.mocked(getAdminMe).mockResolvedValue({ capabilities } as never);
  render(<PlayerFrame uuid={UUID}><Name /></PlayerFrame>);
  await screen.findByText("Page for MrEnzo99");
  await Promise.resolve();
  expect(screen.queryByRole("button", { name: /View the site as/ })).toBeNull();
});
