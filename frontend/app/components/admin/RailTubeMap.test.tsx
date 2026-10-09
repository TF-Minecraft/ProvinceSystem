/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import RailTubeMap, { wrapName } from "./RailTubeMap";
import type { RailNetwork } from "../../../lib/admin/rail";

process.env.TZ = "Europe/London";

const view = vi.hoisted(() => ({ focused: [] as { x: number; y: number; w: number; h: number }[] }));

vi.mock("../map/MapViewport", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../hooks/useMapViewport", () => ({
  useMapViewport: () => ({
    displayScale: 1,
    viewportSize: { w: 800, h: 600 },
    focusMapRect: (rect: { x: number; y: number; w: number; h: number }) => view.focused.push(rect),
    zoomBy: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  view.focused = [];
});

const network: RailNetwork = {
  status: "ok",
  world: "TFMC_Map",
  updated_at: Date.UTC(2026, 9, 9, 9, 0) / 1000,
  unreadable_files: 0,
  lines: [{ id: 0, name: "West – East", length: 2000, tracks: ["main"] }],
  tracks: [
    {
      id: "main",
      line: 0,
      length: 2000,
      loop: false,
      points: [[0, 0], [1000, 0], [2000, 600]],
      broken: [],
      damaged: [{ from: 400, to: 430, points: [[400, 0], [430, 0]] }],
    },
  ],
  junctions: [],
  stops: [
    { name: "West", kind: "faction_capital", faction_id: "a", settlement: [0, 5], track: "main", line: 0,
      along: 0, at: [0, 0], distance: 5 },
    { name: "Research Tower of the Castle", kind: "settlement", faction_id: "b", settlement: [1000, 10],
      track: "main", line: 0, along: 1000, at: [1000, 0], distance: 10 },
  ],
};

it("draws the lines, names the stops and frames the network", () => {
  const { container } = render(<RailTubeMap network={network} />);
  expect(screen.getByRole("img", { name: "Rail network as an Underground map" })).toBeTruthy();
  expect(container.querySelector('path[stroke="#DC241F"]')).toBeTruthy();
  expect(screen.getByText("West")).toBeTruthy();
  // The long name on two lines.
  expect(screen.getByText("Research Tower")).toBeTruthy();
  expect(screen.getByText("of the Castle")).toBeTruthy();
  expect([...container.querySelectorAll("title")].map((t) => t.textContent)).toContain("Damaged track");
  expect(view.focused).toHaveLength(1);
});

it("folds the key away and opens it again", () => {
  // jsdom's window is 1,024 pixels wide: room for the key.
  render(<RailTubeMap network={network} />);
  const toggle = screen.getByRole("button", { name: /Key to lines/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("West – East")).toBeTruthy();
  expect(screen.getByText("Correct at Fri 9 Oct 2026, 10:00")).toBeTruthy();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("West – East")).toBeNull();
});

it("frames a stop picked from the list", () => {
  const { rerender } = render(<RailTubeMap network={network} />);
  rerender(<RailTubeMap network={network} focus={{ key: "stop:West", bounds: { x: -60, y: -60, w: 120, h: 120 } }} />);
  expect(view.focused).toHaveLength(2);
});

it("splits a long name near its middle", () => {
  expect(wrapName("Skyreach")).toEqual(["Skyreach"]);
  expect(wrapName("Research Tower of the Castle")).toEqual(["Research Tower", "of the Castle"]);
});
