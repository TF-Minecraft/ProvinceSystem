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
