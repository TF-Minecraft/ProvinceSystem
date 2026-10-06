/**
 * Where players went, from CoreProtect's session rows: logins, logouts and a
 * position ping once a minute while online. Nothing between two pings is
 * recorded, so the lines drawn between them are guesses.
 */

import { adminRequest, type CoreProtectStatus, type PlayerSession } from "./api";

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
  /** The server's clock when it answered. */
  as_of?: number;
  coreprotect: MovementStatus;
};

export type SessionMovement = Omit<PlayerMovement, "since" | "until" | "complete_from"> & {
  /** Null only when CoreProtect could not be read. */
  session: PlayerSession | null;
  /** The span shown: login to logout, last sighting, or (open) now. */
  since?: number;
  until?: number;
  complete_from: number | null;
  as_of: number;
};

export type EveryoneMovement = Omit<PlayerMovement, "points"> & {
  players: { uuid: string; minecraft_name: string; points: MovementPoint[] }[];
};

/** The longest range the backend serves for one player, and for everyone. */
export const PLAYER_WINDOW_SECONDS = 7 * 86400;
export const EVERYONE_WINDOW_SECONDS = 86400;

export function getPlayerMovement(uuid: string, since: number, until: number): Promise<PlayerMovement> {
  return adminRequest(`/admin/players/${encodeURIComponent(uuid)}/movement?since=${since}&until=${until}`);
}

export function getSessionMovement(uuid: string, session: string): Promise<SessionMovement> {
  return adminRequest(
    `/admin/players/${encodeURIComponent(uuid)}/sessions/${encodeURIComponent(session)}/movement`
  );
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

/**
 * The stretches cut to [from, to], for drawing and totals. The row before the
 * window (kept for `positionAt`) becomes a point on the window's edge, partway
 * to the next row, unless that step was a jump.
 */
export function clipStretches(all: readonly Stretch[], from: number, to: number): Stretch[] {
  const out: Stretch[] = [];
  for (const stretch of all) {
    const s = stretch.samples;
    const kept: Sample[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const b = s[i];
      if (b.time < from || b.time > to) continue;
      const a = s[i - 1];
      if (!kept.length && a && a.time < from && !isJump(a, b)) {
        const f = (from - a.time) / (b.time - a.time);
        kept.push({ time: from, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, action: ACTION_PING });
      }
      kept.push(b);
    }
    if (kept.length) out.push({ world: stretch.world, samples: kept });
  }
  return out;
}

/** A slider moment kept inside the window shown; null (the newest moment) stays null. */
export function clampMoment(cursor: number | null, from: number, to: number): number | null {
  return cursor === null ? null : Math.min(to, Math.max(from, cursor));
}

/**
 * What the record says about one moment:
 * - `observed`: a row at exactly that second;
 * - `estimated`: between two rows of a stretch, on the straight line between them;
 * - `unobserved`: between two rows too far apart to have walked (a teleport, or travel nobody saw);
 * - `stale`: after a stretch's last row, within `hold` seconds, before any logout or later row
 *   (the next ping may simply not have come yet);
 * - `none`: not seen then. `before` is the last observation earlier than the moment, if any.
 */
export type Inspection =
  | { kind: "observed"; world: string | null; sample: Sample }
  | { kind: "estimated"; world: string | null; x: number; z: number; before: Sample; after: Sample }
  | { kind: "unobserved"; world: string | null; before: Sample; after: Sample }
  | { kind: "stale"; world: string | null; before: Sample }
  | { kind: "none"; before: Sample | null };

export function inspect(all: readonly Stretch[], time: number, hold = 0): Inspection {
  let earlier: Sample | null = null;
  for (const [index, stretch] of all.entries()) {
    const s = stretch.samples;
    const first = s[0];
    const last = s[s.length - 1];
    if (time < first.time) break;
    if (time > last.time) {
      earlier = last;
      const next = all[index + 1]?.samples[0];
      if (time - last.time <= hold && last.action !== ACTION_LOGOUT && (!next || next.time > time)) {
        return { kind: "stale", world: stretch.world, before: last };
      }
      continue;
    }
    for (let i = 0; i < s.length; i += 1) {
      const a = s[i];
      if (a.time === time) return { kind: "observed", world: stretch.world, sample: a };
      const b = s[i + 1];
      if (b && a.time < time && time < b.time) {
        if (isJump(a, b)) return { kind: "unobserved", world: stretch.world, before: a, after: b };
        const f = (time - a.time) / (b.time - a.time);
        return { kind: "estimated", world: stretch.world, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, before: a, after: b };
      }
    }
  }
  return { kind: "none", before: earlier };
}

export type Position = {
  world: string | null;
  x: number;
  z: number;
  /** Recorded at that very second, rather than estimated or last seen. */
  exact: boolean;
  /** Past a stretch's last row: where they were last seen, at this time. */
  lastSeen?: number;
};

/** Where to draw a player's marker at `time`, or null when they were not seen then (see `inspect`). */
export function positionAt(all: readonly Stretch[], time: number, hold = 0): Position | null {
  const found = inspect(all, time, hold);
  switch (found.kind) {
    case "observed":
      return { world: found.world, x: found.sample.x, z: found.sample.z, exact: true };
    case "estimated":
      return { world: found.world, x: found.x, z: found.z, exact: false };
    case "unobserved":
      return { world: found.world, x: found.before.x, z: found.before.z, exact: false };
    case "stale":
      return { world: found.world, x: found.before.x, z: found.before.z, exact: false, lastSeen: found.before.time };
    default:
      return null;
  }
}

/** Every observation time, oldest first, for stepping to the previous or next one. */
export function observationTimes(all: readonly Stretch[]): number[] {
  const times = all.flatMap((stretch) => stretch.samples.map((s) => s.time));
  return [...new Set(times)].sort((a, b) => a - b);
}

/** The nearest observation strictly before (or after) `time`, or null. */
export function stepObservation(times: readonly number[], time: number, direction: -1 | 1): number | null {
  if (direction < 0) {
    for (let i = times.length - 1; i >= 0; i -= 1) if (times[i] < time) return times[i];
    return null;
  }
  for (const t of times) if (t > time) return t;
  return null;
}

/** [first, last] observation of each stretch: when the player was continuously seen. */
export function observedBands(all: readonly Stretch[]): [number, number][] {
  return all.map((stretch) => [stretch.samples[0].time, stretch.samples[stretch.samples.length - 1].time]);
}

/** Estimated seconds observed in each world: the stretches' spans, leaving out the gaps between them. */
export function timeByWorld(all: readonly Stretch[]): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  for (const stretch of all) {
    const s = stretch.samples;
    const span = s[s.length - 1].time - s[0].time;
    totals.set(stretch.world, (totals.get(stretch.world) ?? 0) + span);
  }
  return totals;
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

/**
 * A colour from old (violet) through magenta and red to new (orange) for a
 * moment in the window: hues the map's greens, browns, snow and sea do not use.
 */
export function ageColour(fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction));
  const hue = (275 + 125 * f) % 360;
  const light = 58 + 6 * f;
  return `hsl(${hue.toFixed(0)} 90% ${light.toFixed(0)}%)`;
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

export type ParsedTime = { time: number; error?: undefined } | { time?: undefined; error: string };

/**
 * A `datetime-local` value as Unix seconds, refusing local times the clocks
 * skip (spring forward) or pass twice (fall back) rather than guessing.
 */
export function parseLocalInput(value: string): ParsedTime {
  const minute = value.slice(0, 16);
  if (!minute) return { error: "Enter a date and time." };
  const time = fromLocalInput(minute);
  if (time === null) return { error: "That isn’t a date and time." };
  if (toLocalInput(time) !== minute) {
    return { error: "That time doesn’t exist here: the clocks went forward. Choose another time." };
  }
  if (toLocalInput(time - 3600) === minute || toLocalInput(time + 3600) === minute) {
    return { error: "That time happens twice here: the clocks went back. Choose a time outside that hour." };
  }
  return { time };
}

/** `UTC+01:00` for the browser's offset at a moment. */
export function utcOffset(at: number): string {
  const minutes = -new Date(at * 1000).getTimezoneOffset();
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** The browser's time zone and offset(s) over a span: `Europe/London (UTC+01:00)`. */
export function zoneLabel(since: number, until: number = since): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  const from = utcOffset(since);
  const to = utcOffset(until);
  return `${zone} (${from === to ? from : `${from} → ${to}`})`;
}

/** Parts of a local date; formatters are made per call so they follow the zone in force. */
function dateParts(at: number, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", options).formatToParts(new Date(at * 1000));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** `14:03`, or with seconds `14:03:18`, in local time. */
export function formatClock(at: number, seconds = false): string {
  const p = dateParts(at, { hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined, hourCycle: "h23" });
  return seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
}

/** `Tue 6 Oct` in local time. */
export function formatDay(at: number): string {
  const p = dateParts(at, { weekday: "short", day: "numeric", month: "short" });
  return `${p.weekday} ${p.day} ${p.month}`;
}

function formatDate(at: number): string {
  const p = dateParts(at, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** `Tue 6 Oct 2026, 14:03` in local time. */
export function formatMoment(at: number, seconds = false): string {
  return `${formatDate(at)}, ${formatClock(at, seconds)}`;
}

function sameLocalDay(a: number, b: number): boolean {
  return formatDate(a) === formatDate(b);
}

/** `Tue 6 Oct 2026, 12:00 → 13:00`, with the end's date too when it is another day. */
export function describeSpan(since: number, until: number): string {
  return `${formatMoment(since)} → ${sameLocalDay(since, until) ? formatClock(until) : formatMoment(until)}`;
}

const TICK_STEPS = [60, 300, 600, 900, 1800, 3600, 2 * 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 2 * 86400];

/** Round local-time tick marks for a timeline, at most about `most` of them. */
export function timelineTicks(since: number, until: number, most = 8): number[] {
  const span = Math.max(1, until - since);
  const step = TICK_STEPS.find((s) => span / s <= most) ?? TICK_STEPS[TICK_STEPS.length - 1];
  // Align to local time: a tick at 14:00, not 13:00 UTC shown as 14:00.
  const offset = -new Date(since * 1000).getTimezoneOffset() * 60;
  const first = Math.ceil((since + offset) / step) * step - offset;
  const ticks = [];
  for (let t = first; t <= until; t += step) ticks.push(t);
  return ticks;
}

/**
 * How a session ended, saying only what the record shows: a logout, a
 * player probably still online, or a last sighting with no logout recorded.
 */
export function sessionEndLabel(session: PlayerSession): string {
  switch (session.end_kind) {
    case "logout":
      return `Logged out ${formatClock(session.end!.time)}`;
    case "open":
      return `Probably online · last observed ${formatClock(session.last_observed.time)}`;
    case "last_observed":
      return `Last observed ${formatClock(session.last_observed.time)} · logout not recorded`;
    default:
      return "End unknown";
  }
}

/** `13:02 → 14:15`, the end being the logout or last sighting, or `13:02 → now` while open. */
export function sessionSpanLabel(session: PlayerSession): string {
  const start = session.start.time;
  if (session.end_kind === "open") return `${formatClock(start)} → now`;
  const end = session.end?.time ?? session.last_observed.time;
  return formatDay(start) === formatDay(end)
    ? `${formatClock(start)} → ${formatClock(end)}`
    : `${formatClock(start)} → ${formatDay(end)} ${formatClock(end)}`;
}
