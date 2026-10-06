/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import EveryoneMovement from "./EveryoneMovement";
import { getEveryoneMovement } from "../../../lib/admin/movement";

process.env.TZ = "Europe/London";

const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { params: new URLSearchParams() };
  const go = (url: string) => {
    state.params = new URLSearchParams(url.split("?")[1] ?? "");
    listeners.forEach((listener) => listener());
  };
  return { listeners, state, go };
});

vi.mock("next/navigation", async () => {
  const { useEffect, useReducer } = await import("react");
  return {
    useSearchParams: () => {
      const [, force] = useReducer((n: number) => n + 1, 0);
      useEffect(() => {
        nav.listeners.add(force);
        return () => {
          nav.listeners.delete(force);
        };
      }, []);
      return nav.state.params;
    },
    usePathname: () => "/admin/players/u/movement",
  };
});
vi.mock("../../../lib/admin/urlState", () => ({ writeUrl: (url: string) => nav.go(url) }));
vi.mock("../../../lib/admin/movement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/admin/movement")>()),
  getEveryoneMovement: vi.fn(),
}));
vi.mock("./MovementMap", () => ({
  default: ({ cursor, fitKey }: { cursor: number; fitKey: string | null }) => (
    <div data-testid="map" data-cursor={cursor} data-fit={fitKey ?? ""} />
  ),
}));
vi.mock("./MovementControls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./MovementControls")>()),
  useLiveMapId: () => "main",
}));

const T = Date.UTC(2026, 9, 6, 13, 0) / 1000;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

beforeEach(() => {
  nav.state.params = new URLSearchParams(`from=${T - 3600}&to=${T}&at=${T - 60}`);
  vi.mocked(getEveryoneMovement).mockResolvedValue({
    since: T - 3600,
    until: T,
    as_of: T,
    worlds: ["TFMC_Map", "TFMC_Map_the_end"],
    players: [
      { uuid: A, minecraft_name: "Alice", points: [[T - 120, 0, 10, 64, 20, 2], [T - 60, 0, 11, 64, 21, 2]] },
      { uuid: B, minecraft_name: "Bob", points: [[T - 150, 1, 5, 64, 5, 2]] },
    ],
    complete_from: T - 3600,
    pings_since: T - 86400,
    coreprotect: { status: "available", server_label: "Vardera", ping_seconds: 60, map_world: "TFMC_Map" },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("compares everyone at the inspected moment and carries the view to a player", async () => {
  render(<EveryoneMovement />);
  await screen.findByText(/2 of 2 players observed or estimated at this moment/);
  expect(getEveryoneMovement).toHaveBeenCalledWith(T - 3600, T);
  expect(screen.getByText("11, 21")).toBeTruthy();
  // Bob's last ping was 90 s before the moment, in the End.
  expect(screen.getByText(/the End · 2 min before/)).toBeTruthy();
  const link = screen.getByRole("link", { name: "Alice" }).getAttribute("href")!;
  expect(link).toContain(`/admin/players/${A}/movement?`);
  expect(link).toContain(`from=${T - 3600}`);
  expect(link).toContain(`at=${T - 60}`);

  fireEvent.click(screen.getByLabelText("Select Bob"));
  expect(nav.state.params.get("players")).toBe(B);
});
