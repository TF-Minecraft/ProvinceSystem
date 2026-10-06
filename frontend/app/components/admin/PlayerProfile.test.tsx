/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PlayerProfile from "./PlayerProfile";
import { AccountApiError } from "../../../lib/account/api";
import {
  getPlayer,
  getPlayerActivity,
  getPlayerSessions,
  type ActivityEntry,
  type PlayerProfile as Profile,
} from "../../../lib/admin/api";

vi.mock("../../../lib/admin/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/admin/api")>(),
  getPlayer: vi.fn(),
  getPlayerSessions: vi.fn(),
  getPlayerActivity: vi.fn(),
}));

const UUID = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8";
const NOW = 2_000_000_000;
const KINDS = ["block", "click", "kill", "spawn", "container", "item", "entity", "sign", "skill", "command", "session"];

const PROFILE: Profile = {
  uuid: UUID,
  minecraft_name: "MrEnzo99",
  past_names: [{ name: "OldEnzo", time: 1 }],
  first_seen: NOW - 86400 * 10,
  last_seen: NOW - 3600,
  online: false,
  discord: {
    discord_user_id: "422545450919526411", discord_username: "hazelstone", linked_at: "2026-09-20T10:00:00Z",
    left_guild_at: null, grace_until: null,
  },
  account: null,
  characters: [{ realm_id: "main", character_id: "c1", name: "Hazel Stonebrook", status: "alive", race: "human",
                 class: "smith", updated_at: null }],
  coreprotect: { status: "available", server_label: "Vardera", ping_seconds: 60 },
};

function entry(id: string, extra: Partial<ActivityEntry>): ActivityEntry {
  return {
    id, time: NOW - 60, kind: "block", verb: "broke", target: "stone", amount: null, victim: null,
    world: "TFMC_Map", x: 1, y: 64, z: 2, rolled_back: null, ...extra,
  };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  vi.mocked(getPlayer).mockResolvedValue(PROFILE);
  vi.mocked(getPlayerSessions).mockResolvedValue({
    sessions: [
      { start: { time: NOW - 7200, world: "TFMC_Map", x: 0, y: 64, z: 0 },
        end: { time: NOW - 3600, world: "TFMC_Map", x: 5, y: 64, z: 5 }, end_kind: "logout", duration_seconds: 3600 },
      { start: { time: NOW - 90000, world: "TFMC_Map", x: 0, y: 64, z: 0 },
        end: { time: NOW - 88200, world: "TFMC_Map", x: 1, y: 64, z: 1 }, end_kind: "last_observed", duration_seconds: 1800 },
    ],
    next: null, first_seen: NOW - 864000, history_start: NOW - 864000, coreprotect: { status: "available" },
  });
  vi.mocked(getPlayerActivity).mockResolvedValue({
    entries: [
      entry("block:1", {}),
      entry("block:2", { kind: "kill", verb: "killed", target: "Bob", victim: { minecraft_name: "Bob", uuid: "00000000-0000-0000-0000-000000000002" } }),
      entry("container:3", { kind: "container", verb: "added", target: "iron_ingot", amount: 3, rolled_back: "rolled back" }),
    ],
    next: "cursor-1", searched_to: null, kinds: KINDS, coreprotect: { status: "available" },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it("shows identity, Discord and characters", async () => {
  render(<PlayerProfile uuid={UUID} />);
  expect(await screen.findByRole("heading", { name: "MrEnzo99" })).toBeTruthy();
  expect(screen.getByText(UUID)).toBeTruthy();
  expect(screen.getByText(/Last seen 1 h ago/)).toBeTruthy();
  expect(screen.getByText("Previously OldEnzo")).toBeTruthy();
  expect(screen.getByText("@hazelstone")).toBeTruthy();
  expect(screen.getByText("Hasn’t signed in")).toBeTruthy();
  expect(screen.getByText("Hazel Stonebrook")).toBeTruthy();
});

it("shows sessions, marking ones without a logout", async () => {
  render(<PlayerProfile uuid={UUID} />);
  const sessions = await screen.findByRole("region", { name: "Sessions" });
  await within(sessions).findByText("1 h");
  expect(within(sessions).getByText("Logged out")).toBeTruthy();
  expect(within(sessions).getByText("At least 30 min")).toBeTruthy();
  expect(within(sessions).getByText("No logout recorded")).toBeTruthy();
});

it("shows activity, links victims and loads more", async () => {
  render(<PlayerProfile uuid={UUID} />);
  const feed = await screen.findByRole("region", { name: "Recent activity" });
  expect(await within(feed).findByRole("link", { name: "Bob" })).toBeTruthy();
  expect(within(feed).getByText("3 × iron_ingot")).toBeTruthy();
  expect(within(feed).getByText("rolled back")).toBeTruthy();
  expect(getPlayerActivity).toHaveBeenCalledWith(UUID, { before: null, kinds: undefined });

  vi.mocked(getPlayerActivity).mockResolvedValueOnce({
    entries: [entry("block:0", { verb: "placed", target: "oak_door" })], next: null, searched_to: null,
    kinds: KINDS, coreprotect: { status: "available" },
  });
  fireEvent.click(within(feed).getByRole("button", { name: "Load more" }));
  expect(await within(feed).findByText("oak_door")).toBeTruthy();
  expect(getPlayerActivity).toHaveBeenLastCalledWith(UUID, { before: "cursor-1", kinds: undefined });
  expect(within(feed).queryByRole("button", { name: "Load more" })).toBeNull();
  expect(within(feed).getByText("stone")).toBeTruthy();
});

it("filters by kind from the first page", async () => {
  render(<PlayerProfile uuid={UUID} />);
  const feed = await screen.findByRole("region", { name: "Recent activity" });
  await within(feed).findByText("stone");
  vi.mocked(getPlayerActivity).mockResolvedValue({
    entries: [], next: "cursor-9", searched_to: NOW - 86400, kinds: KINDS, coreprotect: { status: "available" },
  });
  fireEvent.click(within(feed).getByRole("button", { name: "Kills" }));
  await waitFor(() => expect(getPlayerActivity).toHaveBeenLastCalledWith(UUID, { before: null, kinds: ["kill"] }));
  expect(await within(feed).findByRole("button", { name: "Search further back" })).toBeTruthy();
  expect(within(feed).getByText(/Searched back to/)).toBeTruthy();
});

it("reports CoreProtect problems per section", async () => {
  vi.mocked(getPlayerSessions).mockResolvedValue({ sessions: [], next: null, coreprotect: { status: "unavailable", reason: "timeout" } });
  render(<PlayerProfile uuid={UUID} />);
  const sessions = await screen.findByRole("region", { name: "Sessions" });
  expect(await within(sessions).findByText(/CoreProtect took too long/)).toBeTruthy();
});

it.each([
  [404, "player_not_found", "No player with that UUID has been seen."],
  [400, "bad_uuid", "That isn’t a Minecraft UUID."],
  [403, "forbidden", "This page is for TFMC staff only."],
])("explains a %s", async (status, code, text) => {
  vi.mocked(getPlayer).mockRejectedValue(new AccountApiError(code, status));
  render(<PlayerProfile uuid={UUID} />);
  expect(await screen.findByText(text)).toBeTruthy();
});
