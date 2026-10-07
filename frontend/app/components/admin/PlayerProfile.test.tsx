/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Day headings below are written for London.
process.env.TZ = "Europe/London";

import PlayerProfile from "./PlayerProfile";
import { AccountApiError } from "../../../lib/account/api";
import {
  getAdminMe,
  getPlayer,
  getPlayerActivity,
  getPlayerSessions,
  type ActivityEntry,
  type PlayerProfile as Profile,
} from "../../../lib/admin/api";

vi.mock("../../../lib/admin/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/admin/api")>(),
  getAdminMe: vi.fn(),
  getPlayer: vi.fn(),
  getPlayerSessions: vi.fn(),
  getPlayerActivity: vi.fn(),
}));

// The movement card asks who is signed in; it has its own tests.
vi.mock("./MovementCard", () => ({ default: () => null }));

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
    discord_user_id: "422545450919526411", discord_username: "hazelstone", discord_nickname: "Hazel | Enzo",
    linked_at: "2026-09-20T10:00:00Z",
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
    message: null, truncated: false, world: "TFMC_Map", x: 1, y: 64, z: 2, rolled_back: null, ...extra,
  };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  vi.mocked(getPlayer).mockResolvedValue(PROFILE);
  // A mod: no movement.
  vi.mocked(getAdminMe).mockResolvedValue({ capabilities: [] } as never);
  vi.mocked(getPlayerSessions).mockResolvedValue({
    sessions: [
      { start: { time: NOW - 7200, world: "TFMC_Map", x: 0, y: 64, z: 0 },
        end: { time: NOW - 3600, world: "TFMC_Map", x: 5, y: 64, z: 5 }, end_kind: "logout", duration_seconds: 3600,
        id: "s1", last_observed: { time: NOW - 3600, world: "TFMC_Map", x: 5, y: 64, z: 5 } },
      { start: { time: NOW - 90000, world: "TFMC_Map", x: 0, y: 64, z: 0 },
        end: { time: NOW - 88200, world: "TFMC_Map", x: 1, y: 64, z: 1 }, end_kind: "last_observed", duration_seconds: 1800,
        id: "s2", last_observed: { time: NOW - 88200, world: "TFMC_Map", x: 1, y: 64, z: 1 } },
    ],
    next: null, first_seen: NOW - 864000, history_start: NOW - 864000, coreprotect: { status: "available" },
  });
  vi.mocked(getPlayerActivity).mockResolvedValue({
    entries: [
      entry("block:1", {}),
      entry("block:2", { kind: "kill", verb: "killed", target: "Bob", victim: { minecraft_name: "Bob", uuid: "00000000-0000-0000-0000-000000000002" } }),
      entry("container:3", { kind: "container", verb: "added", target: "iron_ingot", amount: 3, rolled_back: "rolled back" }),
    ],
    next: "cursor-1", searched_to: null, kinds: KINDS, shows_messages: false, coreprotect: { status: "available" },
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

it("groups sessions by day and hedges ones without a logout", async () => {
  render(<PlayerProfile uuid={UUID} />);
  const sessions = await screen.findByRole("region", { name: "Sessions" });
  await within(sessions).findByText("1 h");
  expect(within(sessions).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Today", "Yesterday"]);
  expect(within(sessions).getByText("at least 30 min")).toBeTruthy();
  expect(within(sessions).getByText(/^No logout recorded · last seen \d\d:\d\d$/)).toBeTruthy();
  expect(within(sessions).queryByText(/Logged out/)).toBeNull();
  expect(within(sessions).queryByRole("link")).toBeNull();
  expect(within(sessions).getByText(/^Retained session records start/)).toBeTruthy();
});

it("links each session to its route for those who may see movement", async () => {
  vi.mocked(getAdminMe).mockResolvedValue({ capabilities: ["view_player_movement"] } as never);
  render(<PlayerProfile uuid={UUID} />);
  const sessions = await screen.findByRole("region", { name: "Sessions" });
  const today = await within(sessions).findByRole("link", { name: /^Today, \d\d:\d\d to \d\d:\d\d, 1 h$/ });
  expect(today.getAttribute("href")).toBe(`/admin/players/${UUID}/movement?session=s1`);
  expect(within(sessions).getByRole("link", { name: /^Yesterday, .*, at least 30 min\. No logout recorded/ })).toBeTruthy();
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
    kinds: KINDS, shows_messages: false, coreprotect: { status: "available" },
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
    entries: [], next: "cursor-9", searched_to: NOW - 86400, kinds: KINDS, shows_messages: false, coreprotect: { status: "available" },
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

it("never pages an old filter's cursor into a new filter", async () => {
  render(<PlayerProfile uuid={UUID} />);
  const feed = await screen.findByRole("region", { name: "Recent activity" });
  await within(feed).findByRole("button", { name: "Load more" });

  let finish: (value: Awaited<ReturnType<typeof getPlayerActivity>>) => void = () => {};
  vi.mocked(getPlayerActivity).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(within(feed).getByRole("button", { name: "Kills" }));
  // While the filtered first page loads, the old rows and their cursor are gone.
  expect(within(feed).queryByRole("button", { name: "Load more" })).toBeNull();
  expect(within(feed).queryByText("stone")).toBeNull();

  finish({
    entries: [entry("block:9", { kind: "kill", verb: "killed", target: "cow" })], next: null, searched_to: null,
    kinds: KINDS, shows_messages: false, coreprotect: { status: "available" },
  });
  expect(await within(feed).findByText("cow")).toBeTruthy();
  expect(getPlayerActivity).toHaveBeenLastCalledWith(UUID, { before: null, kinds: ["kill"] });
  expect(within(feed).queryByText("stone")).toBeNull();
});

it("keeps rows and the cursor when a later page is unavailable", async () => {
  render(<PlayerProfile uuid={UUID} />);
  const feed = await screen.findByRole("region", { name: "Recent activity" });
  await within(feed).findByText("stone");

  vi.mocked(getPlayerActivity).mockResolvedValueOnce({
    entries: [], next: null, searched_to: null, kinds: KINDS, shows_messages: false, coreprotect: { status: "unavailable", reason: "busy" },
  });
  fireEvent.click(within(feed).getByRole("button", { name: "Load more" }));
  expect(await within(feed).findByText(/CoreProtect is busy/)).toBeTruthy();
  expect(within(feed).getByText("stone")).toBeTruthy();

  vi.mocked(getPlayerActivity).mockResolvedValueOnce({
    entries: [entry("block:0", { verb: "placed", target: "oak_door" })], next: null, searched_to: null,
    kinds: KINDS, shows_messages: false, coreprotect: { status: "available" },
  });
  fireEvent.click(within(feed).getByRole("button", { name: "Try again" }));
  expect(await within(feed).findByText("oak_door")).toBeTruthy();
  expect(getPlayerActivity).toHaveBeenLastCalledWith(UUID, { before: "cursor-1", kinds: undefined });
  expect(within(feed).getByText("stone")).toBeTruthy();
  expect(within(feed).queryByText(/CoreProtect is busy/)).toBeNull();
});

it("retries a failed sessions page from the same cursor", async () => {
  vi.mocked(getPlayerSessions)
    .mockResolvedValueOnce({
      sessions: [{ start: { time: NOW - 7200, world: "TFMC_Map", x: 0, y: 64, z: 0 }, end: null, end_kind: "unknown",
                   duration_seconds: null, id: "s3",
                   last_observed: { time: NOW - 7200, world: "TFMC_Map", x: 0, y: 64, z: 0 } }],
      next: "s-1", history_start: NOW - 864000, coreprotect: { status: "available" },
    })
    .mockRejectedValueOnce(new AccountApiError("bad_cursor", 400))
    .mockResolvedValueOnce({ sessions: [], next: null, coreprotect: { status: "available" } });
  render(<PlayerProfile uuid={UUID} />);
  const sessions = await screen.findByRole("region", { name: "Sessions" });
  fireEvent.click(await within(sessions).findByRole("button", { name: "Load more sessions" }));
  expect(await within(sessions).findByText("That page link has expired. Reload to start again.")).toBeTruthy();
  expect(within(sessions).getByText("End unknown")).toBeTruthy();
  expect(within(sessions).queryByText(/Retained session records/)).toBeNull();
  fireEvent.click(within(sessions).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(getPlayerSessions).toHaveBeenLastCalledWith(UUID, "s-1"));
});

it("shows chat and whole commands to admins, and says views are logged", async () => {
  vi.mocked(getPlayerActivity).mockResolvedValue({
    entries: [
      entry("chat:1", { kind: "chat", verb: "said", target: null, message: "meet at the docks" }),
      entry("command:2", { kind: "command", verb: "ran", target: "/msg Bob hello", truncated: true }),
    ],
    next: null, searched_to: null, kinds: [...KINDS, "chat"], shows_messages: true, coreprotect: { status: "available" },
  });
  render(<PlayerProfile uuid={UUID} />);
  const feed = await screen.findByRole("region", { name: "Recent activity" });
  expect(await within(feed).findByText("meet at the docks")).toBeTruthy();
  expect(within(feed).getByText("/msg Bob hello")).toBeTruthy();
  expect(within(feed).getByText("(cut short)")).toBeTruthy();
  expect(within(feed).getByRole("button", { name: "Chat" })).toBeTruthy();
  expect(within(feed).getByText(/Your views of these are logged/)).toBeTruthy();
});

it("keeps moderators' note when messages are not included", async () => {
  render(<PlayerProfile uuid={UUID} />);
  const feed = await screen.findByRole("region", { name: "Recent activity" });
  expect(await within(feed).findByText(/Chat, command arguments and sign text are not shown/)).toBeTruthy();
  expect(within(feed).queryByRole("button", { name: "Chat" })).toBeNull();
});

it("never offers Chat before the server allows it", async () => {
  vi.mocked(getPlayerActivity).mockReturnValue(new Promise(() => {}));
  render(<PlayerProfile uuid={UUID} />);
  const feed = await screen.findByRole("region", { name: "Recent activity" });
  expect(within(feed).getByRole("button", { name: "Kills" })).toBeTruthy();
  expect(within(feed).queryByRole("button", { name: "Chat" })).toBeNull();
});

it("shows the Discord handle and the server nickname", async () => {
  render(<PlayerProfile uuid={UUID} />);
  await screen.findByText("@hazelstone");
  expect(screen.getByText("Server nickname")).toBeTruthy();
  expect(screen.getByText("Hazel | Enzo")).toBeTruthy();
});
