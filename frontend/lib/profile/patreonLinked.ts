import { getApiBase } from "../site/api";

export type PendingPatreonLink = {
  target_kind: "discord" | "minecraft";
  target_name: string;
  patreon_name: string;
};

export const confirmationCopy = {
  title: "Confirm Patreon link",
  warning: "Continue only if this Discord or Minecraft account is yours. If someone else sent you this link, cancel it.",
};

export function confirmationToken(fragment: string): string | null {
  return new URLSearchParams(fragment.replace(/^#/, "")).get("confirm");
}

async function linkRequest(action: "pending" | "confirm" | "cancel", token: string): Promise<unknown> {
  const response = await fetch(`${getApiBase()}/patreon/link/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not finish Patreon linking");
  return response.json();
}

export async function getPendingPatreonLink(token: string): Promise<PendingPatreonLink | null> {
  const data = await linkRequest("pending", token);
  if (data && typeof data === "object") {
    if ("status" in data && data.status === "expired") return null;
    const pending = data as Partial<PendingPatreonLink>;
    if ((pending.target_kind === "discord" || pending.target_kind === "minecraft") &&
        typeof pending.target_name === "string" && typeof pending.patreon_name === "string") {
      return pending as PendingPatreonLink;
    }
  }
  throw new Error("Invalid pending Patreon link");
}

export async function finishPatreonLink(action: "confirm" | "cancel", token: string): Promise<PatreonLinkedResult> {
  const data = await linkRequest(action, token);
  const result = data && typeof data === "object" ? data as { status?: unknown; tier?: unknown } : {};
  const status = typeof result.status === "string" ? result.status : "error";
  return getPatreonLinkedResult(action === "cancel" && status === "ok" ? "denied" : status,
    typeof result.tier === "string" ? result.tier : null);
}

export type PatreonLinkedResult = {
  title: string;
  message: string;
};

const tierNames: Record<string, string> = {
  noble: "Noble",
  gilded: "Gilded",
  ascended: "Ascended",
};

const results: Record<string, PatreonLinkedResult> = {
  ok: {
    title: "You’re all set",
    message: "Your Patreon is linked and your supporter perks are ready.",
  },
  not_a_member: {
    title: "Patreon linked",
    message: "Your account is linked, but there’s no active supporter tier yet.",
  },
  already_linked: {
    title: "This Patreon is already linked",
    message: "That Patreon account is linked to another player. Contact staff if you need help.",
  },
  relink_cooldown: {
    title: "Please wait before linking again",
    message: "This Patreon account was linked to another player recently. Contact staff if you need help.",
  },
  expired: {
    title: "Link expired",
    message: "That link has expired. Return to your profile and try again.",
  },
  denied: {
    title: "Link not completed",
    message: "Patreon wasn’t connected. You can try again from your profile.",
  },
  error: {
    title: "Something went wrong",
    message: "We couldn’t finish linking Patreon. Please try again from your profile.",
  },
};

export function getPatreonLinkedResult(
  status: string | null,
  tier: string | null
): PatreonLinkedResult {
  const result = (status && Object.prototype.hasOwnProperty.call(results, status) && results[status]) || {
    title: "Link result unavailable",
    message: "Return to your profile to check your supporter status.",
  };
  if (status === "ok" && tier && Object.prototype.hasOwnProperty.call(tierNames, tier)) {
    return {
      ...result,
      message: `Your Patreon is linked and your ${tierNames[tier]} supporter perks are ready.`,
    };
  }
  return result;
}
