/** Player-facing patch note lines. Review fields never belong on this type. */

export type PublicBullet = {
  id: string;
  section: string;
  body: string;
};

export type WeekNotes = {
  week: string;
  label: string;
  bullets: PublicBullet[];
};

export const SECTION_ORDER = ["new", "fixed", "adjusted", "technical"] as const;

export type SectionName = (typeof SECTION_ORDER)[number];

export const SECTION_LABELS: Record<SectionName, string> = {
  new: "New",
  fixed: "Fixed",
  adjusted: "Adjusted",
  technical: "Technical",
};

const WEEK_RE = /^(\d{4})-W(\d{2})$/;

export function isWeekKey(value: string): boolean {
  const match = WEEK_RE.exec(value);
  if (!match) return false;
  const week = Number(match[2]);
  return week >= 1 && week <= 53;
}

/** Monday of an ISO week, in UTC. */
export function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const isoWeekday = jan4.getUTCDay() || 7;
  const weekOneMonday = Date.UTC(year, 0, 4 - isoWeekday + 1);
  return new Date(weekOneMonday + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}

export function weekLabel(week: string): string {
  const match = WEEK_RE.exec(week);
  if (!match) return week;
  const monday = isoWeekMonday(Number(match[1]), Number(match[2]));
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monday);
  return `Week of ${formatted}`;
}

export function isSectionName(value: string): value is SectionName {
  return (SECTION_ORDER as readonly string[]).includes(value);
}

export function groupBullets(bullets: readonly PublicBullet[]): Record<SectionName, PublicBullet[]> {
  const groups: Record<SectionName, PublicBullet[]> = {
    new: [],
    fixed: [],
    adjusted: [],
    technical: [],
  };
  for (const bullet of bullets) {
    if (isSectionName(bullet.section)) {
      groups[bullet.section].push(bullet);
    }
  }
  return groups;
}
