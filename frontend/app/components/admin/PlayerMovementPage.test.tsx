/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import PlayerMovementPage from "./PlayerMovementPage";
import { AccountApiError } from "../../../lib/account/api";
import { getPlayer, getPlayerSessions, type PlayerSession } from "../../../lib/admin/api";
import { getPlayerMovement, getSessionMovement } from "../../../lib/admin/movement";

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
vi.mock("../../../lib/admin/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/admin/api")>()),
  getPlayer: vi.fn(),
  getPlayerSessions: vi.fn(),
}));
vi.mock("../../../lib/admin/movement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/admin/movement")>()),
  getPlayerMovement: vi.fn(),
  getSessionMovement: vi.fn(),
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

const UUID = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8";
// 14:00 London on Tue 6 Oct 2026.
const T = Date.UTC(2026, 9, 6, 13, 0) / 1000;
const status = { status: "available" as const, server_label: "Vardera", ping_seconds: 60, map_world: "TFMC_Map" };
const point = (time: number, x = 0) => ({ time, world: "TFMC_Map", x, y: 64, z: 0 });
const SESSION: PlayerSession = {
  id: "s1",
  start: point(T),
  end: point(T + 600, 30),
  end_kind: "logout",
  duration_seconds: 600,
  last_observed: point(T + 600, 30),
};

beforeEach(() => {
  nav.state.params = new URLSearchParams();
  vi.mocked(getPlayer).mockResolvedValue({ minecraft_name: "MrEnzo99" } as never);
  vi.mocked(getPlayerSessions).mockResolvedValue({ sessions: [SESSION], next: null, coreprotect: { status: "available" } });
  vi.mocked(getSessionMovement).mockResolvedValue({
    session: SESSION,
    since: T,
    until: T + 600,
    worlds: ["TFMC_Map"],
    points: [
      [T, 0, 0, 64, 0, 1],
      [T + 60, 0, 10, 64, 0, 2],
      [T + 120, 0, 20, 64, 0, 2],
      [T + 600, 0, 30, 64, 0, 0],
    ],
    complete_from: T,
    pings_since: T - 86400,
    as_of: T + 3600,
    coreprotect: status,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens the newest session and inspects where it ended", async () => {
  render(<PlayerMovementPage uuid={UUID} />);
  await screen.findByText(/Inspecting 14:10:00 · recorded at 30, 64, 0/);
  expect(nav.state.params.get("session")).toBe("s1");
  expect(getSessionMovement).toHaveBeenCalledWith(UUID, "s1");
  expect(screen.getAllByText("Logged out 14:10").length).toBeGreaterThan(0);
  expect(screen.getByTestId("map").dataset.fit).toBe("session:s1");
  expect(screen.getByRole("button", { name: "Copy teleport command" })).toBeTruthy();
});

it("steps between observations and explains estimates", async () => {
  render(<PlayerMovementPage uuid={UUID} />);
  await screen.findByText(/recorded at 30, 64, 0/);
  fireEvent.click(screen.getByRole("button", { name: "‹ Previous observation" }));
  await screen.findByText(/Inspecting 14:02:00 · recorded at 20, 64, 0/);
  act(() => nav.go(`/x?session=s1&at=${T + 90}`));
  await screen.findByText(/estimated between observations at 14:01:00 and 14:02:00: near 15, 0/);
  // Between 14:02 and logout at 14:10 nothing was recorded for longer than a ping gap.
  act(() => nav.go(`/x?session=s1&at=${T + 400}`));
  await screen.findByText(/not observed \(offline, or not recorded\); last observation 14:02:00/);
});

it("applies a typed range and refuses times the clocks skip", async () => {
  vi.mocked(getPlayerMovement).mockResolvedValue({
    since: T - 3600, until: T, worlds: [], points: [], complete_from: T - 3600, pings_since: null, as_of: T,
    coreprotect: status,
  });
  render(<PlayerMovementPage uuid={UUID} />);
  await screen.findByText(/recorded at 30/);
  fireEvent.click(screen.getByRole("tab", { name: "Time range" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-29T01:30" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply range" }));
  expect(screen.getByRole("alert").textContent).toMatch(/clocks went forward/);

  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-06T13:00" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-06T14:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply range" }));
  await waitFor(() => expect(getPlayerMovement).toHaveBeenCalledWith(UUID, T - 3600, T));
  expect(nav.state.params.get("session")).toBeNull();
  await screen.findByText(/No observations between Tue 6 Oct 2026, 13:00 → 14:00/);
});

it("tells non-admins the page is not for them", async () => {
  vi.mocked(getSessionMovement).mockRejectedValue(new AccountApiError("forbidden", 403));
  render(<PlayerMovementPage uuid={UUID} />);
  await screen.findByText("Movement is for admins and the owner only.");
});

it("frames a new session only once its own answer is in", async () => {
  render(<PlayerMovementPage uuid={UUID} />);
  await screen.findByText(/recorded at 30, 64, 0/);
  expect(screen.getByTestId("map").dataset.fit).toBe("session:s1");
  let answer: (value: unknown) => void = () => undefined;
  vi.mocked(getSessionMovement).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)) as never);
  act(() => nav.go("/x?session=s2"));
  // Still showing s1's answer: the map must not take s2's key against s1's trail.
  expect(screen.getByTestId("map").dataset.fit).toBe("");
  await act(async () =>
    answer({
      session: { ...SESSION, id: "s2" }, since: T, until: T + 600, worlds: ["TFMC_Map"],
      points: [[T, 0, 500, 64, 0, 1]], complete_from: T, pings_since: null, as_of: T, coreprotect: status,
    })
  );
  await waitFor(() => expect(screen.getByTestId("map").dataset.fit).toBe("session:s2"));
});
