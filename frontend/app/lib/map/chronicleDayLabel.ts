/**
 * A stored day as a reader says it: `"2026-08-15"` → `"15 Aug 2026"`. Days are
 * UTC calendar dates, so they are formatted in UTC; read in the local zone, a
 * reader west of Greenwich would see the day before. Anything that is not a
 * date comes back as it was.
 */
export function formatChronicleDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
