import { isSectionName, isWeekKey, weekLabel, type PublicBullet, type WeekNotes } from "./notes";

export type StaffPreview = WeekNotes & { expiresAt: string };

/** A staff test note. Review fields are dropped, and a deny reason hides the line. */
export function readStaffPreview(value: unknown): StaffPreview | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.week !== "string" || !isWeekKey(row.week) || !Array.isArray(row.bullets)) return null;
  if (typeof row.expires_at !== "string" || row.expires_at.trim() === "") return null;
  const bullets: PublicBullet[] = [];
  for (const entry of row.bullets) {
    if (!entry || typeof entry !== "object") continue;
    const bullet = entry as Record<string, unknown>;
    if (typeof bullet.deny_reason === "string" && bullet.deny_reason.trim() !== "") continue;
    if (typeof bullet.id !== "string" || typeof bullet.section !== "string" || typeof bullet.body !== "string") {
      continue;
    }
    if (!isSectionName(bullet.section) || bullet.body.trim() === "") continue;
    bullets.push({ id: bullet.id, section: bullet.section, body: bullet.body });
  }
  if (bullets.length === 0) return null;
  return { week: row.week, label: weekLabel(row.week), bullets, expiresAt: row.expires_at };
}
