/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RankPlayer from "./RankPlayer";
import { AccountApiError } from "../../../../lib/account/api";
import { getLpPlayer, submitLpChange, waitForChange, type LpChange, type LpPlayer } from "../../../../lib/admin/luckperms";

vi.mock("../../../../lib/admin/luckperms", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../lib/admin/luckperms")>(),
  getLpPlayer: vi.fn(),
  waitForChange: vi.fn(),
  submitLpChange: vi.fn(),
}));

const UUID = "22222222-2222-2222-2222-222222222222";

function player(overrides: Partial<LpPlayer["rights"]> = {}): LpPlayer {
  return {
    status: { server: "main", snapshot_at: "2026-10-07T12:00:00Z", checked_at: new Date().toISOString(), has_snapshot: true, applying: true, polled_at: null },
    player: {
      uuid: UUID,
      name: "Bob",
      rank: "helper_player",
      rank_prefix: "&dHelper",
      inherits: ["helper_player", "commoner", "default"],
      nodes: [
        { key: "group.helper_player", value: true, contexts: {}, expiry: 0, kind: "group", group: "helper_player", editable: true },
        { key: "professions.chef_1", value: true, contexts: { server: ["main"] }, expiry: 0, kind: "permission", group: null, editable: true },
        { key: "essentials.fly", value: true, contexts: {}, expiry: 0, kind: "permission", group: null, editable: false },
      ],
      tracks: [
        { name: "helper", groups: ["helper_player", "helper_inactive", "helper"], position: 0, ambiguous: false, can_promote: true, can_demote: true },
        { name: "staff", groups: ["staff_player", "staff_inactive", "staff"], position: null, ambiguous: false, can_promote: false, can_demote: false },
      ],
      account: { discord_user_id: "1", discord_username: "bobby", user_id: 4, role: "player" },
    },
    groups: [
      { name: "staff", weight: 200, min_role: "root", patreon: false, addable: false },
      { name: "noble", weight: 20, min_role: "admin", patreon: true, addable: true },
    ],
    rights: { read_only: false, change_players: true, edit_definitions: false, change_this_player: true, admin_permissions: ["professions.*"], ...overrides },
    changes: [],
    pending: null,
  };
}

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_URL", "https://www.tfminecraft.net/api"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("shows rank, tracks, groups and permissions, with actions only where allowed", async () => {
  vi.mocked(getLpPlayer).mockResolvedValue(player());
  render(<RankPlayer uuid={UUID} />);
  expect(await screen.findByText("Helper")).toBeTruthy();
  const tracks = screen.getByRole("region", { name: "Tracks" });
  const helper = within(tracks).getByText("helper_player", { selector: "[aria-current]" });
  expect(helper).toBeTruthy();
  expect(within(tracks).getAllByRole("button", { name: "Promote" })).toHaveLength(1);
  const permissions = screen.getByRole("region", { name: "Permissions" });
  expect(within(permissions).getByText("server=main")).toBeTruthy();
  // The essentials node is root-only, so it has no Remove button.
  expect(within(permissions).getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  expect(within(permissions).getByText(/Admins may set professions\.\*/)).toBeTruthy();
});

it("promotes along a track and refreshes once applied", async () => {
  vi.mocked(getLpPlayer).mockResolvedValue(player());
  const queued = { id: 3, status: "pending", description: "promote helper" } as LpChange;
  vi.mocked(submitLpChange).mockResolvedValue(queued);
  vi.mocked(waitForChange).mockResolvedValue({ ...queued, status: "applied" });
  render(<RankPlayer uuid={UUID} />);
  fireEvent.click(await screen.findByRole("button", { name: "Promote" }));
  expect(screen.getByText(/to helper_inactive/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Reason (recorded)"), { target: { value: "Passed helper training" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Promote" }).at(-1)!);
  await vi.waitFor(() => expect(getLpPlayer).toHaveBeenCalledTimes(2));
  expect(submitLpChange).toHaveBeenCalledWith("user", UUID, [{ op: "promote", track: "helper" }], "Passed helper training");
});

it("warns about Patreon groups and explains refusals", async () => {
  vi.mocked(getLpPlayer).mockResolvedValue(player());
  vi.mocked(submitLpChange).mockRejectedValue(new AccountApiError("bridge_offline", 503));
  render(<RankPlayer uuid={UUID} />);
  const groups = await screen.findByRole("region", { name: "Groups" });
  fireEvent.change(within(groups).getByLabelText("Add to group"), { target: { value: "noble" } });
  fireEvent.click(within(groups).getByRole("button", { name: "Add" }));
  expect(within(groups).getByText(/Patreon-managed/)).toBeTruthy();
  fireEvent.change(within(groups).getByLabelText("Reason (recorded)"), { target: { value: "Gift" } });
  fireEvent.click(within(groups).getAllByRole("button", { name: "Add" }).at(-1)!);
  expect(await within(groups).findByText(/No server is applying rank changes/)).toBeTruthy();
});

it("is read-only when the viewer may not change this player", async () => {
  vi.mocked(getLpPlayer).mockResolvedValue(player({ change_this_player: false }));
  render(<RankPlayer uuid={UUID} />);
  expect(await screen.findByText(/You can view Bob’s ranks but not change them/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Promote" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
});
