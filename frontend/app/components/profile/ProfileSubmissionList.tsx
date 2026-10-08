"use client";

import Link from "next/link";
import type {
  ProfileDrinkSubmission,
  ProfileSkinSubmission,
} from "../../../lib/profile/api";
import { formatLocal } from "../../../lib/skins/formatTime";

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "denied" || s === "rejected") return "text-[#e8a0a0]";
  if (s === "pending") return "text-[var(--tfmc-mist)]";
  return "text-[var(--tfmc-stone)]";
}

type Props =
  | { kind: "skins"; rows: ProfileSkinSubmission[] }
  | { kind: "drinks"; rows: ProfileDrinkSubmission[] };

export default function ProfileSubmissionList({ kind, rows }: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--tfmc-mist)]">
        {kind === "skins" ? "No skins yet." : "No drinks yet."}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] px-3 py-2"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link
              href={`/${kind}/${encodeURIComponent(row.id)}`}
              className="font-medium text-[var(--tfmc-cream)] hover:underline"
            >
              {row.display_name || row.slug}
            </Link>
            <span
              className={`text-xs font-medium uppercase tracking-wide ${statusClass(row.status)}`}
            >
              {row.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--tfmc-stone)]">
            {formatLocal(row.created_at)}
          </p>
          {row.deny_reason ? (
            <p className="mt-1 text-xs text-[#e8a0a0]">{row.deny_reason}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
