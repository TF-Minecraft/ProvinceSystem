import type { CharacterEstate, EstateRecipient, WillResult } from "./api";

/** Why the server refused a will change made here. */
export function willResultMessage(result: WillResult | null): string | null {
  switch (result) {
    case "stale":
      return "Not saved: the will changed in game.";
    case "invalid heir":
      return "Not saved: that heir can’t inherit.";
    case "invalid":
      return "Not saved: the server doesn’t know this character.";
    case "character dead":
      return "Not saved: this character has died.";
    default:
      return null;
  }
}

/** The site's refusals, in words. */
export function willErrorMessage(detail: string): string {
  switch (detail) {
    case "will_changed":
      return "The will changed in game. Refresh and try again.";
    case "request_pending":
      return "A change is already waiting for the server.";
    case "character_not_alive":
      return "This character has died.";
    case "invalid_heir":
      return "That character can’t inherit.";
    default:
      return detail;
  }
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const moment = new Date(iso);
  return Number.isNaN(moment.getTime()) ? null : DATE.format(moment);
}

/** "Passes on 14 Oct 2026", "Passed on 14 Oct 2026", and so on. */
export function estateStatusLine(estate: CharacterEstate): string {
  switch (estate.status) {
    case "OPEN": {
      const due = formatDay(estate.due_at);
      return due ? `Passes on ${due}` : "Not passed on yet";
    }
    case "HELD":
      return "Held by staff";
    case "CANCELLED":
      return "Cancelled: brought back to life";
    case "DECIDED": {
      const decided = formatDay(estate.decided_at);
      return decided ? `Passed on ${decided}` : "Passed on";
    }
    case "REVERTED":
      return "Stopped by staff";
    default:
      return "";
  }
}

export function recipientLabel(recipient: EstateRecipient | undefined): string | null {
  if (!recipient) return null;
  switch (recipient.kind) {
    case "FROZEN":
      return "Held by staff";
    case "WAITING":
      return "Waiting for a guild leader";
    case "SENDER":
      return "Returned to senders";
    case "NONE":
      return "Nothing";
    default:
      return recipient.name || null;
  }
}

export const ESTATE_PARTS = [
  ["money", "Money"],
  ["property", "Property"],
  ["guild_locks", "Guild locks"],
  ["letters", "Letters"],
] as const;

export function formatDenars(cents: number): string {
  return (cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** What the estate moved, summed over every part of the server: "297 locks, 2 vehicles". */
export function estateMoved(estate: CharacterEstate): string | null {
  const totals = new Map<string, number>();
  for (const participant of Object.values(estate.participants || {})) {
    for (const [label, count] of Object.entries(participant?.counts || {})) {
      if (Number.isFinite(count) && count > 0) totals.set(label, (totals.get(label) ?? 0) + count);
    }
  }
  if (!totals.size) return null;
  // Labels arrive plural ("locks"); one of a kind drops the s.
  return [...totals]
    .map(([label, count]) => `${count} ${count === 1 && label.endsWith("s") ? label.slice(0, -1) : label}`)
    .join(", ");
}
