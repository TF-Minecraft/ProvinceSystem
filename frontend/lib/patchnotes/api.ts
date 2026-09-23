import {
  isSectionName,
  isWeekKey,
  weekLabel,
  type PublicBullet,
  type WeekNotes,
} from "./notes";

export type PublishedNotes =
  | { ok: true; weeks: WeekNotes[] }
  | { ok: false };

const REQUEST_TIMEOUT_MS = 5000;

function apiBase(): string | null {
  const base = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/$/, "");
  return base || null;
}

function readBullet(value: unknown): PublicBullet | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.section !== "string" || typeof row.body !== "string") {
    return null;
  }
  if (!isSectionName(row.section) || row.body.trim() === "") return null;
  // A leaked review row must not be rendered, even if this route is public.
  if ("status" in row && row.status !== "approved") return null;
  if (typeof row.deny_reason === "string" && row.deny_reason.trim() !== "") return null;
  return { id: row.id, section: row.section, body: row.body };
}

function readWeek(value: unknown): WeekNotes | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.week !== "string" || !isWeekKey(row.week) || !Array.isArray(row.bullets)) return null;
  const bullets = row.bullets
    .map(readBullet)
    .filter((bullet): bullet is PublicBullet => bullet !== null);
  if (bullets.length === 0) return null;
  return { week: row.week, label: weekLabel(row.week), bullets };
}

/** Approved weeks, newest first. One request. Any failure becomes an unavailable page. */
export async function loadPublishedNotes(): Promise<PublishedNotes> {
  const base = apiBase();
  if (!base) return { ok: false };
  try {
    const res = await fetch(`${base}/patchnotes`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false };
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || !Array.isArray((body as { weeks?: unknown }).weeks)) {
      return { ok: false };
    }
    const weeks: WeekNotes[] = [];
    for (const entry of (body as { weeks: unknown[] }).weeks) {
      const week = readWeek(entry);
      if (!entry || typeof entry !== "object") return { ok: false };
      if (week) weeks.push(week);
    }
    return { ok: true, weeks };
  } catch {
    return { ok: false };
  }
}
