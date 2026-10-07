/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import RailMap from "./RailMap";
import type { RailNetwork } from "../../../lib/admin/rail";

const view = vi.hoisted(() => ({
  focused: [] as { x: number; y: number; w: number; h: number }[],
  // The real hook hands back the same manifest until it changes.
  manifest: { width: 6400, height: 6400 },
}));

vi.mock("../map/MapViewport", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../map/TileLayer", () => ({ default: () => null }));
vi.mock("@/lib/map/api", () => ({ mapApiUrl: (path: string) => path }));
vi.mock("../../hooks/useTileManifest", () => ({
  useTileManifest: () => ({ manifest: view.manifest, refresh: () => {} }),
  tileUrl: () => "",
}));
vi.mock("../../hooks/useMapViewport", () => ({
  useMapViewport: () => ({
    displayScale: 1,
    translateX: 0,
    translateY: 0,
    viewportSize: { w: 800, h: 600 },
    focusMapRect: (rect: { x: number; y: number; w: number; h: number }) => view.focused.push(rect),
    resetViewport: () => {},
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
  updated_at: null,
  unreadable_files: 0,
  lines: [{ id: 0, name: "West – East", length: 400, tracks: ["main"] }],
  tracks: [
    {
      id: "main",
      line: 0,
      length: 400,
      loop: false,
      points: [[1000, 1000], [1400, 1000]],
      broken: [{ from: 100, to: 110, points: [[1100, 1000], [1110, 1000]] }],
      damaged: [],
    },
  ],
  junctions: [],
  stops: [
    { name: "West", kind: "faction_capital", faction_id: "a", settlement: [1000, 1005], track: "main", line: 0,
      along: 0, at: [1000, 1000], distance: 5 },
    { name: "East", kind: "settlement", faction_id: "b", settlement: [1400, 1200], track: "main", line: 0,
      along: 400, at: [1400, 1000], distance: 200 },
  ],
};

it("draws the network, names its stops and frames it once", () => {
  const { container, rerender } = render(<RailMap mapId="main" network={network} />);
  expect(screen.getByText("West")).toBeTruthy();
  expect(screen.getByText("East")).toBeTruthy();
  // A far settlement is drawn and joined to its stop; a near one is not.
  expect(container.querySelectorAll("rect[transform^='rotate(45']")).toHaveLength(1);
  expect(container.querySelector("title")?.textContent).toBe("West – East: 400 blocks");
  expect([...container.querySelectorAll("title")].some((t) => t.textContent?.startsWith("Broken: 10 blocks"))).toBe(
    true
  );
  expect(view.focused).toEqual([{ x: 1000, y: 940, w: 400, h: 120 }]);
  rerender(<RailMap mapId="main" network={network} highlight={0} />);
  expect(view.focused).toHaveLength(1);
  rerender(
    <RailMap mapId="main" network={network} focus={{ key: "stop:East", bounds: { x: 1, y: 2, w: 3, h: 4 } }} />
  );
  expect(view.focused).toEqual([
    { x: 1000, y: 940, w: 400, h: 120 },
    { x: 1, y: 2, w: 3, h: 4 },
  ]);
});
