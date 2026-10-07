/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PlayersDirectory from "./PlayersDirectory";
import { AccountApiError } from "../../../lib/account/api";
import {
  getPlayers,
  parsePlayerListing,
  type CharacterRow,
  type PlayerDirectory,
  type PlayerListing,
  type PlayerSummary,
  type PlayerView,
} from "../../../lib/admin/api";

vi.mock("../../../lib/admin/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/admin/api")>(),
  getPlayers: vi.fn(),
}));

const NOW = 2_000_000_000;

function player(uuid: string, name: string | null, extra: Partial<PlayerSummary> = {}): PlayerSummary {
  return {
    uuid, minecraft_name: name, aliases: [], discord_user_id: null, discord_username: null, discord_nickname: null,
    site_role: null, characters: [], last_seen: null, online: false, ...extra,
  };
}

const ENZO = player("0615a817-8cb4-4aef-95f7-f6c9bf7611b8", "MrEnzo99", {
  aliases: ["OldEnzo"], discord_user_id: "422545450919526411", discord_username: "hazelstone", discord_nickname: "Enzo",
  characters: ["Hazel Stonebrook"], last_seen: NOW - 7200, site_role: "mod",
});

const PAGE = { sort: "name", order: "asc", total: 0, omitted: 0, page: 1, page_size: 50, coreprotect: { status: "available", server_label: "Vardera" } } as const;

function directory(view: Exclude<PlayerView, "character">, rows: PlayerSummary[], extra: Partial<PlayerDirectory> = {}): PlayerDirectory {
  return { ...PAGE, total: rows.length, view, rows, ...extra } as PlayerDirectory;
}

function characters(rows: CharacterRow[], extra: Partial<PlayerDirectory> = {}): PlayerDirectory {
  return { ...PAGE, total: rows.length, view: "character", rows, ...extra } as PlayerDirectory;
}

/** Answers each request with the given view's page. */
function serve(pages: Partial<Record<PlayerView, PlayerDirectory>>) {
  vi.mocked(getPlayers).mockImplementation(async ({ view }) => pages[view ?? "minecraft"] ?? directory("minecraft", []));
}

function renderDirectory(initial: PlayerView | PlayerListing = "minecraft", initialQuery = "") {
  const listing = typeof initial === "string" ? { view: initial, sort: "name", order: "asc" } as const : initial;
  return render(<PlayersDirectory initialQuery={initialQuery} initialListing={listing} initialPage={1} />);
}

function called(extra: Record<string, unknown> = {}) {
  return { q: "", view: "minecraft", sort: "name", order: "asc", page: 1, ...extra };
}

function lead(row: HTMLElement): string {
  return within(row).getAllByRole("cell")[0].textContent ?? "";
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  window.history.replaceState(null, "", "/admin/players");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("lists everyone under Minecraft by default", async () => {
  serve({
    minecraft: directory("minecraft", [
      ENZO,
      // Linked before handles were stored: only the server nickname is known.
      player("44444444-4444-4444-4444-444444444444", "Justin", { discord_user_id: "5", discord_nickname: "Justin" }),
      player("33333333-3333-3333-3333-333333333333", "Quiet", { online: true, last_seen: NOW }),
      player("22222222-2222-2222-2222-222222222222", null),
    ], { total: 243 }),
  });
  renderDirectory();

  const link = await screen.findByRole("link", { name: "MrEnzo99" });
  expect(link.getAttribute("href")).toBe("/admin/players/0615a817-8cb4-4aef-95f7-f6c9bf7611b8");
  const row = link.closest("tr")!;
  expect(within(row).getByText("2 h ago")).toBeTruthy();
  expect(within(row).getByText("Moderator")).toBeTruthy();
  // In its column, and again under the name for narrow screens.
  expect(within(row).getAllByText("@hazelstone · Enzo").length).toBe(2);
  expect(within(row).getAllByText("Hazel Stonebrook").length).toBe(2);
  expect(within(screen.getByRole("link", { name: "Justin" }).closest("tr")!).queryByText("Not linked")).toBeNull();
  expect(within(screen.getByRole("link", { name: "Quiet" }).closest("tr")!).getByText("Seen just now")).toBeTruthy();
  expect(within(screen.getByRole("link", { name: "22222222-2222-2222-2222-222222222222" }).closest("tr")!).getByText("Never")).toBeTruthy();
  expect(screen.getByText("243 players · activity from Vardera")).toBeTruthy();
  expect(screen.queryByRole("tab", { name: "Activity" })).toBeNull();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Minecraft", "Discord", "Character"]);
  expect(screen.getByRole("tab", { name: "Minecraft" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("players-tab-minecraft");
  expect(getPlayers).toHaveBeenLastCalledWith(called());
});

it("sorts the whole list from the column headings", async () => {
  serve({ minecraft: directory("minecraft", [ENZO], { total: 120 }) });
  renderDirectory();
  await screen.findByText("Page 1 of 3");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith(called({ page: 2 })));
  expect(screen.getByRole("columnheader", { name: "Minecraft" }).getAttribute("aria-sort")).toBe("ascending");
  expect(screen.getByRole("columnheader", { name: "Last seen" }).getAttribute("aria-sort")).toBeNull();

  // Last seen opens most recent first, back on the first page; the server orders every page.
  fireEvent.click(screen.getByRole("button", { name: "Last seen" }));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith(called({ sort: "last_seen", order: "desc" })));
  expect(window.location.search).toBe("?sort=last_seen");
  expect(screen.getByRole("columnheader", { name: "Last seen" }).getAttribute("aria-sort")).toBe("descending");
  fireEvent.click(screen.getByRole("button", { name: "Last seen" }));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith(called({ sort: "last_seen", order: "asc" })));
  expect(window.location.search).toBe("?sort=last_seen&order=asc");

  // Names open A to Z, and reverse on a second click.
  fireEvent.click(screen.getByRole("button", { name: "Minecraft" }));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith(called()));
  expect(window.location.search).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Minecraft" }));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith(called({ order: "desc" })));
  expect(screen.getByRole("columnheader", { name: "Minecraft" }).getAttribute("aria-sort")).toBe("descending");

  // The order stays when switching views.
  fireEvent.click(screen.getByRole("tab", { name: "Character" }));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith(called({ view: "character", order: "desc" })));
  expect(window.location.search).toBe("?view=character&order=desc");
});

it("leads the Discord table with the handle and counts unlinked players", async () => {
  serve({
    discord: directory("discord", [ENZO], { omitted: 34 }),
    minecraft: directory("minecraft", [ENZO]),
  });
  renderDirectory("discord");

  const handle = await screen.findByRole("link", { name: "@hazelstone" });
  const row = handle.closest("tr")!;
  expect(lead(row)).toContain("@hazelstone");
  expect(lead(row)).toContain("Enzo");
  expect(within(row).getByText("2 h ago")).toBeTruthy();
  expect(screen.getByText("1 linked player · activity from Vardera")).toBeTruthy();
  expect(screen.getByText(/34 players without a Discord link aren’t listed here/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "See everyone under Minecraft" }));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith(called()));
  expect(screen.getByRole("tab", { name: "Minecraft" }).getAttribute("aria-selected")).toBe("true");
});

it("leads the Minecraft table with the name and earlier names", async () => {
  serve({ minecraft: directory("minecraft", [ENZO]) });
  renderDirectory("minecraft");

  const row = (await screen.findByRole("link", { name: "MrEnzo99" })).closest("tr")!;
  expect(lead(row)).toMatch(/^MrEnzo99/);
  expect(within(row).getByText("Also OldEnzo")).toBeTruthy();
});

it("gives each character a row of its own, led by the character's name", async () => {
  serve({
    character: characters([
      { character: { character_id: "c1", name: "Aldric", status: "alive", race: "human", class: "MUSKETEER" }, player: ENZO },
      { character: { character_id: "c2", name: "Aldric", status: "dead", race: null, class: null }, player: player("22222222-2222-2222-2222-222222222222", "Other") },
    ], { omitted: 3 }),
  });
  renderDirectory("character");

  const names = await screen.findAllByRole("link", { name: "Aldric" });
  expect(names).toHaveLength(2);
  expect(names[0].getAttribute("href")).toBe("/admin/players/0615a817-8cb4-4aef-95f7-f6c9bf7611b8");
  const first = names[0].closest("tr")!;
  expect(within(first).getByText("Human · Musketeer")).toBeTruthy();
  expect(within(first).getByRole("link", { name: "MrEnzo99" })).toBeTruthy();
  expect(within(names[1].closest("tr")!).getByText("Dead")).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Player last seen" })).toBeTruthy();
  expect(screen.getByText("2 characters on Vardera")).toBeTruthy();
  expect(screen.getByText("3 players have no character on Vardera.")).toBeTruthy();
});

it("keeps the search across views and never shows one view's rows in another's table", async () => {
  let answerCharacters: (page: PlayerDirectory) => void = () => {};
  vi.mocked(getPlayers).mockImplementation(({ view }) =>
    view === "character"
      ? new Promise((resolve) => { answerCharacters = resolve; })
      : Promise.resolve(directory("minecraft", [ENZO])));
  renderDirectory();
  await screen.findByRole("link", { name: "MrEnzo99" });

  fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "hazel" } });
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith(called({ q: "hazel" })));
  fireEvent.click(screen.getByRole("tab", { name: "Character" }));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith(called({ q: "hazel", view: "character" })));
  expect(window.location.search).toBe("?q=hazel&view=character");
  expect(screen.queryByRole("link", { name: "MrEnzo99" })).toBeNull();
  expect(screen.getByText("Loading…")).toBeTruthy();

  await act(async () => answerCharacters(characters([
    { character: { character_id: "c1", name: "Hazel Stonebrook", status: "alive", race: null, class: null }, player: ENZO },
  ])));
  expect(screen.getByRole("link", { name: "Hazel Stonebrook" })).toBeTruthy();
});

it("moves between tabs with the arrow keys and opens one with Enter", async () => {
  serve({});
  renderDirectory();
  await screen.findByText("No players match that.");
  const minecraft = screen.getByRole("tab", { name: "Minecraft" });
  expect(minecraft.tabIndex).toBe(0);
  expect(screen.getByRole("tab", { name: "Discord" }).tabIndex).toBe(-1);

  minecraft.focus();
  fireEvent.keyDown(minecraft, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Character" }));
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(minecraft);
  fireEvent.keyDown(minecraft, { key: "ArrowRight" });
  const discord = screen.getByRole("tab", { name: "Discord" });
  expect(document.activeElement).toBe(discord);
  // Moving focus alone fetches nothing.
  expect(getPlayers).toHaveBeenCalledTimes(1);
  fireEvent.click(discord);
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith(called({ view: "discord" })));
});

it("pages through results", async () => {
  vi.mocked(getPlayers).mockImplementation(async ({ page }) =>
    directory("discord", [player(`0000000${page}-0000-0000-0000-000000000000`, `P${page}`)], { total: 120, page: page ?? 1 }));
  renderDirectory("discord");
  await screen.findByText("Page 1 of 3");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Page 2 of 3");
  expect(getPlayers).toHaveBeenLastCalledWith(called({ view: "discord", page: 2 }));
  expect(window.location.search).toBe("?view=discord&page=2");
});

it("tidies an old link's address", async () => {
  window.history.replaceState(null, "", "/admin/players?sort=discord");
  serve({});
  renderDirectory(parsePlayerListing(undefined, "discord"));
  await waitFor(() => expect(getPlayers).toHaveBeenLastCalledWith(called({ view: "discord" })));
  expect(window.location.search).toBe("?view=discord");
});

it("maps page links to a view and order", () => {
  const listing = (view: PlayerView, sort: string, order: string) => ({ view, sort, order });
  expect(parsePlayerListing()).toEqual(listing("minecraft", "name", "asc"));
  expect(parsePlayerListing("character", "minecraft")).toEqual(listing("character", "name", "asc"));
  expect(parsePlayerListing("discord", "last_seen", "asc")).toEqual(listing("discord", "last_seen", "asc"));
  expect(parsePlayerListing(undefined, "name", "desc")).toEqual(listing("minecraft", "name", "desc"));
  // The old Activity view, and the sort from before the views.
  expect(parsePlayerListing("activity")).toEqual(listing("minecraft", "last_seen", "desc"));
  expect(parsePlayerListing(undefined, "last_seen")).toEqual(listing("minecraft", "last_seen", "desc"));
  expect(parsePlayerListing(undefined, "character")).toEqual(listing("character", "name", "asc"));
  expect(parsePlayerListing("bogus", "bogus", "bogus")).toEqual(listing("minecraft", "name", "asc"));
});

it("says when CoreProtect cannot be read, and that last seen is unknown", async () => {
  serve({
    minecraft: directory("minecraft", [player("11111111-1111-1111-1111-111111111111", "Linked")], {
      coreprotect: { status: "unavailable", reason: "busy", server_label: null },
    }),
  });
  renderDirectory();
  expect(await screen.findByText(/CoreProtect is busy.*Only linked players and characters are listed/)).toBeTruthy();
  expect(within(screen.getByRole("link", { name: "Linked" }).closest("tr")!).getByText("Unknown")).toBeTruthy();
});

it.each([
  [401, "Sign in with Discord"],
  [403, "This page is for TFMC staff only."],
])("explains a %s", async (status, text) => {
  vi.mocked(getPlayers).mockRejectedValue(new AccountApiError("x", status));
  renderDirectory();
  expect(await screen.findByText(text)).toBeTruthy();
});

it("shows request errors without hiding the search", async () => {
  vi.mocked(getPlayers).mockRejectedValue(new AccountApiError("query_too_long", 400));
  renderDirectory("minecraft", "x".repeat(70));
  expect(await screen.findByText("Search for 64 characters or fewer.")).toBeTruthy();
  expect(screen.getByLabelText("Search players")).toBeTruthy();
  await act(async () => {});
});
