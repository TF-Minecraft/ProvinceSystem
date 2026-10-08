import { AccountApiError } from "../account/api";
import { adminErrorMessage, adminRequest } from "./api";
import type { StaffRole } from "./api";

/** A LuckPerms node. Contexts are {} when global; expiry is Unix seconds, 0 when permanent. */
export type LpNode = {
  key: string;
  value: boolean;
  contexts: Record<string, string[]>;
  expiry: number;
};

export type LpShownNode = LpNode & {
  kind: "group" | "meta" | "permission";
  group: string | null;
  /** Whether the viewer may remove it; the server checks again. */
  editable: boolean;
};

export type LpStatus = {
  server: string | null;
  snapshot_at: string | null;
  checked_at: string | null;
  has_snapshot: boolean;
  /** An applying server asked for changes within the last minute. */
  applying: boolean;
  polled_at: string | null;
};

export type LpRights = {
  read_only: boolean;
  change_players: boolean;
  edit_definitions: boolean;
};

export type LpGroupSummary = {
  name: string;
  display_name: string | null;
  weight: number | null;
  prefix: string | null;
  suffix: string | null;
  parents: string[];
  members: number;
  permissions: number;
  min_role: "admin" | "root";
  patreon: boolean;
};

export type LpTrack = { name: string; groups: string[] };

export type LpChangeStatus = "pending" | "sent" | "applied" | "failed" | "expired" | "unknown";

export type LpChange = {
  id: number;
  created_at: string;
  actor_name: string | null;
  actor_role: StaffRole | null;
  target_type: "user" | "group" | "track";
  target: string;
  target_name: string | null;
  description: string;
  reason: string;
  status: LpChangeStatus;
  finished_at: string | null;
  error: string | null;
};

export type LpOverview = {
  status: LpStatus;
  players: number;
  groups: LpGroupSummary[];
  tracks: LpTrack[];
  rights: LpRights;
  patreon_groups: string[];
  recent: LpChange[];
};

export type LpPlayerRow = {
  uuid: string;
  name: string | null;
  rank: string | null;
  groups: { name: string; contexts: Record<string, string[]>; expiry: number }[];
};

export type LpPlayerPage = { total: number; page: number; page_size: number; rows: LpPlayerRow[] };

export type LpTrackPosition = LpTrack & {
  position: number | null;
  ambiguous: boolean;
  can_promote: boolean;
  can_demote: boolean;
};

export type LpPlayer = {
  status: LpStatus;
  player: {
    uuid: string;
    name: string | null;
    rank: string | null;
    rank_prefix: string | null;
    inherits: string[];
    nodes: LpShownNode[];
    tracks: LpTrackPosition[];
    account: { discord_user_id: string; discord_username: string | null; user_id: number | null; role: StaffRole | null } | null;
  };
  groups: { name: string; weight: number | null; min_role: "admin" | "root"; patreon: boolean; addable: boolean }[];
  rights: LpRights & { change_this_player: boolean; admin_permissions: string[] };
  changes: LpChange[];
  pending: LpChange | null;
};

export type LpGroupDetail = {
  status: LpStatus;
  group: LpGroupSummary & {
    nodes: LpShownNode[];
    inherits: string[];
    children: string[];
    tracks: string[];
  };
  members: LpPlayerPage;
  all_groups: string[];
  rights: LpRights;
  changes: LpChange[];
  pending: LpChange | null;
};

export type LpOp =
  | { op: "add_node"; node: Partial<LpNode> & { key: string } }
  | { op: "remove_node"; node: LpNode }
  | { op: "promote" | "demote"; track: string }
  | { op: "create_group" | "delete_group" | "create_track" | "delete_track" }
  | { op: "set_groups"; groups: string[] };

export type LpTargetType = "user" | "group" | "track";

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function getLuckPerms(): Promise<LpOverview> {
  return adminRequest("/admin/luckperms");
}

export function getLpPlayers(params: { q?: string; group?: string; page?: number }): Promise<LpPlayerPage> {
  return adminRequest(`/admin/luckperms/players${query({ q: params.q?.trim(), group: params.group, page: params.page })}`);
}

export function getLpPlayer(uuid: string): Promise<LpPlayer> {
  return adminRequest(`/admin/luckperms/players/${encodeURIComponent(uuid)}`);
}

export function getLpGroup(name: string): Promise<LpGroupDetail> {
  return adminRequest(`/admin/luckperms/groups/${encodeURIComponent(name)}`);
}

export function getLpChange(id: number): Promise<LpChange> {
  return adminRequest(`/admin/luckperms/changes/${id}`);
}

export function submitLpChange(targetType: LpTargetType, target: string, ops: LpOp[], reason: string): Promise<LpChange> {
  return adminRequest("/admin/luckperms/changes", {
    method: "POST",
    body: JSON.stringify({ target_type: targetType, target, ops, reason }),
  });
}

export function isFinished(status: LpChangeStatus): boolean {
  return status !== "pending" && status !== "sent";
}

const POLL_MS = 1500;
// Past the site's 5-minute wait for a result, so every change ends settled.
const POLL_LIMIT_MS = 330_000;

/** Wait until the change is settled: applied, failed, expired or of unknown outcome. */
export async function waitForChange(
  id: number,
  { signal, intervalMs = POLL_MS, limitMs = POLL_LIMIT_MS }: { signal?: AbortSignal; intervalMs?: number; limitMs?: number } = {}
): Promise<LpChange> {
  const started = Date.now();
  let change = await getLpChange(id);
  while (!isFinished(change.status) && Date.now() - started < limitMs && !signal?.aborted) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    change = await getLpChange(id);
  }
  return change;
}

// --------------------
// Wording
// --------------------

export const LP_ERRORS: Record<string, string> = {
  bridge_offline: "No server is applying rank changes right now, so nothing can be changed.",
  change_pending: "Another change for this is still being applied. Wait a moment and try again.",
  root_only: "Only the owner can make that change.",
  target_is_staff: "In-game staff ranks can only be changed by the owner.",
  cannot_act_on_self: "You can’t change your own in-game ranks.",
  target_outranks_you: "That player’s website account is at or above your role.",
  node_exists: "They already have that. Reload to see the latest.",
  node_missing: "That has already changed. Reload to see the latest.",
  group_missing: "That group doesn’t exist.",
  group_exists: "A group with that name already exists.",
  track_missing: "That track doesn’t exist.",
  track_exists: "A track with that name already exists.",
  track_end: "They are already at the top of that track.",
  not_on_track: "They aren’t on that track.",
  ambiguous_track: "They hold more than one group on that track; remove the extras first.",
  track_empty: "That track has no groups.",
  inheritance_cycle: "That would make the group inherit itself.",
  cannot_delete_default: "The default group can’t be deleted.",
  nothing_to_change: "There is nothing to change.",
  bad_node: "That permission isn’t valid.",
  bad_expiry: "Choose an expiry in the future.",
  bad_contexts: "That server or world isn’t valid.",
  bad_group_name: "Use lowercase letters, numbers, _, + or - for group names.",
  bad_track_name: "Use lowercase letters, numbers, _, + or - for track names.",
  bad_track_groups: "List each group once.",
  player_not_found: "No rank record found for that player.",
  save_failed: "The rank change couldn’t be saved.",
  no_result: "The server never reported back.",
  no_longer_allowed: "Cancelled: it was no longer allowed when the server picked it up (rights or groups changed).",
  expired: "The server didn’t pick it up in time.",
};

/** A failed request in words: LuckPerms codes first, then the staff panel's own. */
export function lpRequestMessage(err: unknown): string {
  if (err instanceof AccountApiError && err.message in LP_ERRORS) return LP_ERRORS[err.message];
  return adminErrorMessage(err);
}

export function lpErrorMessage(code: string | null | undefined): string {
  if (!code) return "Something went wrong.";
  return LP_ERRORS[code] ?? code;
}

export const STATUS_LABELS: Record<LpChangeStatus, string> = {
  pending: "Waiting for the server",
  sent: "Applying",
  applied: "Applied",
  failed: "Failed",
  expired: "Expired",
  unknown: "Outcome unknown",
};

export function contextLabel(contexts: Record<string, string[]>): string {
  return Object.entries(contexts)
    .flatMap(([key, values]) => values.map((value) => `${key}=${value}`))
    .join(", ");
}

const SERVER_NAMES = new Map([["main", "Main"], ["dev", "Dev"], ["tutorial", "Tutorial"]]);

/** contextLabel for lists: known servers by name ("Main"), anything else as key=value. */
export function shortContextLabel(contexts: Record<string, string[]>): string {
  return Object.entries(contexts)
    .flatMap(([key, values]) => values.map((value) => (key === "server" && SERVER_NAMES.get(value)) || `${key}=${value}`))
    .join(", ");
}

export function nodeLabel(node: LpNode): string {
  return node.key;
}

/** "Expires in 3 d" for temporary nodes, "" for permanent ones. */
export function expiryLabel(expiry: number, now = Date.now() / 1000): string {
  if (!expiry) return "";
  const left = expiry - now;
  if (left <= 0) return "Expired";
  if (left < 3600) return `Expires in ${Math.max(1, Math.round(left / 60))} min`;
  if (left < 86400) return `Expires in ${Math.round(left / 3600)} h`;
  return `Expires in ${Math.round(left / 86400)} d`;
}

export const DURATIONS: { label: string; seconds: number }[] = [
  { label: "Permanent", seconds: 0 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 7 * 86400 },
  { label: "30 days", seconds: 30 * 86400 },
];

// --------------------
// Minecraft colour codes
// --------------------

const COLOURS: Record<string, string> = {
  "0": "#000000",
  "1": "#0000AA",
  "2": "#00AA00",
  "3": "#00AAAA",
  "4": "#AA0000",
  "5": "#AA00AA",
  "6": "#FFAA00",
  "7": "#AAAAAA",
  "8": "#555555",
  "9": "#5555FF",
  a: "#55FF55",
  b: "#55FFFF",
  c: "#FF5555",
  d: "#FF55FF",
  e: "#FFFF55",
  f: "#FFFFFF",
};

export type McSegment = { text: string; colour: string | null; bold: boolean; italic: boolean; underline: boolean; strike: boolean };

/** Split "&6Noble &lLord" (or § codes, or &#rrggbb) into styled runs. Unknown codes stay as text. */
export function parseMcText(text: string): McSegment[] {
  const out: McSegment[] = [];
  let style = { colour: null as string | null, bold: false, italic: false, underline: false, strike: false };
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ text: buffer, ...style });
    buffer = "";
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if ((ch === "&" || ch === "§") && i + 1 < text.length) {
      const hex = /^#[0-9a-fA-F]{6}$/.exec(text.slice(i + 1, i + 8));
      if (hex) {
        flush();
        style = { colour: hex[0].toUpperCase(), bold: false, italic: false, underline: false, strike: false };
        i += 7;
        continue;
      }
      const code = text[i + 1].toLowerCase();
      if (code in COLOURS || "lmnokr".includes(code)) {
        flush();
        if (code in COLOURS) style = { colour: COLOURS[code], bold: false, italic: false, underline: false, strike: false };
        else if (code === "l") style = { ...style, bold: true };
        else if (code === "o") style = { ...style, italic: true };
        else if (code === "n") style = { ...style, underline: true };
        else if (code === "m") style = { ...style, strike: true };
        else if (code === "r") style = { colour: null, bold: false, italic: false, underline: false, strike: false };
        i += 1;
        continue;
      }
    }
    buffer += ch;
  }
  flush();
  return out;
}

export function stripMcText(text: string): string {
  return parseMcText(text)
    .map((segment) => segment.text)
    .join("");
}
