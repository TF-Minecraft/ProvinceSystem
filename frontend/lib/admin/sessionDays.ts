import type { PlayerSession } from "./api";
import { formatClock, formatDay } from "./movement";
import { formatDuration } from "./time";

/** A local calendar day, `2026-10-7`, so that days compare across years and clock changes. */
function dayKey(at: number): string {
  const d = new Date(at * 1000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function yearOf(at: number): number {
  return new Date(at * 1000).getFullYear();
}

/** `Today`, `Yesterday`, else `Sun 29 Sep`, with the year when it is not this year. */
export function dayLabel(at: number, now: number): string {
  const key = dayKey(at);
  if (key === dayKey(now)) return "Today";
  const yesterday = new Date(now * 1000);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday.getTime() / 1000)) return "Yesterday";
  return yearOf(at) === yearOf(now) ? formatDay(at) : `${formatDay(at)} ${yearOf(at)}`;
}

export type SessionDay = { key: string; label: string; sessions: PlayerSession[] };

/**
 * Sessions grouped under the local day they began, newest first. A session past
 * midnight stays under its login day; its row names the day it ended. Groups
 * are rebuilt from every loaded page, so a day split by a page joins up.
 */
export function groupByDay(sessions: PlayerSession[], now: number): SessionDay[] {
  const days = new Map<string, SessionDay>();
  for (const session of sessions) {
    const key = dayKey(session.start.time);
    let day = days.get(key);
    if (!day) {
      day = { key, label: dayLabel(session.start.time, now), sessions: [] };
      days.set(key, day);
    }
    day.sessions.push(session);
  }
  return [...days.values()];
}

/** A clock time, led by its day (and year) when that differs from `from`. */
function clockAfter(at: number, from: number): string {
  if (dayKey(at) === dayKey(from)) return formatClock(at);
  const day = yearOf(at) === yearOf(from) ? formatDay(at) : `${formatDay(at)} ${yearOf(at)}`;
  return `${day} ${formatClock(at)}`;
}

export type SessionRow = {
  start: string;
  /** The logout time, `now` while open, or `?` when no logout was recorded. */
  end: string;
  duration: string | null;
  /** Said only when the session did not end with a recorded logout. */
  note: string | null;
};

export function sessionRow(session: PlayerSession): SessionRow {
  const from = session.start.time;
  const length = session.duration_seconds;
  const start = formatClock(from);
  switch (session.end_kind) {
    case "logout":
      return { start, end: clockAfter(session.end!.time, from), duration: formatDuration(length), note: null };
    case "open":
      // A guess from a recent sighting, and the page does not refresh.
      return { start, end: "now", duration: length === null ? null : `${formatDuration(length)} so far`,
               note: "Probably online" };
    case "last_observed":
      // A crash or unclean stop writes no logout; the last ping is a lower bound, not the end.
      return {
        start,
        end: "?",
        duration: length === null ? null : `at least ${formatDuration(length)}`,
        note: session.end ? `No logout recorded · last seen ${clockAfter(session.end.time, from)}` : "No logout recorded",
      };
    default:
      return { start, end: "?", duration: null, note: "End unknown" };
  }
}
