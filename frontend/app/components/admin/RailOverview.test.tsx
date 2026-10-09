/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import RailOverview from "./RailOverview";
import { getRailNetwork, type RailNetwork } from "../../../lib/admin/rail";
import { AccountApiError } from "../../../lib/account/api";

process.env.TZ = "Europe/London";

vi.mock("../../../lib/admin/rail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/admin/rail")>()),
  getRailNetwork: vi.fn(),
}));
vi.mock("./RailMap", () => ({
  default: ({ highlight, focus }: { highlight: number | null; focus: { key: string } | null }) => (
    <div data-testid="map" data-highlight={String(highlight)} data-focus={focus?.key ?? ""} />
  ),
  pointFocus: (key: string) => ({ key, bounds: { x: 0, y: 0, w: 1, h: 1 } }),
}));
vi.mock("./RailTubeMap", () => ({
  default: ({ focus }: { focus: { key: string } | null }) => <div data-testid="tube" data-focus={focus?.key ?? ""} />,
  tubeColour: () => "#DC241F",
}));
const nav = vi.hoisted(() => ({ query: "", written: [] as string[] }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/rail",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("../../../lib/admin/urlState", () => ({
  writeUrl: (url: string) => {
    nav.written.push(url);
    nav.query = url.split("?")[1] ?? "";
  },
}));
vi.mock("./MovementControls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./MovementControls")>()),
  useLiveMapId: () => "main",
}));

afterEach(() => {
  cleanup();
  nav.query = "";
  nav.written = [];
  vi.mocked(getRailNetwork).mockReset();
});

const NETWORK: RailNetwork = {
  status: "ok",
  world: "TFMC_Map",
  updated_at: Date.UTC(2026, 9, 7, 19, 30) / 1000,
  unreadable_files: 0,
  lines: [
    { id: 0, name: "Thalenthyr – Drammen", length: 5313, tracks: ["main"] },
    { id: 1, name: "Unnamed line", length: 25, tracks: ["lone"] },
  ],
  tracks: [
    {
      id: "main",
      line: 0,
      length: 5313,
      loop: false,
      points: [[0, 0], [100, 0]],
      broken: [{ from: 3274.4, to: 3296.5, points: [[4526, 2336], [4515, 2316]] }],
      damaged: [],
    },
    { id: "lone", line: 1, length: 25, loop: false, points: [[5, 5], [30, 5]], broken: [], damaged: [] },
  ],
  junctions: [],
  stops: [
    { name: "Thalenthyr", kind: "faction_capital", faction_id: "f", settlement: [0, 40], track: "main", line: 0,
      along: 0, at: [0, 0], distance: 40 },
    { name: "Oyfthyr", kind: "settlement", faction_id: "g", settlement: [50, 99], track: "main", line: 0,
      along: 50, at: [50, 0], distance: 99 },
  ],
};

it("lists breaks, lines and stops, and frames what is picked", async () => {
  vi.mocked(getRailNetwork).mockResolvedValue(NETWORK);
  render(<RailOverview />);
  expect(await screen.findByText("Thalenthyr – Drammen")).toBeTruthy();
  expect(getRailNetwork).toHaveBeenCalledWith("main");
  expect(screen.getByText(/Updated Wed 7 Oct 2026, 20:30/)).toBeTruthy();
  expect(screen.getByText("Broken: 22 blocks")).toBeTruthy();
  expect(screen.getByText("capital · 0, 0")).toBeTruthy();
  expect(screen.getByText("Unnamed line")).toBeTruthy();

  fireEvent.click(screen.getByText("Broken: 22 blocks"));
  expect(screen.getByTestId("map").dataset.focus).toMatch(/^problem:0:/);
  fireEvent.click(screen.getByText("Oyfthyr"));
  expect(screen.getByTestId("map").dataset.focus).toMatch(/^stop:Oyfthyr:/);
  fireEvent.mouseEnter(screen.getByRole("region", { name: "Thalenthyr – Drammen" }));
  expect(screen.getByTestId("map").dataset.highlight).toBe("0");
});

it("switches to the tube map and back through the URL", async () => {
  vi.mocked(getRailNetwork).mockResolvedValue(NETWORK);
  const { rerender } = render(<RailOverview />);
  expect(await screen.findByTestId("map")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Map" }).getAttribute("aria-selected")).toBe("true");

  fireEvent.click(screen.getByRole("tab", { name: "Tube map" }));
  expect(nav.written).toEqual(["/admin/rail?view=tube"]);
  rerender(<RailOverview />);
  expect(screen.getByTestId("tube")).toBeTruthy();
  expect(screen.queryByTestId("map")).toBeNull();
  fireEvent.click(screen.getByText("Oyfthyr"));
  expect(screen.getByTestId("tube").dataset.focus).toMatch(/^stop:Oyfthyr:/);

  fireEvent.click(screen.getByRole("tab", { name: "Map" }));
  expect(nav.written.at(-1)).toBe("/admin/rail");
});

it("says when nothing needs repair", async () => {
  vi.mocked(getRailNetwork).mockResolvedValue({
    ...NETWORK,
    tracks: NETWORK.tracks.map((t) => ({ ...t, broken: [] })),
  });
  render(<RailOverview />);
  expect(await screen.findByText("No broken or damaged track.")).toBeTruthy();
});

it("explains a site that cannot read the tracks", async () => {
  vi.mocked(getRailNetwork).mockResolvedValue({ ...NETWORK, status: "not_configured", lines: [], tracks: [], stops: [] });
  render(<RailOverview />);
  expect(await screen.findByText("Rail data isn’t available on this site.")).toBeTruthy();
  expect(screen.queryByTestId("map")).toBeNull();
});

it("tells mods the map is for admins", async () => {
  vi.mocked(getRailNetwork).mockRejectedValue(new AccountApiError("forbidden", 403));
  render(<RailOverview />);
  expect(await screen.findByText("The rail map is for admins and the owner only.")).toBeTruthy();
});
