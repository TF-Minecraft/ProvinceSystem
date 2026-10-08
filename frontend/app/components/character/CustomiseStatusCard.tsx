"use client";

import type { LoreItemRow } from "../../../lib/characters/api";

function customiseState(item: LoreItemRow): string {
  const fromRow = String(item.state || "").trim().toLowerCase();
  if (fromRow) return fromRow;
  return String(item.draft?.state || "draft").trim().toLowerCase() || "draft";
}

function submissionStatus(item: LoreItemRow): string {
  return (
    String(item.draft?.submission_status || "").trim().toLowerCase() || ""
  );
}

function statusMessage(item: LoreItemRow): string {
  const state = customiseState(item);
  const sub = submissionStatus(item);
  const deny = item.draft?.deny_reason?.trim() || "";
  if (state === "pending_skin") {
    if (sub === "approved") {
      return (
        "Your skin was approved. It will be live within 24 hours. " +
        "After that, claim the kit in-game."
      );
    }
    return (
      "Awaiting staff approval for your custom skin. It can take a few minutes " +
      "to enter review. You will get a Discord DM when it is approved or denied."
    );
  }
  switch (state) {
    case "ready":
      return "Item ready. Claim the kit in-game when available.";
    case "denied":
      return deny
        ? `Denied: ${deny}`
        : "Denied. No reason given. Edit again to submit a different skin.";
    case "applied":
      return "Live in-game.";
    case "draft":
      return "Nothing submitted yet.";
    default:
      return state;
  }
}

type Props = {
  item: LoreItemRow;
};

export default function CustomiseStatusCard({ item }: Props) {
  const previewName =
    item.preview?.display_name?.trim() ||
    item.draft?.display_name?.trim() ||
    item.base_preview?.display_name ||
    "Item";

  return (
    <div className="mt-8 space-y-6">
      <p className="text-lg text-[var(--tfmc-cream)]">{statusMessage(item)}</p>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-[var(--tfmc-stone)]">Item</dt>
          <dd className="text-[var(--tfmc-cream)]">{previewName}</dd>
        </div>
      </dl>
    </div>
  );
}
