/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import ServersOverview from "./ServersOverview";
import * as ServerControls from "./ServerControls";
import { AccountApiError } from "../../../lib/account/api";
import {
  getServers,
  type PluginCopy,
  type ServerPlugin,
  type ServersOverview as Overview,
} from "../../../lib/admin/servers";

vi.mock("../../../lib/admin/servers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/admin/servers")>()),
  getServers: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

const latest = (version: string, branch: NonNullable<ServerPlugin["latest"]>["branch"] = null) => ({
  version,
  published_at: "2026-10-01T00:00:00Z",
  url: "https://github.com/x",
  branch,
});

const overview: Overview = {
  checked_at: "2026-10-11T18:00:00Z",
  github: {
    status: "available",
    checked_at: "2026-10-11T18:00:00Z",
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
      latest: latest("2.0.7", { name: "main", status: "ahead", ahead: 3, url: "https://github.com/compare/a" }),
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
      latest: latest("0.3.23", { name: "main", status: "identical", ahead: 0, url: "https://github.com/compare/c" }),
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
  expect(screen.getByRole("button", { name: "Needs a look, 3" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("Not a release")).toBeTruthy();
  expect(screen.getByText("Needs restart")).toBeTruthy();
  expect(screen.getByText("Test build")).toBeTruthy();
  expect(screen.getByText("Not a release").parentElement?.getAttribute("title")).toBe("tlibs-2.2.0.jar");
  // Running 0.3.22, 0.3.23 on disk.
  expect(screen.getByText("→ 0.3.23")).toBeTruthy();
  expect(screen.getByText("Not releases").previousElementSibling?.textContent).toBe("1");
  expect(screen.getByText("Test builds").previousElementSibling?.textContent).toBe("1");
  // Archaeo's main has moved on since 2.0.7; Cooking's release is main.
  const ahead = screen.getByText("main +3");
  expect(ahead.getAttribute("href")).toBe("https://github.com/compare/a");
  expect(ahead.getAttribute("title")).toBe("main has 3 commits since this release");
  expect(screen.getByText("= main")).toBeTruthy();
});

it("shows every plugin, other plugins, and filters by name", async () => {
  vi.mocked(getServers).mockResolvedValue(overview);
  render(<ServersOverview />);
  fireEvent.click(await screen.findByRole("button", { name: "TFMC plugins, 4" }));
  expect(screen.getByText("Magic")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Find a plugin"), {
    target: { value: "mag" },
  });
  expect(screen.queryByText("Cooking")).toBeNull();
  fireEvent.change(screen.getByLabelText("Find a plugin"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Other plugins, 1" }));
  const row = screen.getByText("Bookshelf").closest("li")!;
  expect(within(row).getByText("Differs")).toBeTruthy();
  expect(within(row).getByText("2026.1")).toBeTruthy();
});

it("says when a server or GitHub can't be read", async () => {
  vi.mocked(getServers).mockResolvedValue({
    ...overview,
    github: { status: "unavailable", checked_at: null },
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

it("shows a failed fresh check without relabelling the previous result", async () => {
  vi.mocked(getServers).mockResolvedValueOnce(overview).mockRejectedValueOnce(new Error("offline"));
  render(<ServersOverview />);
  await screen.findByText("= main");
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  expect(await screen.findByText(/Check failed/)).toBeTruthy();
  expect(screen.getByText("= main")).toBeTruthy();
  expect(getServers).toHaveBeenCalledTimes(2);
});

it("shows failed repository lookups and unverified jars as warnings", async () => {
  vi.mocked(getServers).mockResolvedValue({
    ...overview,
    github: { status: "partial", checked_at: overview.checked_at },
    plugins: [
      { repo: "Core", latest: null, error: "github_unavailable", servers: { main: copy({ state: "unverified" }) } },
    ],
  });
  render(<ServersOverview />);
  expect(
    (await screen.findAllByText(/Unverified|Couldn.t check|couldn’t check|didn.t answer|didn’t answer/i)).length,
  ).toBeGreaterThan(0);
  expect(screen.getByText("Core")).toBeTruthy();
});

it("keeps the newer check when an older request completes afterwards", async () => {
  let refresh: (() => void) | undefined;
  const original = ServerControls.useServerControls;
  vi.spyOn(ServerControls, "useServerControls").mockImplementation((onChange) => {
    refresh = onChange;
    return original(onChange);
  });
  let finishOlder!: (data: Overview) => void;
  let finishNewer!: (data: Overview) => void;
  const older = new Promise<Overview>((resolve) => {
    finishOlder = resolve;
  });
  const newer = new Promise<Overview>((resolve) => {
    finishNewer = resolve;
  });
  vi.mocked(getServers).mockResolvedValueOnce(overview).mockReturnValueOnce(older).mockReturnValueOnce(newer);
  render(<ServersOverview />);
  await screen.findByText("= main");
  act(() => {
    refresh!();
    refresh!();
  });
  await act(async () =>
    finishNewer({
      ...overview,
      plugins: [{ repo: "FreshResult", latest: latest("9.0.0"), servers: { main: copy({ state: "older_release" }) } }],
    }),
  );
  expect(await screen.findByText("FreshResult")).toBeTruthy();
  await act(async () => finishOlder(overview));
  expect(screen.getByText("FreshResult")).toBeTruthy();
  expect(screen.queryByText("Archaeo")).toBeNull();
});
