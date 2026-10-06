/** Times from the CoreProtect API are Unix seconds. */

export function formatEpoch(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "";
  return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatAgo(seconds: number | null | undefined, now = Date.now() / 1000): string {
  if (seconds === null || seconds === undefined) return "Never";
  const elapsed = Math.max(0, now - seconds);
  if (elapsed < 60) return "Just now";
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)} min ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)} h ago`;
  if (elapsed < 86400 * 30) return `${Math.floor(elapsed / 86400)} d ago`;
  return formatEpoch(seconds);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "Unknown";
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "Under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
