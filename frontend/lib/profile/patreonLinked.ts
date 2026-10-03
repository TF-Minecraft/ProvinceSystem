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
  const result = (status && results[status]) || {
    title: "Link result unavailable",
    message: "Return to your profile to check your supporter status.",
  };
  if (status === "ok" && tier && tierNames[tier]) {
    return {
      ...result,
      message: `Your Patreon is linked and your ${tierNames[tier]} supporter perks are ready.`,
    };
  }
  return result;
}
