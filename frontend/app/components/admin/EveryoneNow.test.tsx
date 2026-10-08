/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import EveryoneMovement from "./EveryoneMovement";
import { NOW_REFRESH_MS } from "./EveryoneNow";
import { getLatestMovement } from "../../../lib/admin/movement";

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
    usePathname: () => "/admin/movement",
  };
});
vi.mock("../../../lib/admin/urlState", () => ({ writeUrl: (url: string) => nav.go(url) }));
vi.mock("../../../lib/admin/movement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/admin/movement")>()),
  getLatestMovement: vi.fn(),
  getEveryoneMovement: vi.fn(() => new Promise(() => {})),
}));
vi.mock("./MovementMap", () => ({
  default: ({ trails, latest, fitKey }: { trails: { label: string }[]; latest?: boolean; fitKey: string | null }) => (
    <div
      data-testid="map"
      data-latest={String(Boolean(latest))}
      data-fit={fitKey ?? ""}
      data-players={trails.map((t) => t.label).join(",")}
    />
  ),
}));
vi.mock("./MovementControls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./MovementControls")>()),
  useLiveMapId: () => "main",
}));

const T = Date.UTC(2026, 9, 6, 13, 0) / 1000;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(T * 1000);
  nav.state.params = new URLSearchParams();
  vi.mocked(getLatestMovement).mockResolvedValue({
    since: T - 150,
    until: T,
    as_of: T,
    worlds: ["TFMC_Map", "TFMC_Map_nether"],
    players: [
      { uuid: A, minecraft_name: "Alice", points: [[T - 100, 0, 10, 64, 20, 2], [T - 40, 0, 11, 64, 21, 2]] },
      { uuid: B, minecraft_name: "Bob", points: [[T - 90, 1, 5, 64, 5, 2]] },
      { uuid: C, minecraft_name: "Carol", points: [[T - 120, 0, 0, 64, 0, 2], [T - 20, 0, 0, 64, 0, 0]] },
    ],
    complete_from: T - 150,
    pings_since: T - 86400,
    coreprotect: { status: "available", server_label: "Vardera", ping_seconds: 60, map_world: "TFMC_Map" },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("opens on where everyone online is now, and refreshes", async () => {
  render(<EveryoneMovement />);
  await screen.findByText(/2 players seen recently · updated 14:00:00/);
  expect(getLatestMovement).toHaveBeenCalledWith(T - 150);
  // Carol logged out: not listed. Bob is in the Nether: listed, not on the map's world.
  expect(screen.getByText("11, 21 · 40 s ago")).toBeTruthy();
  expect(screen.getByText("the Nether · 1 min ago")).toBeTruthy();
  expect(screen.queryByText("Carol")).toBeNull();
  expect(screen.getByText(/1 in another world/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Alice" }).getAttribute("href")).toBe(`/admin/players/${A}/movement`);
  const map = screen.getByTestId("map");
  expect(map.dataset.latest).toBe("true");
  expect(map.dataset.fit).toBe("now");
  expect(map.dataset.players).toBe("Alice,Bob");

  await act(async () => {
    vi.advanceTimersByTime(NOW_REFRESH_MS);
  });
  expect(getLatestMovement).toHaveBeenCalledTimes(2);
});

it("keeps the last positions when a refresh fails", async () => {
  render(<EveryoneMovement />);
  await screen.findByText(/2 players seen recently/);
  vi.mocked(getLatestMovement).mockRejectedValueOnce(new Error("boom"));
  await act(async () => {
    vi.advanceTimersByTime(NOW_REFRESH_MS);
  });
  expect((await screen.findByRole("alert")).textContent).toContain("Showing positions from 14:00:00");
  expect(screen.getByText("Alice")).toBeTruthy();
});

it("switches between now and a time range", async () => {
  render(<EveryoneMovement />);
  await screen.findByText(/2 players seen recently/);
  fireEvent.click(screen.getByRole("button", { name: "Time range" }));
  expect(nav.state.params.get("view")).toBe("range");
  expect(screen.getByRole("button", { name: "Time range" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Now" }));
  expect(nav.state.params.toString()).toBe("");
});

it("ignores an answer that arrives after a newer one", async () => {
  render(<EveryoneMovement />);
  await screen.findByText(/2 players seen recently/);
  let answerSlow: (value: Awaited<ReturnType<typeof getLatestMovement>>) => void = () => {};
  const first = await vi.mocked(getLatestMovement).mock.results[0].value;
  vi.mocked(getLatestMovement)
    .mockImplementationOnce(() => new Promise((resolve) => (answerSlow = resolve)))
    .mockResolvedValueOnce({ ...first, as_of: T + 30 });
  await act(async () => {
    vi.advanceTimersByTime(NOW_REFRESH_MS);
  });
  // Back on the tab while the slow request is still out.
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await screen.findByText(/updated 14:00:30/);
  await act(async () => {
    answerSlow({ ...first, as_of: T + 20 });
  });
  expect(screen.getByText(/updated 14:00:30/)).toBeTruthy();
});
