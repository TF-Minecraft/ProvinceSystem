/**
 * Fantasy calendar birthday helpers (parity with RPCharacters AgeCalculator /
 * FantasyCalendar). Day-of-year offset is salted so the same age always yields
 * the same birthday for a given character salt.
 */

export type FantasyCalendarConfig = {
  year_offset?: number;
  era_suffix?: string;
};

const DEFAULT_YEAR_OFFSET = 1647;
const DEFAULT_ERA_SUFFIX = "AE";

/** FNV-1a 32-bit — stable across JS runtimes. */
export function hashSaltU32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysBetweenUtc(a: Date, b: Date): number {
  const ms =
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
    Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  return Math.floor(ms / 86_400_000);
}

function addDaysUtc(d: Date, days: number): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function resolveCalendarConfig(raw?: FantasyCalendarConfig | null): { yearOffset: number; eraSuffix: string } {
  const yearOffset = Number(raw?.year_offset);
  return {
    yearOffset: Number.isFinite(yearOffset) ? yearOffset : DEFAULT_YEAR_OFFSET,
    eraSuffix:
      raw?.era_suffix != null && String(raw.era_suffix).trim() ? String(raw.era_suffix).trim() : DEFAULT_ERA_SUFFIX,
  };
}

/** IRL today mapped into fantasy year space (same as FantasyCalendar.getCurrentDate). */
export function currentFantasyDate(cfg?: FantasyCalendarConfig | null, now: Date = new Date()): Date {
  const { yearOffset } = resolveCalendarConfig(cfg);
  return new Date(Date.UTC(now.getFullYear() - yearOffset, now.getMonth(), now.getDate()));
}

export function fromIsoFantasy(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{1,6})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/**
 * Pick a birthday ISO (YYYY-MM-DD in fantasy years) for ageYears.
 * Matches AgeCalculator.birthdayFromAge window; offset from salt+age.
 */
export function birthdayFromAge(
  ageYears: number,
  salt: string,
  cfg?: FantasyCalendarConfig | null,
  nowFantasy?: Date,
): string | null {
  if (!Number.isFinite(ageYears) || ageYears < 0) return null;
  const age = Math.trunc(ageYears);
  const now = nowFantasy ?? currentFantasyDate(cfg);
  const earliest = addDaysUtc(
    new Date(Date.UTC(now.getUTCFullYear() - (age + 1), now.getUTCMonth(), now.getUTCDate())),
    1,
  );
  const latest = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()));
  const daySpan = daysBetweenUtc(earliest, latest);
  if (daySpan < 0) {
    return toIsoFantasy(latest);
  }
  const offset = daySpan === 0 ? 0 : hashSaltU32(`${salt}:${age}`) % (daySpan + 1);
  return toIsoFantasy(addDaysUtc(earliest, offset));
}

/** Full years between birthday and now (AgeCalculator.computeAgeYears). */
export function ageFromBirthday(iso: string, cfg?: FantasyCalendarConfig | null, nowFantasy?: Date): number | null {
  const birthday = fromIsoFantasy(iso);
  if (!birthday) return null;
  const now = nowFantasy ?? currentFantasyDate(cfg);
  let years = now.getUTCFullYear() - birthday.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthday.getUTCMonth();
  const dayDiff = now.getUTCDate() - birthday.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years -= 1;
  }
  return Math.max(0, years);
}

export function toIsoFantasy(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function formatFantasyBirthday(
  iso: string | null | undefined,
  cfg?: FantasyCalendarConfig | null,
): string | null {
  const d = fromIsoFantasy(iso);
  if (!d) return null;
  const { eraSuffix } = resolveCalendarConfig(cfg);
  const yearLabel = eraSuffix ? `${d.getUTCFullYear()} ${eraSuffix}` : String(d.getUTCFullYear());
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${yearLabel}`;
}

/**
 * Parse fantasy display dates such as 30.10.351, 30/10/351, or 30/10/351 AE.
 * Also accepts ISO YYYY-MM-DD.
 */
export function parseBirthdayInput(input: string, cfg?: FantasyCalendarConfig | null): string | null {
  if (!input || !String(input).trim()) return null;
  let raw = String(input).trim().replace(/,/g, ".");
  const { eraSuffix } = resolveCalendarConfig(cfg);
  if (eraSuffix) {
    const escaped = eraSuffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    raw = raw.replace(new RegExp(`\\s*${escaped}\\s*$`, "i"), "").trim();
  }

  const asIso = fromIsoFantasy(raw);
  if (asIso) return toIsoFantasy(asIso);

  const parts = raw.split(/[./\s]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = Number(parts[2]);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return null;
  }
  const iso = `${year}-${pad2(month)}-${pad2(day)}`;
  return fromIsoFantasy(iso) ? iso : null;
}

/** Resolved birthday ISO: explicit override, else salted from age. */
export function resolvedBirthdayIso(
  ageRaw: string,
  salt: string,
  birthdayOverride: string | null | undefined,
  cfg?: FantasyCalendarConfig | null,
): string | null {
  if (birthdayOverride && fromIsoFantasy(birthdayOverride)) {
    return birthdayOverride;
  }
  const age = Number(ageRaw);
  if (!Number.isFinite(age) || age < 0 || !String(ageRaw).trim()) return null;
  return birthdayFromAge(age, salt || "default", cfg);
}

/** Display line for the age stepper when age is a valid number. */
export function fictionalBirthdayLabel(
  ageRaw: string,
  salt: string,
  cfg?: FantasyCalendarConfig | null,
  birthdayOverride?: string | null,
): string | null {
  const iso = resolvedBirthdayIso(ageRaw, salt, birthdayOverride, cfg);
  return formatFantasyBirthday(iso, cfg);
}
