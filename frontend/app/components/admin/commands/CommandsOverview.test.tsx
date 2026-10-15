/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountApiError } from "@/lib/account/api";
import {
  getCommands,
  parseCommandsState,
  type CommandGroup,
  type CommandsSnapshot,
  type RegisteredCommand,
} from "@/lib/admin/commands";
import { resetUrlWrites } from "@/lib/admin/urlState";
import CommandsOverview from "./CommandsOverview";

vi.mock("@/lib/admin/commands", async (original) => ({
  ...(await original<typeof import("@/lib/admin/commands")>()),
  getCommands: vi.fn(),
}));

function snapshot(): CommandsSnapshot {
  const group = (
    name: string,
    kind: CommandGroup["kind"],
    parents: string[] = [],
    display_name: string | null = null,
  ): CommandGroup => ({ name, kind, parents, display_name, members: 7, track: null, weight: null, nodes: [] });
  const command = (name: string, access: string | null, extra: Partial<RegisteredCommand> = {}): RegisteredCommand => ({
    name,
    access,
    aliases: [],
    permission: access === null ? null : `test.${name}`,
    description: `${name} description`,
    usage: null,
    shadowed: false,
    ...extra,
  });
  return {
    status: {
      server: "main",
      generated_at: Math.floor(Date.now() / 1000) - 7200,
      received_at: new Date().toISOString(),
      fresh: true,
    },
    groups: [
      group("default", "rank", [], "Player"),
      group("helper_player", "step", ["default"]),
      group("commoner", "rank", ["default"]),
      group("noble", "rank", ["commoner"]),
      group("helper", "staff", ["helper_player"]),
    ],
    plugins: [
      {
        name: "Essentials",
        version: "2.0",
        commands: [
          command("anvil", "yyyyy", { aliases: ["repair"], usage: "/anvil [item]" }),
          command("help", null),
          command("list", "yyyyy", { shadowed: true }),
        ],
      },
      { name: "ItemsAdder", version: "4.0", commands: [command("emote", "nnnyy")] },
      { name: "Moderation", version: null, commands: [command("ban", "nynny"), command("hidden", "nnnnn")] },
    ],
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin/commands");
  vi.mocked(getCommands).mockResolvedValue(snapshot());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  resetUrlWrites();
});

it("loads the matrix, labels API groups, expands commands and shows details and shadowed labels", async () => {
  render(<CommandsOverview />);
  const matrix = await screen.findByRole("region", { name: "Commands by role" });
  expect(screen.getByText("6 commands · 3 plugins")).toBeTruthy();
  expect(
    screen
      .getByText(/Published/)
      .querySelector("time")
      ?.getAttribute("title"),
  ).toBeTruthy();
  expect(within(matrix).getByRole("columnheader", { name: /Player.*7 members/ })).toBeTruthy();
  expect(within(matrix).queryByText("helper_player")).toBeNull();
  fireEvent.click(within(matrix).getByRole("button", { name: "Essentials 3 commands" }));
  expect(screen.getByRole("button", { name: "/essentials:list" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "/anvil" }));
  expect(screen.getByText("/anvil [item]")).toBeTruthy();
  expect(screen.getByText("/repair")).toBeTruthy();
  expect(screen.getByText("test.anvil")).toBeTruthy();
});

it("searches aliases and permissions, saves URL state and clears an empty search", async () => {
  render(<CommandsOverview />);
  const search = await screen.findByRole("searchbox");
  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
  fireEvent.change(search, { target: { value: "/repair" } });
  expect(screen.getByRole("button", { name: "/anvil" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "ItemsAdder 1 commands" })).toBeNull();
  expect(new URLSearchParams(window.location.search).get("q")).toBe("/repair");
  fireEvent.change(search, { target: { value: "test.emote" } });
  expect(screen.getByRole("button", { name: "/emote" })).toBeTruthy();
  fireEvent.change(search, { target: { value: "no-match" } });
  expect(screen.getByText("No commands found")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect((search as HTMLInputElement).value).toBe("");
});

it("filters matrix permissions and plugins and toggles track steps without shifting access indexes", async () => {
  render(<CommandsOverview />);
  await screen.findByRole("searchbox");
  fireEvent.click(screen.getByRole("button", { name: "Staff only 1" }));
  expect(within(screen.getByRole("region", { name: "Commands by role" })).getByRole("status").textContent).toBe(
    "1 of 6 commands · 1 plugin",
  );
  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  const banRow = screen.getByRole("button", { name: "/ban" }).closest("tr")!;
  expect(within(banRow).getAllByRole("img", { name: "Allowed by command permission" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox", { name: "Show track steps" }));
  expect(screen.getByRole("columnheader", { name: "Track steps" })).toBeTruthy();
  expect(within(banRow).getAllByRole("img", { name: "Allowed by command permission" })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "All 6" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Plugin" }), { target: { value: "ItemsAdder" } });
  expect(screen.getByRole("button", { name: "/emote" })).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get("plugin")).toBe("ItemsAdder");
});

it("shows the role view, inheritance, new commands and own permission contexts and expiry", async () => {
  const data = snapshot();
  data.groups[3].nodes = [
    {
      key: "ia.emote",
      value: true,
      contexts: { server: ["main"], world: ["spawn"] },
      expiry: Math.floor(Date.now() / 1000) + 7200,
    },
    { key: "test.deny", value: false, contexts: {}, expiry: 0 },
  ];
  vi.mocked(getCommands).mockResolvedValue(data);
  render(<CommandsOverview initialState={parseCommandsState(new URLSearchParams("view=roles&role=noble"))} />);
  const role = await screen.findByRole("region", { name: "noble commands" });
  expect(within(role).getByRole("link", { name: "noble" }).getAttribute("href")).toBe("/admin/ranks/groups/noble");
  expect(within(role).getByText("vs commoner", { exact: false }).textContent).toBe("+1 vs commoner");
  expect(
    within(role)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["noble", "commoner", "Player"]);
  fireEvent.click(screen.getByRole("checkbox", { name: /Only new at this rank/ }));
  expect(within(role).getByRole("button", { name: /\/emote/ })).toBeTruthy();
  expect(within(role).queryByRole("button", { name: /\/anvil/ })).toBeNull();
  fireEvent.click(within(role).getByText("Own permissions"));
  expect(within(role).getByTitle("server=main").textContent).toBe("Main");
  expect(within(role).getByText("world=spawn")).toBeTruthy();
  expect(within(role).getByText("Expires in 2 h")).toBeTruthy();
  expect(within(role).getByText("test.deny")).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get("new")).toBe("1");
});

it("changes roles, searches role commands, filters states, reveals steps and reviews commands without permission in the matrix", async () => {
  render(<CommandsOverview />);
  fireEvent.click(await screen.findByRole("button", { name: "By role" }));
  fireEvent.click(screen.getByRole("button", { name: "noble 7 members" }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "emote" } });
  expect(screen.getByRole("button", { name: /\/emote/ })).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get("role")).toBe("noble");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  const role = screen.getByRole("region", { name: "noble commands" });
  fireEvent.click(within(role).getByRole("button", { name: /No permission set/ }));
  expect(within(role).getByRole("button", { name: /\/help/ })).toBeTruthy();
  fireEvent.click(within(role).getByRole("button", { name: /Hidden/ }));
  expect(within(role).queryByRole("button", { name: /\/emote/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "helper_player 7 members" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show track steps" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Role" }), { target: { value: "helper_player" } });
  expect(screen.getByRole("region", { name: "helper_player commands" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show track steps" }));
  expect(screen.getByRole("region", { name: "Player commands" })).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get("role")).toBe("default");
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(screen.getByRole("region", { name: "Commands by role" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "No permission set 1" }).getAttribute("aria-pressed")).toBe("true");
});

it("defaults phones to roles while respecting an explicit matrix URL", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  render(<CommandsOverview />);
  expect(await screen.findByRole("region", { name: "Player commands" })).toBeTruthy();
  cleanup();
  render(<CommandsOverview initialState={parseCommandsState(new URLSearchParams("view=matrix"))} />);
  expect(await screen.findByRole("region", { name: "Commands by role" })).toBeTruthy();
});

it("restores URL state on browser history navigation", async () => {
  render(<CommandsOverview />);
  await screen.findByRole("searchbox");
  window.history.replaceState(null, "", "/admin/commands?view=roles&role=noble&q=emote&steps=1");
  fireEvent.popState(window);
  expect(screen.getByRole("region", { name: "noble commands" })).toBeTruthy();
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("emote");
  expect((screen.getByRole("checkbox", { name: "Show track steps" }) as HTMLInputElement).checked).toBe(true);
});

it("shows missing and stale command lists", async () => {
  vi.mocked(getCommands).mockResolvedValue({ status: null, groups: [], plugins: [] });
  render(<CommandsOverview />);
  expect(
    await screen.findByText("No command list yet. TFMCWeb publishes it when the LuckPerms bridge is on."),
  ).toBeTruthy();
  expect(screen.queryByRole("searchbox")).toBeNull();
  cleanup();
  const data = snapshot();
  data.status!.fresh = false;
  vi.mocked(getCommands).mockResolvedValue(data);
  render(<CommandsOverview />);
  expect(await screen.findByText("Command list is stale · published 2 h ago.")).toBeTruthy();
});

it.each([
  [401, "Sign in with Discord"],
  [403, "This page is for TFMC staff only."],
  [503, "The staff panel isn’t available yet."],
  [500, "We couldn’t load the staff panel. Please refresh the page."],
])("uses StaffGate for HTTP %s", async (status, message) => {
  vi.mocked(getCommands).mockRejectedValue(new AccountApiError("failed", status as number));
  render(<CommandsOverview />);
  expect(await screen.findByText(message as string)).toBeTruthy();
  expect(screen.queryByRole("searchbox")).toBeNull();
});
