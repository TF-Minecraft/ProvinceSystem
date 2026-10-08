/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import MovementMap, { type MovementTrail } from "./MovementMap";

const view = vi.hoisted(() => ({ scale: 1, focus: vi.fn() }));

vi.mock("../map/MapViewport", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../map/TileLayer", () => ({ default: () => null }));
vi.mock("@/lib/map/api", () => ({ mapApiUrl: (path: string) => path }));
vi.mock("../../hooks/useTileManifest", () => ({
  useTileManifest: () => ({ manifest: null, refresh: () => {} }),
  tileUrl: () => "",
}));
vi.mock("../../hooks/useMapViewport", () => ({
  useMapViewport: () => ({
    displayScale: view.scale,
    translateX: 0,
    translateY: 0,
    viewportSize: { w: 800, h: 600 },
    focusMapRect: view.focus,
    resetViewport: () => {},
    zoomBy: () => {},
    consumeDragClick: () => false,
  }),
}));

afterEach(cleanup);

// Twenty players on top of one another: at a small scale only some names fit; zoomed in, all of them do.
const trails: MovementTrail[] = Array.from({ length: 20 }, (_, i) => ({
  key: `p${i}`,
  label: `Player${String(i).padStart(2, "0")}`,
  colour: "#fff",
  stretches: [
    { world: "TFMC_Map", samples: [{ time: 100, x: 1000 + (i % 5), y: 64, z: 1000 + Math.floor(i / 5), action: 2 }] },
  ],
}));

const map = (fitKey = "now") => (
  <MovementMap
    mapId="main"
    mapWorld="TFMC_Map"
    trails={trails}
    since={0}
    until={100}
    cursor={100}
    hold={150}
    fitKey={fitKey}
    latest
  />
);
const names = () => screen.queryAllByText(/^Player\d\d$/).map((el) => el.textContent);

it("shows a crowded name on tap only while it has no room, and drops the tap once it has", () => {
  view.scale = 1;
  const { rerender } = render(map());
  const hidden = trails.map((t) => t.label).filter((label) => !names().includes(label));
  expect(hidden.length).toBeGreaterThan(0);
  expect(screen.getByText(/names? hidden for room: zoom in or tap a dot/)).toBeTruthy();
  const name = hidden[0];
  const dot = () => screen.getByText(new RegExp(`^${name} — `)).parentElement!;

  fireEvent.click(dot());
  expect(names()).toContain(name);

  // Zoomed in, every name has room: the tap lapses.
  view.scale = 200;
  rerender(map());
  expect(names()).toHaveLength(trails.length);
  // Zoomed back out, the name is hidden again until it is tapped again.
  view.scale = 1;
  rerender(map());
  expect(names()).not.toContain(name);
  fireEvent.click(dot());
  expect(names()).toContain(name);
});

it("jumps to the first framing and animates later ones", () => {
  // Animated from the whole map, the first framing's sharp tiles stayed blurry until the next zoom.
  view.focus.mockClear();
  const { rerender } = render(map("first"));
  expect(view.focus).toHaveBeenCalledTimes(1);
  expect(view.focus.mock.calls[0][3]).toEqual({ animated: false });
  rerender(map("second"));
  expect(view.focus).toHaveBeenCalledTimes(2);
  expect(view.focus.mock.calls[1][3]).toEqual({ animated: true });
});
