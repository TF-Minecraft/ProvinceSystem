/** Starting a skin or drink from Profile, in place of a /token create code. */

export type StartRefusal = "discord" | "join_server" | "rank" | "cooldown";

export type StartAllowance = {
  can_start: boolean;
  reason: StartRefusal | null;
  /** When the shared skin and drink cooldown ends; set only for "cooldown". */
  next_at: string | null;
};

export type StartAllowances = { skin: StartAllowance; drink: StartAllowance };

const REASONS: readonly StartRefusal[] = ["discord", "join_server", "rank", "cooldown"];

function readAllowance(raw: unknown): StartAllowance | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const reason = REASONS.find((r) => r === value.reason) ?? null;
  return {
    can_start: value.can_start === true,
    reason,
    next_at: typeof value.next_at === "string" ? value.next_at : null,
  };
}

/** Null when the API predates starting from Profile; the page then offers codes only. */
export function readAllowances(raw: unknown): StartAllowances | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const skin = readAllowance(value.skin);
  const drink = readAllowance(value.drink);
  return skin && drink ? { skin, drink } : undefined;
}

export class StartRefusedError extends Error {
  reason: StartRefusal;
  nextAt: string | null;

  constructor(reason: StartRefusal, nextAt: string | null) {
    super(reason);
    this.name = "StartRefusedError";
    this.reason = reason;
    this.nextAt = nextAt;
  }
}

/** The 409 the start routes send when the rules say no. */
export function readStartRefusal(status: number, data: unknown): StartRefusedError | null {
  if (status !== 409 || !data || typeof data !== "object") return null;
  const allowance = readAllowance((data as { detail?: unknown }).detail);
  return allowance?.reason ? new StartRefusedError(allowance.reason, allowance.next_at) : null;
}

/** "3 days", "5 hours" or "1 hour" until the given time; never less than an hour. */
export function timeUntil(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  if (hours < 48) return hours === 1 ? "1 hour" : `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}
