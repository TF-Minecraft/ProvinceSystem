import {
  isSectionName,
  isWeekKey,
  weekLabel,
  type PublicBullet,
  type WeekNotes,
} from "./notes";

export type PublishedNotes =
  | { ok: true; weeks: WeekNotes[]; hasMore: boolean }
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
  return {
    id: row.id,
    section: row.section,
    body: row.body,
    ...(typeof row.topic === "string" && row.topic.trim() !== "" ? { topic: row.topic } : {}),
    ...(row.highlight === true ? { highlight: true } : {}),
  };
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

export type PublishedWeek =
  | { ok: true; week: WeekNotes }
  | { ok: false; missing: boolean };

export type PublishedWeekIndex =
  | { ok: true; weeks: { week: string; label: string }[] }
  | { ok: false };

/** Weeks that have published notes, newest first. The index does not need the lines. */
export async function loadPublishedWeekIndex(): Promise<PublishedWeekIndex> {
  const base = apiBase();
  if (!base) return { ok: false };
  try {
    const res = await fetch(`${base}/patchnotes/weeks`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false };
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || !Array.isArray((body as { weeks?: unknown }).weeks)) {
      return { ok: false };
    }
    const weeks: { week: string; label: string }[] = [];
    for (const entry of (body as { weeks: unknown[] }).weeks) {
      if (typeof entry !== "string" || !isWeekKey(entry)) return { ok: false };
      weeks.push({ week: entry, label: weekLabel(entry) });
    }
    return { ok: true, weeks };
  } catch {
    return { ok: false };
  }
}

/** Approved weeks, newest first. One bounded request. Any failure becomes an unavailable page. */
export async function loadPublishedNotes(options?: {
  limit?: number;
  before?: string;
}): Promise<PublishedNotes> {
  const base = apiBase();
  if (!base) return { ok: false };
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  const query = params.toString();
  try {
    const res = await fetch(query ? `${base}/patchnotes?${query}` : `${base}/patchnotes`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false };
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || !Array.isArray((body as { weeks?: unknown }).weeks)) {
      return { ok: false };
    }
    const record = body as { weeks: unknown[]; has_more?: unknown };
    const weeks: WeekNotes[] = [];
    for (const entry of record.weeks) {
      if (!entry || typeof entry !== "object") return { ok: false };
      const week = readWeek(entry);
      if (week) weeks.push(week);
    }
    return { ok: true, weeks, hasMore: record.has_more === true };
  } catch {
    return { ok: false };
  }
}

/** One published week. A bad key or an empty week is missing; other failures leave the page unavailable. */
export async function loadPublishedWeek(week: string): Promise<PublishedWeek> {
  if (!isWeekKey(week)) return { ok: false, missing: true };
  const base = apiBase();
  if (!base) return { ok: false, missing: false };
  try {
    const res = await fetch(`${base}/patchnotes/weeks/${week}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 400 || res.status === 404) return { ok: false, missing: true };
    if (!res.ok) return { ok: false, missing: false };
    const body: unknown = await res.json();
    const notes = readWeek(body);
    if (!notes) return { ok: false, missing: true };
    return { ok: true, week: notes };
  } catch {
    return { ok: false, missing: false };
  }
}
