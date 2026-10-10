/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import PlayerFrame, { usePlayer } from "./PlayerFrame";
import { getAdminMe, getPlayer, type PlayerProfile as Profile } from "../../../lib/admin/api";

const UUID = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => `/admin/players/${UUID}/movement`,
}));
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
