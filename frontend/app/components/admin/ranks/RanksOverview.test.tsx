/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RanksOverview from "./RanksOverview";
import RankGroup from "./RankGroup";
import { getLpGroup, getLpPlayers, getLuckPerms, submitLpChange, waitForChange, type LpChange, type LpOverview } from "../../../../lib/admin/luckperms";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../../../lib/admin/luckperms", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../lib/admin/luckperms")>(),
  getLuckPerms: vi.fn(),
  getLpPlayers: vi.fn(),
  getLpGroup: vi.fn(),
  submitLpChange: vi.fn(),
  waitForChange: vi.fn(),
}));

const STATUS = { server: "main", snapshot_at: "2026-10-07T12:00:00Z", checked_at: new Date().toISOString(), has_snapshot: true, applying: true, polled_at: null };

function overview(editDefinitions: boolean): LpOverview {
  return {
    status: STATUS,
    players: 2852,
    groups: [
      { name: "staff", display_name: null, weight: 200, prefix: "&cStaff", suffix: null, parents: ["staff_inactive"], members: 4, permissions: 3, min_role: "root", patreon: false },
      { name: "noble", display_name: null, weight: 20, prefix: "&6Noble", suffix: null, parents: ["commoner"], members: 13, permissions: 0, min_role: "admin", patreon: true },
    ],
    tracks: [{ name: "staff", groups: ["staff_player", "staff_inactive", "staff"] }],
    rights: { read_only: false, change_players: true, edit_definitions: editDefinitions },
    patreon_groups: ["noble"],
    recent: [
      { id: 1, created_at: "2026-10-07T12:00:00Z", actor_name: "rory", actor_role: "root", target_type: "user", target: "u", target_name: "Bob", description: "promote helper", reason: "Trained", status: "applied", finished_at: null, error: null },
    ],
  };
}

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_URL", "https://www.tfminecraft.net/api"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("lists groups, tracks and recent changes, and finds players", async () => {
  vi.mocked(getLuckPerms).mockResolvedValue(overview(false));
  vi.mocked(getLpPlayers).mockResolvedValue({
    total: 1, page: 1, page_size: 50,
    rows: [{ uuid: "u1", name: "Alice", rank: "noble", groups: [{ name: "noble", contexts: { server: ["main"] }, expiry: 0 }] }],
  });
  render(<RanksOverview />);
  const groups = await screen.findByRole("region", { name: "Groups" });
  expect(within(groups).getByText("Owner only")).toBeTruthy();
  expect(within(groups).getByText("Patreon")).toBeTruthy();
  expect(within(groups).queryByRole("button", { name: "New group" })).toBeNull();
  expect(screen.getByRole("region", { name: "Recent changes" }).textContent).toContain("promote helper");
  fireEvent.change(screen.getByLabelText("Minecraft name or UUID"), { target: { value: "ali" } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  expect(await screen.findByRole("link", { name: "Alice" })).toBeTruthy();
  expect(screen.getByText("(server=main)")).toBeTruthy();
});

it("lets root create a group", async () => {
  vi.mocked(getLuckPerms).mockResolvedValue(overview(true));
  vi.mocked(submitLpChange).mockResolvedValue({ id: 2, status: "pending" } as LpChange);
  vi.mocked(waitForChange).mockResolvedValue({ id: 2, status: "applied" } as LpChange);
  render(<RanksOverview />);
  fireEvent.click(await screen.findByRole("button", { name: "New group" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Knight" } });
  fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "60" } });
  fireEvent.change(screen.getByLabelText("Reason (recorded)"), { target: { value: "New rank" } });
  fireEvent.click(screen.getByRole("button", { name: "Create group" }));
  await vi.waitFor(() => expect(getLuckPerms).toHaveBeenCalledTimes(2));
  expect(submitLpChange).toHaveBeenCalledWith("group", "knight", [
    { op: "create_group" },
    { op: "add_node", node: { key: "group.default" } },
    { op: "add_node", node: { key: "weight.60" } },
  ], "New rank");
});

it("edits a group's weight as a remove and an add", async () => {
  vi.mocked(getLpGroup).mockResolvedValue({
    status: STATUS,
    group: {
      ...overview(true).groups[1],
      nodes: [
        { key: "group.commoner", value: true, contexts: {}, expiry: 0, kind: "group", group: "commoner", editable: true },
        { key: "weight.20", value: true, contexts: {}, expiry: 0, kind: "meta", group: null, editable: true },
      ],
      inherits: ["commoner", "default"],
      children: ["gilded"],
      tracks: [],
    },
    members: { total: 0, page: 1, page_size: 50, rows: [] },
    all_groups: ["noble", "commoner", "default"],
    rights: { read_only: false, change_players: true, edit_definitions: true },
    changes: [],
    pending: null,
  });
  vi.mocked(submitLpChange).mockResolvedValue({ id: 4, status: "pending" } as LpChange);
  vi.mocked(waitForChange).mockResolvedValue({ id: 4, status: "applied" } as LpChange);
  render(<RankGroup name="noble" />);
  const settings = await screen.findByRole("region", { name: "Settings" });
  fireEvent.change(within(settings).getByLabelText("Weight"), { target: { value: "25" } });
  fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
  fireEvent.change(within(settings).getByLabelText("Reason (recorded)"), { target: { value: "Reorder ranks" } });
  fireEvent.click(within(settings).getByRole("button", { name: "Save noble" }));
  await vi.waitFor(() => expect(submitLpChange).toHaveBeenCalled());
  expect(vi.mocked(submitLpChange).mock.calls[0].slice(0, 3)).toEqual(["group", "noble", [
    { op: "remove_node", node: { key: "weight.20", value: true, contexts: {}, expiry: 0 } },
    { op: "add_node", node: { key: "weight.25" } },
  ]]);
});
