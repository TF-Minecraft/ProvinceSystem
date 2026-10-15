import { adminRequest } from "./api";
import type { LpNode } from "./luckperms";

export type CommandGroup = {
  name: string;
  display_name: string | null;
  weight: number | null;
  members: number;
  kind: "rank" | "staff" | "step";
  track: string | null;
  parents: string[];
  nodes: LpNode[];
};

export type RegisteredCommand = {
  name: string;
  aliases: string[];
  description: string | null;
  usage: string | null;
  permission: string | null;
  shadowed: boolean;
  /** One character per group, in the response's group order. */
  access: string | null;
};

export type CommandPlugin = { name: string; version: string | null; commands: RegisteredCommand[] };
export type CommandsSnapshot = {
  status: { server: string; generated_at: number; received_at: string; fresh: boolean } | null;
  groups: CommandGroup[];
  plugins: CommandPlugin[];
};
export type CommandState = "y" | "n" | "o";
export type CommandFilter = "all" | "player" | "staff" | "open";
export type CommandsView = "matrix" | "roles";
export type CommandsUrlState = {
  view: CommandsView | null;
  role: string;
  q: string;
  filter: CommandFilter;
  plugin: string;
  state: CommandState;
  onlyNew: boolean;
  steps: boolean;
};

export const GROUP_SECTIONS = [
  { kind: "rank", label: "Player ranks" },
  { kind: "staff", label: "Staff ranks" },
  { kind: "step", label: "Track steps" },
] as const;

export function getCommands(): Promise<CommandsSnapshot> {
  return adminRequest("/admin/luckperms/commands");
}

export function groupLabel(group: CommandGroup): string {
  return group.display_name ?? group.name;
}

export function commandLabel(command: RegisteredCommand, plugin: CommandPlugin): string {
  return `/${command.shadowed ? `${plugin.name.toLowerCase()}:` : ""}${command.name}`;
}

export function commandState(command: RegisteredCommand, groupIndex: number): CommandState {
  return command.access === null ? "o" : command.access[groupIndex] === "y" ? "y" : "n";
}

export function commandCounts(commands: RegisteredCommand[], groupIndex: number): Record<CommandState, number> {
  const counts = { y: 0, n: 0, o: 0 };
  for (const command of commands) counts[commandState(command, groupIndex)]++;
  return counts;
}

export function matchesCommand(command: RegisteredCommand, plugin: CommandPlugin, query: string): boolean {
  const text = query.trim().toLowerCase().replace(/^\//, "");
  return (
    !text ||
    [
      command.name,
      commandLabel(command, plugin),
      ...command.aliases,
      command.permission,
      command.description,
      command.usage,
      plugin.name,
    ].some((value) => value?.toLowerCase().includes(text))
  );
}

export function matchesFilter(command: RegisteredCommand, groups: CommandGroup[], filter: CommandFilter): boolean {
  if (filter === "open") return command.access === null;
  if (filter === "player") {
    const index = groups.findIndex((group) => group.kind === "rank");
    return index >= 0 && commandState(command, index) === "y";
  }
  if (filter === "staff") {
    return (
      groups.every((group, index) => group.kind !== "rank" || commandState(command, index) === "n") &&
      groups.some((group, index) => group.kind === "staff" && commandState(command, index) === "y")
    );
  }
  return true;
}

export function filterPlugins(
  plugins: CommandPlugin[],
  predicate: (command: RegisteredCommand, plugin: CommandPlugin) => boolean,
): CommandPlugin[] {
  return plugins
    .map((plugin) => ({ ...plugin, commands: plugin.commands.filter((command) => predicate(command, plugin)) }))
    .filter((plugin) => plugin.commands.length > 0);
}

export function totalCommands(plugins: CommandPlugin[]): number {
  return plugins.reduce((total, plugin) => total + plugin.commands.length, 0);
}

/** Compare with the preceding group in this section, independently of its inheritance. */
export function previousGroup(groups: CommandGroup[], group: CommandGroup): CommandGroup | undefined {
  const section = groups.filter((candidate) => candidate.kind === group.kind);
  return section[section.findIndex((candidate) => candidate.name === group.name) - 1];
}

export function isNewCommand(command: RegisteredCommand, groupIndex: number, previousIndex: number): boolean {
  return (
    previousIndex >= 0 && commandState(command, groupIndex) === "y" && commandState(command, previousIndex) !== "y"
  );
}

/** Direct parents first, then their parents. Shared ancestors and cycles appear only once. */
export function inheritanceChain(group: CommandGroup, groups: CommandGroup[]): string[] {
  const byName = new Map(groups.map((item) => [item.name, item]));
  const seen = new Set([group.name]);
  const pending = [...group.parents];
  const chain: string[] = [];
  for (let i = 0; i < pending.length; i++) {
    const name = pending[i];
    if (seen.has(name)) continue;
    seen.add(name);
    chain.push(name);
    pending.push(...(byName.get(name)?.parents ?? []));
  }
  return chain;
}

export function parseCommandsState(params: URLSearchParams): CommandsUrlState {
  const view = params.get("view");
  const filter = params.get("filter");
  const state = params.get("state");
  return {
    view: view === "roles" || view === "matrix" ? view : null,
    role: params.get("role") ?? "",
    q: params.get("q") ?? "",
    filter: filter === "player" || filter === "staff" || filter === "open" ? filter : "all",
    plugin: params.get("plugin") ?? "",
    state: state === "n" || state === "o" ? state : "y",
    onlyNew: params.get("new") === "1",
    steps: params.get("steps") === "1",
  };
}

export function commandsUrl(url: URL, state: CommandsUrlState): string {
  const values = {
    view: state.view,
    role: state.role,
    q: state.q.trim(),
    filter: state.filter === "all" ? "" : state.filter,
    plugin: state.plugin,
    state: state.state === "y" ? "" : state.state,
    new: state.onlyNew ? "1" : "",
    steps: state.steps ? "1" : "",
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
