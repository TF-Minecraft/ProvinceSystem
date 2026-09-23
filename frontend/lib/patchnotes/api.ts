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

async function fetchWeek(base: string, week: string): Promise<WeekNotes | null> {
  const res = await fetch(`${base}/patchnotes/weeks/${encodeURIComponent(week)}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body: unknown = await res.json();
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (row.week !== week || !Array.isArray(row.bullets)) return null;
  const bullets = row.bullets.map(readBullet).filter((bullet): bullet is PublicBullet => bullet !== null);
  return { week, label: weekLabel(week), bullets };
}

/** Approved weeks, newest first. Any failure becomes an unavailable page. */
export async function loadPublishedNotes(): Promise<PublishedNotes> {
  const base = apiBase();
  if (!base) return { ok: false };
  try {
    const res = await fetch(`${base}/patchnotes/weeks`, { cache: "no-store" });
    if (!res.ok) return { ok: false };
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || !Array.isArray((body as { weeks?: unknown }).weeks)) {
      return { ok: false };
    }
    const weeks = (body as { weeks: unknown[] }).weeks.filter(
      (week): week is string => typeof week === "string" && isWeekKey(week),
    );
    const notes = await Promise.all(weeks.map((week) => fetchWeek(base, week)));
    if (notes.some((week) => week === null)) return { ok: false };
    return {
      ok: true,
      weeks: notes.filter((week): week is WeekNotes => week !== null && week.bullets.length > 0),
    };
  } catch {
    return { ok: false };
  }
}
