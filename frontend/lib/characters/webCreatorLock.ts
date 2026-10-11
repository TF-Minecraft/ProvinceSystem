/** Why the web creator is locked, or "" when it's open. */
export function webCreatorLockLabel(allowed: boolean | undefined, minGroupId: string | undefined): string {
  if (allowed !== false) return "";
  const minGroup = (minGroupId || "").trim();
  const rank = minGroup ? minGroup.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "donator";
  return `Needs ${rank} rank or higher. Just ranked up? Join the server once, then refresh.`;
}
