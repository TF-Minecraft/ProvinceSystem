import { adminRequest } from "./api";

export type ServerKey = "main" | "dev";

export type ServerInfo = {
  key: ServerKey;
  label: string;
  /** Main should only run published releases; Dev may run test builds. */
  releases_only: boolean;
  status: "available" | "not_configured" | "missing";
  paper: string | null;
  /** The last startup finished ("Done"). */
  started: boolean | null;
  log: string | null;
};

export type PluginCopy = {
  state: "latest" | "older_release" | "not_release" | "test_build" | "missing";
  files: string[];
  /** The jar's own version (plugin.yml). */
  version: string | null;
  /** The release whose file this is, if any. */
  release: string | null;
  /** The version the server enabled at its last startup. */
  loaded: string | null;
  loaded_state: "same" | "different" | "not_loaded" | "unknown";
  /** A jar waits in plugins/update/ for the next start. */
  update: boolean;
  duplicate: boolean;
};

export type ServerPlugin = {
  repo: string;
  latest: { version: string; published_at: string; url: string };
  servers: Partial<Record<ServerKey, PluginCopy>>;
};

export type OtherPlugin = {
  name: string;
  differs: boolean;
  servers: Partial<Record<ServerKey, { file: string; version: string | null } | null>>;
};

export type ServersOverview = {
  checked_at: string;
  github: {
    status: "available" | "unavailable";
    checked_at: string | null;
    stale: boolean;
  };
  servers: ServerInfo[];
  plugins: ServerPlugin[];
  others: OtherPlugin[];
};

export function getServers(): Promise<ServersOverview> {
  return adminRequest("/admin/servers");
}

export type Tone = "bad" | "warn" | "test" | "none";
export type Flag = { label: string; tone: Tone };

/** What is off about one server's copy of a plugin; an empty list means it runs the latest release. */
export function flags(copy: PluginCopy): Flag[] {
  if (copy.state === "missing") return [{ label: "Not installed", tone: "none" }];
  const found: Flag[] = [];
  if (copy.state === "not_release") found.push({ label: "Not a release", tone: "bad" });
  if (copy.state === "test_build") found.push({ label: "Test build", tone: "test" });
  if (copy.state === "older_release") found.push({ label: "Older release", tone: "warn" });
  if (copy.duplicate) found.push({ label: "Two jars", tone: "bad" });
  if (copy.loaded_state === "not_loaded") found.push({ label: "Didn’t start", tone: "bad" });
  if (waiting(copy)) found.push({ label: "Needs restart", tone: "warn" });
  return found;
}

/** A newer jar is on disk than the one the server is running. */
export function waiting(copy: PluginCopy): boolean {
  return copy.state !== "missing" && (copy.update || copy.loaded_state === "different");
}

const RANK: Record<Tone, number> = { bad: 0, warn: 1, test: 2, none: 3 };

/** How urgent a plugin is, lowest first; null when nothing needs a look. Missing plugins alone don't count. */
export function severity(plugin: ServerPlugin): number | null {
  const tones = Object.values(plugin.servers)
    .flatMap((copy) => (copy ? flags(copy) : []))
    .filter((flag) => flag.tone !== "none")
    .map((flag) => RANK[flag.tone]);
  return tones.length ? Math.min(...tones) : null;
}

export type ServerCounts = {
  notReleases: number;
  older: number;
  waiting: number;
  didNotStart: number;
};

export function counts(plugins: ServerPlugin[], key: ServerKey): ServerCounts {
  const result = { notReleases: 0, older: 0, waiting: 0, didNotStart: 0 };
  for (const plugin of plugins) {
    const copy = plugin.servers[key];
    if (!copy) continue;
    if (copy.state === "not_release" || copy.state === "test_build") result.notReleases += 1;
    if (copy.state === "older_release") result.older += 1;
    if (waiting(copy)) result.waiting += 1;
    if (copy.loaded_state === "not_loaded") result.didNotStart += 1;
  }
  return result;
}
