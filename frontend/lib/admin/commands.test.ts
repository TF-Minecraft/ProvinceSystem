import { afterEach, expect, it, vi } from "vitest";
import {
  commandCounts,
  commandLabel,
  commandsUrl,
  commandState,
  filterPlugins,
  getCommands,
  groupLabel,
  inheritanceChain,
  isNewCommand,
  matchesCommand,
  matchesFilter,
  parseCommandsState,
  previousGroup,
  totalCommands,
  type CommandGroup,
  type CommandPlugin,
  type RegisteredCommand,
} from "./commands";
import { adminRequest } from "./api";

vi.mock("./api", () => ({ adminRequest: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const group = (name: string, kind: CommandGroup["kind"] = "rank", parents: string[] = []): CommandGroup => ({
  name,
  display_name: null,
  kind,
  parents,
  weight: null,
  members: 0,
  track: null,
  nodes: [],
});
const groups = [
  group("default"),
  group("helper_player", "step"),
  group("commoner"),
  group("noble"),
  group("helper", "staff"),
];
const command = (access: string | null, extra: Partial<RegisteredCommand> = {}): RegisteredCommand => ({
  name: "emote",
  aliases: ["wave"],
  description: "Play an animation",
  usage: "/emote [name]",
  permission: access === null ? null : "ia.emote",
  shadowed: false,
  access,
  ...extra,
});
const plugin: CommandPlugin = { name: "ItemsAdder", version: null, commands: [command("nnnyy"), command(null)] };

it("fetches the command list through the staff API", async () => {
  vi.mocked(adminRequest).mockResolvedValue({ status: null, groups: [], plugins: [] });
  await getCommands();
  expect(adminRequest).toHaveBeenCalledWith("/admin/luckperms/commands");
});

it("counts permission states separately, including commands offered to everyone", () => {
  expect(commandCounts([command("ynnyy"), command("nnnny"), command(null)], 3)).toEqual({ y: 1, n: 1, o: 1 });
  expect(commandState(command("y"), 9)).toBe("n");
  expect(commandState(command(null), 9)).toBe("o");
});

it("filters using original group indexes and ignores track steps for staff-only results", () => {
  expect(matchesFilter(command("nynny"), groups, "staff")).toBe(true);
  expect(matchesFilter(command("nnnyy"), groups, "staff")).toBe(false);
  expect(matchesFilter(command(null), groups, "staff")).toBe(false);
  expect(matchesFilter(command(null), groups, "open")).toBe(true);
  expect(matchesFilter(command("ynnnn"), groups, "player")).toBe(true);
  expect(matchesFilter(command("nynnn"), groups, "player")).toBe(false);
  const interleaved = [groups[1], groups[0], groups[4]];
  expect(matchesFilter(command("nyn"), interleaved, "player")).toBe(true);
  const filtered = filterPlugins([plugin, { ...plugin, name: "Empty", commands: [] }], (item) =>
    matchesFilter(item, groups, "open"),
  );
  expect(filtered).toHaveLength(1);
  expect(totalCommands(filtered)).toBe(1);
  expect(plugin.commands).toHaveLength(2);
});

it("matches names, aliases, permissions, descriptions, usage and plugins without case or slash sensitivity", () => {
  for (const query of [" /WAVE ", "IA.EMOTE", "animation", "[name]", "itemsadder", "/itemsadder:emote"]) {
    expect(matchesCommand(command("y", { shadowed: true }), plugin, query)).toBe(true);
  }
  expect(matchesCommand(command(null), plugin, "missing")).toBe(false);
  expect(commandLabel(command("y", { shadowed: true }), plugin)).toBe("/itemsadder:emote");
  expect(groupLabel({ ...groups[0], display_name: "Player" })).toBe("Player");
  expect(groupLabel(groups[0])).toBe("default");
});

it("compares with the preceding group in the same section rather than a parent or track step", () => {
  expect(previousGroup(groups, groups[3])?.name).toBe("commoner");
  expect(previousGroup(groups, groups[4])).toBeUndefined();
  expect(isNewCommand(command("nnnyy"), 3, 2)).toBe(true);
  expect(isNewCommand(command(null), 3, 2)).toBe(false);
  expect(isNewCommand(command("yyyyy"), 3, -1)).toBe(false);
});

it("walks direct parents first and handles shared ancestors, unknown parents and cycles", () => {
  const tree = [
    group("noble", "rank", ["commoner", "patron"]),
    group("commoner", "rank", ["default"]),
    group("patron", "rank", ["default", "unknown"]),
    group("default", "rank", ["noble"]),
  ];
  expect(inheritanceChain(tree[0], tree)).toEqual(["commoner", "patron", "default", "unknown"]);
});

it("round-trips view, role, filters and search while preserving unrelated URL state", () => {
  const initial = parseCommandsState(
    new URLSearchParams("view=roles&role=noble&q=emote&filter=open&state=n&plugin=ItemsAdder&new=1&steps=1"),
  );
  const url = new URL(
    commandsUrl(new URL("https://example.test/admin/commands?keep=1#ranks"), initial),
    "https://example.test",
  );
  expect(parseCommandsState(url.searchParams)).toEqual(initial);
  expect(url.searchParams.get("keep")).toBe("1");
  expect(url.hash).toBe("#ranks");
  expect(parseCommandsState(new URLSearchParams("view=bad&filter=bad&state=bad"))).toEqual({
    view: null,
    role: "",
    q: "",
    filter: "all",
    state: "y",
    plugin: "",
    onlyNew: false,
    steps: false,
  });
  expect(commandsUrl(url, parseCommandsState(new URLSearchParams()))).toBe("/admin/commands?keep=1#ranks");
});
