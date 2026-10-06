/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PlayersDirectory from "./PlayersDirectory";
import { AccountApiError } from "../../../lib/account/api";
import { getPlayers, type PlayerDirectory, type PlayerSummary } from "../../../lib/admin/api";

vi.mock("../../../lib/admin/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/admin/api")>(),
  getPlayers: vi.fn(),
}));

const NOW = 2_000_000_000;

function player(uuid: string, name: string | null, extra: Partial<PlayerSummary> = {}): PlayerSummary {
  return {
    uuid, minecraft_name: name, discord_user_id: null, discord_username: null, site_role: null,
    characters: [], last_seen: null, online: false, ...extra,
  };
}

function directory(players: PlayerSummary[], extra: Partial<PlayerDirectory> = {}): PlayerDirectory {
  return {
    players, total: players.length, page: 1, page_size: 50,
    coreprotect: { status: "available", server_label: "Vardera" }, ...extra,
  };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  window.history.replaceState(null, "", "/admin/players");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("lists players with Discord, characters and last seen", async () => {
  vi.mocked(getPlayers).mockResolvedValue(directory([
    player("0615a817-8cb4-4aef-95f7-f6c9bf7611b8", "MrEnzo99", {
      discord_username: "hazelstone", characters: ["Hazel Stonebrook"], last_seen: NOW - 7200, site_role: "mod",
    }),
    player("33333333-3333-3333-3333-333333333333", "Quiet", { online: true, last_seen: NOW }),
    player("22222222-2222-2222-2222-222222222222", null),
  ]));
  render(<PlayersDirectory initialQuery="" initialSort="last_seen" initialPage={1} />);

  const link = await screen.findByRole("link", { name: "MrEnzo99" });
  expect(link.getAttribute("href")).toBe("/admin/players/0615a817-8cb4-4aef-95f7-f6c9bf7611b8");
  const row = link.closest("tr")!;
  expect(within(row).getAllByText("@hazelstone")).toHaveLength(2);
  // In its column, and again under the name for narrow screens.
  expect(within(row).getAllByText("Hazel Stonebrook").length).toBeGreaterThan(0);
  expect(within(row).getByText("2 h ago")).toBeTruthy();
  expect(within(row).getByText("Moderator")).toBeTruthy();
  expect(screen.getByText("Seen just now")).toBeTruthy();
  expect(screen.getByRole("link", { name: "22222222-2222-2222-2222-222222222222" })).toBeTruthy();
  expect(screen.getByText(/3 players · activity from Vardera/)).toBeTruthy();
});

it("searches after typing stops and sorts by Discord name", async () => {
  vi.mocked(getPlayers).mockResolvedValue(directory([]));
  render(<PlayersDirectory initialQuery="" initialSort="last_seen" initialPage={1} />);
  await screen.findByText("No players match that.");

  fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "hazel" } });
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith({ q: "hazel", sort: "last_seen", page: 1 }));
  fireEvent.click(screen.getByRole("button", { name: "Discord name" }));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith({ q: "hazel", sort: "discord", page: 1 }));
  expect(window.location.search).toBe("?q=hazel&sort=discord");

  fireEvent.click(screen.getByRole("button", { name: "Character name" }));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith({ q: "hazel", sort: "character", page: 1 }));
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith({ q: "", sort: "character", page: 1 }));
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
});

it("pages through results", async () => {
  vi.mocked(getPlayers).mockImplementation(async ({ page }) =>
    directory([player(`0000000${page}-0000-0000-0000-000000000000`, `P${page}`)], { total: 120, page: page ?? 1 }));
  render(<PlayersDirectory initialQuery="" initialSort="minecraft" initialPage={1} />);
  await screen.findByText("Page 1 of 3");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Page 2 of 3");
  expect(getPlayers).toHaveBeenLastCalledWith({ q: "", sort: "minecraft", page: 2 });
  expect(window.location.search).toBe("?sort=minecraft&page=2");
});

it("says when CoreProtect cannot be read", async () => {
  vi.mocked(getPlayers).mockResolvedValue(directory([player("11111111-1111-1111-1111-111111111111", "Linked")], {
    coreprotect: { status: "unavailable", reason: "busy", server_label: null },
  }));
  render(<PlayersDirectory initialQuery="" initialSort="last_seen" initialPage={1} />);
  expect(await screen.findByText(/CoreProtect is busy.*Only linked players and characters are listed/)).toBeTruthy();
});

it.each([
  [401, "Sign in with Discord"],
  [403, "This page is for TFMC staff only."],
])("explains a %s", async (status, text) => {
  vi.mocked(getPlayers).mockRejectedValue(new AccountApiError("x", status));
  render(<PlayersDirectory initialQuery="" initialSort="last_seen" initialPage={1} />);
  expect(await screen.findByText(text)).toBeTruthy();
});

it("shows request errors without hiding the search", async () => {
  vi.mocked(getPlayers).mockRejectedValue(new AccountApiError("query_too_long", 400));
  render(<PlayersDirectory initialQuery={"x".repeat(70)} initialSort="last_seen" initialPage={1} />);
  expect(await screen.findByText("Search for 64 characters or fewer.")).toBeTruthy();
  expect(screen.getByLabelText("Search players")).toBeTruthy();
  await act(async () => {});
});
