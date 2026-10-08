import Link from "next/link";
import { formatAgo } from "../../../../lib/admin/time";
import {
  expiryLabel,
  lpErrorMessage,
  shortContextLabel,
  STATUS_LABELS,
  type LpChange,
  type LpRights,
  type LpStatus,
} from "../../../../lib/admin/luckperms";
import { roleLabel } from "../../../../lib/admin/api";
import { chipClass, mutedClass, rowClass, warnClass } from "./ui";

function seconds(stamp: string | null): number | null {
  return stamp ? Date.parse(stamp) / 1000 : null;
}

/** Where the data comes from, how fresh it is, and whether changes can be made. */
export function StatusLine({ status, rights }: { status: LpStatus; rights: LpRights }) {
  if (!status.has_snapshot) {
    return (
      <p className={`mt-3 ${warnClass}`} role="status">
        No server has sent LuckPerms data to this site yet. It appears once TFMCWeb’s LuckPerms bridge is on.
      </p>
    );
  }
  const checked = seconds(status.checked_at);
  const stale = checked !== null && Date.now() / 1000 - checked > 180;
  return (
    <p className={`mt-3 ${stale ? warnClass : mutedClass}`} role="status">
      LuckPerms from {status.server ?? "the server"}, checked {formatAgo(checked).toLowerCase()}.{" "}
      {rights.read_only
        ? "This site only shows ranks; change them on the main site."
        : status.applying
          ? "Changes apply within seconds."
          : "No server is applying changes right now, so nothing can be changed."}
    </p>
  );
}

export function GroupChip({
  name,
  contexts = {},
  expiry = 0,
  href = true,
  muted = false,
}: {
  name: string;
  contexts?: Record<string, string[]>;
  expiry?: number;
  href?: boolean;
  muted?: boolean;
}) {
  const extra = [shortContextLabel(contexts), expiryLabel(expiry)].filter(Boolean).join(" · ");
  const body = (
    <>
      {name}
      {extra ? <span className="text-[var(--tfmc-stone)]">({extra})</span> : null}
    </>
  );
  const className = muted ? `${chipClass} opacity-60` : chipClass;
  if (!href) return <span className={className}>{body}</span>;
  return (
    <Link href={`/admin/ranks/groups/${encodeURIComponent(name)}`} className={`${className} hover:border-[var(--tfmc-accent)]`}>
      {body}
    </Link>
  );
}

const STATUS_TONE: Record<LpChange["status"], string> = {
  pending: "text-[var(--tfmc-mist)]",
  sent: "text-[var(--tfmc-mist)]",
  applied: "text-[#9fd59f]",
  failed: "text-[#e8a0a0]",
  expired: "text-[var(--tfmc-stone)]",
  unknown: "text-[#e8c48a]",
};

function targetHref(change: LpChange): string | null {
  if (change.target_type === "user") return `/admin/ranks/players/${change.target}`;
  if (change.target_type === "group") return `/admin/ranks/groups/${encodeURIComponent(change.target)}`;
  return null;
}

export function ChangeHistory({ changes, showTarget = false }: { changes: LpChange[]; showTarget?: boolean }) {
  if (!changes.length) return <p className={`mt-3 ${mutedClass}`}>No changes made from the website yet.</p>;
  return (
    <ul className={`mt-3 ${rowClass}`}>
      {changes.map((change) => {
        const href = targetHref(change);
        const label = change.target_name ?? change.target;
        return (
          <li key={change.id} className="py-2 text-sm">
            <p className="text-[var(--tfmc-cream)]">
              {showTarget ? (
                <>
                  {href ? (
                    <Link href={href} className="font-semibold hover:text-[var(--tfmc-accent)]">
                      {label}
                    </Link>
                  ) : (
                    <span className="font-semibold">{change.target_type} {label}</span>
                  )}
                  {": "}
                </>
              ) : null}
              <span className="font-mono text-xs">{change.description}</span>
            </p>
            <p className="text-xs text-[var(--tfmc-stone)]">
              <span className={STATUS_TONE[change.status]}>
                {STATUS_LABELS[change.status]}
                {change.error && change.status !== "expired" ? ` (${lpErrorMessage(change.error)})` : ""}
              </span>
              {" · "}
              {change.actor_name ? `@${change.actor_name}` : "someone"}
              {change.actor_role ? ` (${roleLabel(change.actor_role)})` : ""} · {formatAgo(seconds(change.created_at)).toLowerCase()} · “
              {change.reason}”
            </p>
          </li>
        );
      })}
    </ul>
  );
}
