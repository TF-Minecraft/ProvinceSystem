/** Format API UTC ISO (...Z) for display in the browser's local timezone. */

export function formatLocal(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return iso;
  }
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Coarse remaining time until expiry, e.g. "in 29 days", "in 2h", "in 45m", "expired". */
export function formatExpiresIn(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const end = Date.parse(iso);
  if (Number.isNaN(end)) {
    return iso;
  }
  const ms = end - Date.now();
  if (ms <= 0) {
    return "expired";
  }
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 48) {
    return `in ${Math.floor(hours / 24)} days`;
  }
  if (hours >= 1) {
    return `in ${hours}h`;
  }
  const minutes = Math.max(1, Math.floor(ms / (60 * 1000)));
  return `in ${minutes}m`;
}
