import type { ActivityEntry } from "./api";
import { dayKey, dayLabel } from "./sessionDays";

/** Block changes of the same thing within this many seconds, end to end, share one row. */
export const RUN_SECONDS = 60;

/** One row: a single entry, or a run of matching block changes (newest first). */
export type ActivityRow = { key: string; entries: ActivityEntry[] };

export type ActivityDay = { key: string; label: string; rows: ActivityRow[] };

export type WorldNames = { serverLabel?: string | null; mapWorld?: string | null };

/** What the row names: the structured name when the server sent one. */
export function targetName(entry: ActivityEntry): string | null {
  return entry.target_info?.name ?? entry.target;
}

/** `Vardera` for the map's world, `Nether`/`The End` for its other dimensions, else the folder name. */
export function placeName(world: string | null, names: WorldNames): string {
  if (!world) return "Unknown world";
  const map = names.mapWorld;
  if (map && world === map) return names.serverLabel || world;
  if (map && world === `${map}_nether`) return "Nether";
  if (map && world === `${map}_the_end`) return "The End";
  return world;
}

function runKey(entry: ActivityEntry): string | null {
  if (entry.kind !== "block") return null;
  const info = entry.target_info;
  const what = info ? `${info.source}|${info.id ?? ""}|${info.source_id ?? ""}|${info.name}` : entry.target ?? "";
  return [entry.verb, what, entry.world ?? "", entry.rolled_back ?? ""].join("\u0000");
}

/**
 * Rows for every loaded entry, in order. Only placing or breaking blocks
 * merges: the same block, world and rollback state, on one local day, and
 * no more than RUN_SECONDS from the run's newest to its oldest. Rebuilt from
 * all loaded pages, so a run split by a page joins up when the next arrives.
 */
export function groupRuns(entries: ActivityEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let open: { row: ActivityRow; key: string } | null = null;
  for (const entry of entries) {
    const key = runKey(entry);
    if (open && key && key === open.key) {
      const newest = open.row.entries[0];
      if (newest.time - entry.time <= RUN_SECONDS && dayKey(newest.time) === dayKey(entry.time)) {
        open.row.entries.push(entry);
        continue;
      }
    }
    const row = { key: entry.id, entries: [entry] };
    rows.push(row);
    open = key ? { row, key } : null;
  }
  return rows;
}

/** Rows under the local day of their newest entry, newest day first. */
export function groupActivity(entries: ActivityEntry[], now: number): ActivityDay[] {
  const days = new Map<string, ActivityDay>();
  for (const row of groupRuns(entries)) {
    const at = row.entries[0].time;
    const key = dayKey(at);
    let day = days.get(key);
    if (!day) {
      day = { key, label: dayLabel(at, now), rows: [] };
      days.set(key, day);
    }
    day.rows.push(row);
  }
  return [...days.values()];
}
