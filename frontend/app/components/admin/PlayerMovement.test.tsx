/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import PlayerMovement from "./PlayerMovement";
import { getPlayerMovement, type PlayerMovement as Movement } from "../../../lib/admin/movement";

vi.mock("../../../lib/admin/movement", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/admin/movement")>(),
  getPlayerMovement: vi.fn(),
}));
vi.mock("./MovementMap", () => ({
  default: ({ trails, cursor }: { trails: { stretches: unknown[] }[]; cursor: number }) => (
    <div data-testid="map" data-stretches={trails[0].stretches.length} data-cursor={cursor} />
  ),
}));
vi.mock("./MovementControls", async (importOriginal) => ({
  ...await importOriginal<typeof import("./MovementControls")>(),
  useLiveMapId: () => "main",
}));

const UUID = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8";
const NOW = 2_000_000_040;

function answer(extra: Partial<Movement> = {}): Movement {
  return {
    since: NOW - 3600, until: NOW,
    worlds: ["TFMC_Map", "TFMC_Map_the_end"],
    points: [
      [NOW - 600, 0, 100, 64, 100, 1],
      [NOW - 540, 0, 160, 64, 100, 2],
      [NOW - 480, 0, 160, 64, 160, 2],
      [NOW - 420, 1, 0, 64, 0, 2],
      [NOW - 360, 1, 10, 64, 0, 2],
    ],
    complete_from: NOW - 3600, pings_since: NOW - 86400,
    coreprotect: { status: "available", server_label: "Vardera", ping_seconds: 60, map_world: "TFMC_Map" },
    ...extra,
  };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  vi.mocked(getPlayerMovement).mockResolvedValue(answer());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("asks for the last hour and summarises it", async () => {
  render(<PlayerMovement uuid={UUID} name="MrEnzo99" />);
  await screen.findByText(/Seen for about 3 min in this window, about 130 blocks/);
  expect(getPlayerMovement).toHaveBeenCalledWith(UUID, NOW - 3600, NOW);
  expect(screen.getByText(/1 min in the End/)).toBeTruthy();
  // The newest moment: they were last seen six minutes ago.
  expect(screen.getByText(/Not seen at that moment/)).toBeTruthy();
  expect(screen.getByTestId("map").dataset.stretches).toBe("2");
});

it("asks again for another window and places the marker from the slider", async () => {
  render(<PlayerMovement uuid={UUID} name="MrEnzo99" />);
  await screen.findByText(/Seen for/);
  fireEvent.click(screen.getByRole("button", { name: "24 h" }));
  await waitFor(() => expect(getPlayerMovement).toHaveBeenLastCalledWith(UUID, NOW - 86400, NOW));

  fireEvent.change(screen.getByLabelText("Moment shown on the map"), { target: { value: String(NOW - 510) } });
  expect(screen.getByText(/Between pings, near 160, 130/)).toBeTruthy();
});

it("keeps a fixed window while the ending box is half edited", async () => {
  render(<PlayerMovement uuid={UUID} name="MrEnzo99" />);
  await screen.findByText(/Seen for/);
  const box = screen.getByLabelText("ending");
  fireEvent.change(box, { target: { value: "2033-05-18T03:00" } });
  const end = Math.floor(new Date("2033-05-18T03:00").getTime() / 1000);
  await waitFor(() => expect(getPlayerMovement).toHaveBeenLastCalledWith(UUID, end - 3600, end));
  const calls = vi.mocked(getPlayerMovement).mock.calls.length;
  // A browser reports an empty value partway through an edit.
  fireEvent.change(box, { target: { value: "" } });
  await new Promise((r) => setTimeout(r, 20));
  expect(vi.mocked(getPlayerMovement).mock.calls.length).toBe(calls);
  expect(screen.getByRole("button", { name: "Now" }).getAttribute("aria-pressed")).toBe("false");
});

it("says when the window is cut short or pings began later", async () => {
  vi.mocked(getPlayerMovement).mockResolvedValue(answer({ complete_from: NOW - 1800, pings_since: NOW - 60, points: [] }));
  render(<PlayerMovement uuid={UUID} name="MrEnzo99" />);
  await screen.findByText(/No positions logged in this window/);
  expect(screen.getByText(/too many points to show, so it starts at/)).toBeTruthy();
  expect(screen.getByText(/only since/)).toBeTruthy();
});
