/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import ServersOverview from "./ServersOverview";
import { AccountApiError } from "../../../lib/account/api";
import { getServers, type PluginCopy, type ServersOverview as Overview } from "../../../lib/admin/servers";

vi.mock("../../../lib/admin/servers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/admin/servers")>()),
  getServers: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.mocked(getServers).mockReset();
});

const copy = (over: Partial<PluginCopy> = {}): PluginCopy => ({
  state: "latest",
  files: ["x.jar"],
  version: "1.0.0",
  release: "1.0.0",
  loaded: "1.0.0",
  loaded_state: "same",
  update: false,
  duplicate: false,
  ...over,
});

const latest = (version: string) => ({
  version,
  published_at: "2026-10-01T00:00:00Z",
  url: "https://github.com/x",
});

const overview: Overview = {
  checked_at: "2026-10-11T18:00:00Z",
  github: {
    status: "available",
    checked_at: "2026-10-11T18:00:00Z",
    stale: false,
  },
  servers: [
    {
      key: "main",
      label: "Main",
      releases_only: true,
      status: "available",
      paper: "1.21.10-130-ver/x",
      started: true,
      log: "latest.log",
    },
    {
      key: "dev",
      label: "Dev",
      releases_only: false,
      status: "available",
      paper: "1.21.10-130-ver/x",
      started: true,
      log: "latest.log",
    },
  ],
  plugins: [
    {
      repo: "Archaeo",
      latest: latest("2.0.7"),
      servers: {
        main: copy({ version: "2.0.7", loaded: "2.0.7" }),
        dev: copy({
          state: "test_build",
          version: "main-SNAPSHOT",
          loaded: "main-SNAPSHOT",
          files: ["archaeo-main-SNAPSHOT.jar"],
        }),
      },
    },
    {
      repo: "Cooking",
      latest: latest("0.3.23"),
      servers: {
        main: copy({
          version: "0.3.23",
          loaded: "0.3.22",
          loaded_state: "different",
        }),
        dev: copy(),
      },
    },
    {
      repo: "Magic",
      latest: latest("0.4.17"),
      servers: { main: copy(), dev: copy() },
    },
    {
      repo: "TLibs",
      latest: latest("2.2.0"),
      servers: {
        main: copy({
          state: "not_release",
          version: "main-SNAPSHOT",
          loaded: "main-SNAPSHOT",
          files: ["tlibs-2.2.0.jar"],
        }),
        dev: copy(),
      },
    },
  ],
  others: [
    {
      name: "Bookshelf",
      differs: true,
      servers: {
        main: { file: "a.jar", version: "2026.1" },
        dev: { file: "b.jar", version: "3.1" },
      },
    },
  ],
};

it("lists what needs a look, worst first, and counts each server", async () => {
  vi.mocked(getServers).mockResolvedValue(overview);
  render(<ServersOverview />);
  const rows = await screen.findAllByRole("listitem");
  const names = rows.map((row) => row.querySelector("p.font-semibold")?.textContent).filter(Boolean);
  expect(names).toEqual(["TLibs", "Cooking", "Archaeo"]);
  expect(screen.getByRole("button", { name: "Needs a look · 3" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("Not a release")).toBeTruthy();
  expect(screen.getByText("Needs restart")).toBeTruthy();
  expect(screen.getByText("Test build")).toBeTruthy();
  expect(screen.getByText("tlibs-2.2.0.jar")).toBeTruthy();
  // Running 0.3.22, 0.3.23 on disk.
  expect(screen.getByText("→ 0.3.23")).toBeTruthy();
  expect(screen.getByText("Not releases").previousElementSibling?.textContent).toBe("1");
  expect(screen.getByText("Test builds").previousElementSibling?.textContent).toBe("1");
});

it("shows every plugin, other plugins, and filters by name", async () => {
  vi.mocked(getServers).mockResolvedValue(overview);
  render(<ServersOverview />);
  fireEvent.click(await screen.findByRole("button", { name: "All TFMC plugins · 4" }));
  expect(screen.getByText("Magic")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Find a plugin"), {
    target: { value: "mag" },
  });
  expect(screen.queryByText("Cooking")).toBeNull();
  fireEvent.change(screen.getByLabelText("Find a plugin"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Other plugins · 1" }));
  const row = screen.getByText("Bookshelf").closest("li")!;
  expect(within(row).getByText("Differs")).toBeTruthy();
  expect(within(row).getByText("2026.1")).toBeTruthy();
});

it("says when a server or GitHub can't be read", async () => {
  vi.mocked(getServers).mockResolvedValue({
    ...overview,
    github: { status: "unavailable", checked_at: null, stale: false },
    servers: [overview.servers[0], { ...overview.servers[1], status: "not_configured" }],
    plugins: [],
    others: [],
  });
  render(<ServersOverview />);
  expect(await screen.findByText("The site isn’t set up to read this server’s files.")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("GitHub didn’t answer");
});

it("shows the staff gate when the role is too low", async () => {
  vi.mocked(getServers).mockRejectedValue(new AccountApiError("forbidden", 403));
  render(<ServersOverview />);
  expect(await screen.findByText("This page is for TFMC staff only.")).toBeTruthy();
});
