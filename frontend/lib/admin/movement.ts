/**
 * Where players went, from CoreProtect's session rows: logins, logouts and a
 * position ping once a minute while online. Nothing between two pings is
 * recorded, so the lines drawn between them are guesses.
 */

import { adminRequest, type CoreProtectStatus } from "./api";

export const ACTION_LOGOUT = 0;
export const ACTION_LOGIN = 1;
export const ACTION_PING = 2;

/** [time, world index, x, y, z, action], oldest first. */
export type MovementPoint = [number, number, number, number, number, number];

export type MovementStatus = CoreProtectStatus & {
  server_label: string | null;
  ping_seconds: number | null;
  /** The CoreProtect world the map shows. */
  map_world: string;
};

export type PlayerMovement = {
  since: number;
  until: number;
  worlds: (string | null)[];
  /** Includes the row just before `since`, when it says where the player was as the window opened. */
  points: MovementPoint[];
  /**
   * From when the answer is complete: `since`, unless the window held more
   * rows than one answer carries and the oldest were left out.
   */
  complete_from: number;
  /** When the server began logging pings; before that only logins and logouts exist. */
  pings_since: number | null;
  coreprotect: MovementStatus;
};

export type EveryoneMovement = Omit<PlayerMovement, "points"> & {
  players: { uuid: string; minecraft_name: string; points: MovementPoint[] }[];
};

export const PLAYER_PRESETS = [
  { label: "15 min", seconds: 15 * 60 },
  { label: "1 h", seconds: 3600 },
  { label: "6 h", seconds: 6 * 3600 },
  { label: "24 h", seconds: 86400 },
  { label: "7 days", seconds: 7 * 86400 },
] as const;

export const EVERYONE_PRESETS = PLAYER_PRESETS.slice(0, 4);

export function getPlayerMovement(uuid: string, since: number, until: number): Promise<PlayerMovement> {
  return adminRequest(`/admin/players/${encodeURIComponent(uuid)}/movement?since=${since}&until=${until}`);
}

export function getEveryoneMovement(since: number, until: number): Promise<EveryoneMovement> {
  return adminRequest(`/admin/movement?since=${since}&until=${until}`);
}

/** CoreProtect names the Nether and the End after the overworld (`TFMC_Map_nether`, `TFMC_Map_the_end`). */
export function worldLabel(world: string | null | undefined): string {
  if (!world) return "an unknown world";
  if (world.endsWith("_the_end")) return "the End";
  if (world.endsWith("_nether")) return "the Nether";
  return world;
}

/** Pings further apart than this mean the player was not seen in between. */
export function gapSeconds(pingSeconds: number | null | undefined): number {
  const ping = pingSeconds && pingSeconds > 0 ? pingSeconds : 60;
  return 2 * ping + 30;
}

/**
 * Faster than this between two rows is not plain walking or riding (horses
 * top out near 15 blocks a second): a teleport, or travel nobody saw, so the
 * straight line between them is not where the player went.
 */
export const JUMP_BLOCKS_PER_SECOND = 20;

export type Sample = { time: number; x: number; y: number; z: number; action: number };

/** A run of rows with the player seen throughout, in one world. */
export type Stretch = { world: string | null; samples: Sample[] };

export function isJump(a: Sample, b: Sample): boolean {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  const seconds = Math.max(1, b.time - a.time);
  return distance > 64 && distance / seconds > JUMP_BLOCKS_PER_SECOND;
}

/**
 * Splits rows into stretches: a new one at every login, after every logout,
 * on a change of world, and wherever the player went unseen for longer than
 * `gapSeconds` (a crash, or pings missed).
 */
export function stretches(
  points: readonly MovementPoint[],
  worlds: readonly (string | null)[],
  pingSeconds: number | null | undefined
): Stretch[] {
  const gap = gapSeconds(pingSeconds);
  const out: Stretch[] = [];
  let current: Stretch | null = null;
  let previous: Sample | null = null;
  for (const [time, wi, x, y, z, action] of points) {
    const world = worlds[wi] ?? null;
    const sample = { time, x, y, z, action };
    const fresh =
      current === null ||
      previous === null ||
      action === ACTION_LOGIN ||
      previous.action === ACTION_LOGOUT ||
      current.world !== world ||
      time - previous.time > gap;
    if (fresh) {
      current = { world, samples: [] };
      out.push(current);
    }
    current!.samples.push(sample);
    previous = sample;
  }
  return out;
}

export type Position = {
  world: string | null;
  x: number;
  z: number;
  /** Between two pings the position is a straight-line guess. */
  exact: boolean;
};

/**
 * Where the player was at `time`, or null when they were not seen then
 * (offline, or between stretches). Between two rows of a stretch the
 * position is interpolated, unless the step was a jump.
 */
export function positionAt(all: readonly Stretch[], time: number): Position | null {
  for (const stretch of all) {
    const s = stretch.samples;
    const first = s[0];
    const last = s[s.length - 1];
    if (time < first.time || time > last.time) continue;
    for (let i = 0; i < s.length; i += 1) {
      const a = s[i];
      if (a.time === time) return { world: stretch.world, x: a.x, z: a.z, exact: true };
      const b = s[i + 1];
      if (b && a.time < time && time < b.time) {
        if (isJump(a, b)) {
          return { world: stretch.world, x: a.x, z: a.z, exact: false };
        }
        const f = (time - a.time) / (b.time - a.time);
        return { world: stretch.world, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, exact: false };
      }
    }
  }
  return null;
}

/** Seconds seen in each world, from the stretches' spans. */
export function timeByWorld(all: readonly Stretch[]): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  for (const stretch of all) {
    const s = stretch.samples;
    const span = s[s.length - 1].time - s[0].time;
    totals.set(stretch.world, (totals.get(stretch.world) ?? 0) + span);
  }
  return totals;
}

/** Total distance along the stretches, in blocks (x/z only), leaving out jumps. */
export function distanceTravelled(all: readonly Stretch[]): number {
  let total = 0;
  for (const stretch of all) {
    for (let i = 1; i < stretch.samples.length; i += 1) {
      const a = stretch.samples[i - 1];
      const b = stretch.samples[i];
      if (!isJump(a, b)) total += Math.hypot(b.x - a.x, b.z - a.z);
    }
  }
  return total;
}

/** The map-space box around every sample in the map's world, or null when there is none. */
export function boundsOf(
  all: readonly Stretch[],
  mapWorld: string
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const stretch of all) {
    if (stretch.world !== mapWorld) continue;
    for (const s of stretch.samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minZ, w: maxX - minX, h: maxZ - minZ };
}

/** A colour from old (cool, faint) to new (warm, bright) for a moment in the window. */
export function ageColour(fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction));
  const hue = 210 - 170 * f;
  const light = 55 + 10 * f;
  return `hsl(${hue.toFixed(0)} 85% ${light.toFixed(0)}%)`;
}

/** A steady colour per player for the everyone view. */
export function playerColour(uuid: string): string {
  let hash = 0;
  for (let i = 0; i < uuid.length; i += 1) hash = (hash * 31 + uuid.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 80% 62%)`;
}

/** `datetime-local` value for Unix seconds, in the browser's time zone. */
export function toLocalInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Unix seconds for a `datetime-local` value, or null when it is empty or invalid. */
export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
