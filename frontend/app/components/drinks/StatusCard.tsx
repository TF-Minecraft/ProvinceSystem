"use client";

import type { DrinkSubmissionPublic } from "../../../lib/drinks/api";
import { formatLocal } from "../../../lib/skins/formatTime";

function statusMessage(row: DrinkSubmissionPublic): string {
  switch (row.status) {
    case "pending":
      return (
        "Submitted. Staff will review your recipe. You will get a Discord DM " +
        "when it is approved or denied."
      );
    case "denied":
      return row.deny_reason?.trim()
        ? `Denied: ${row.deny_reason.trim()}`
        : "Denied. No reason given.";
    case "pending_pack":
      return (
        "Approved. Waiting for the custom texture to be written to the pack."
      );
    case "approved":
      return "Approved. Your drink will be brewable after the next server apply.";
    case "applied":
      return "Live on the server. Brewable in BreweryX.";
    default:
      return row.status;
  }
}

type Props = {
  row: DrinkSubmissionPublic;
};

export default function StatusCard({ row }: Props) {
  const recipe = row.recipe || {};
  const color =
    typeof recipe.color === "string" ? recipe.color : null;

  return (
    <div className="mt-8 space-y-6">
      <p className="text-lg text-[var(--tfmc-cream)]">{statusMessage(row)}</p>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-[var(--tfmc-stone)]">Status</dt>
          <dd className="font-medium text-[var(--tfmc-cream)]">
            {row.status === "pending"
              ? "Awaiting approval"
              : row.status === "pending_pack"
                ? "Pending pack"
                : row.status === "approved"
                  ? "Approved"
                  : row.status === "applied"
                    ? "Live"
                    : row.status === "denied"
                      ? "Denied"
                      : row.status}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--tfmc-stone)]">Drink name</dt>
          <dd className="text-[var(--tfmc-cream)]">{row.display_name}</dd>
        </div>
        {color ? (
          <div>
            <dt className="text-[var(--tfmc-stone)]">Color</dt>
            <dd className="flex items-center gap-2 text-[var(--tfmc-cream)]">
              <span
                className="inline-block h-4 w-4 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)]"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              {color}
            </dd>
          </div>
        ) : null}
        {row.texture_id ? (
          <div>
            <dt className="text-[var(--tfmc-stone)]">Texture</dt>
            <dd className="break-all text-[var(--tfmc-mist)]">
              {row.texture_id}
              {row.new_texture ? " (new)" : " (reused)"}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[var(--tfmc-stone)]">Created</dt>
          <dd className="text-[var(--tfmc-mist)]">
            {formatLocal(row.created_at)}
          </dd>
        </div>
        {row.reviewed_at ? (
          <div>
            <dt className="text-[var(--tfmc-stone)]">Reviewed</dt>
            <dd className="text-[var(--tfmc-mist)]">
              {formatLocal(row.reviewed_at)}
            </dd>
          </div>
        ) : null}
        {row.applied_at ? (
          <div>
            <dt className="text-[var(--tfmc-stone)]">Applied</dt>
            <dd className="text-[var(--tfmc-mist)]">
              {formatLocal(row.applied_at)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[var(--tfmc-stone)]">Drink id</dt>
          <dd className="break-all text-[var(--tfmc-mist)]">{row.id}</dd>
        </div>
      </dl>
    </div>
  );
}
