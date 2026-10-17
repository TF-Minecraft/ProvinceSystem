"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AccountApiError } from "@/lib/account/api";
import { adminErrorMessage } from "@/lib/admin/api";
import { createCase, updateCase, type CaseInput, type PrecedentCase } from "@/lib/precedent/api";
import { caseParticipant, getPersonCases, type CaseSubject, type PersonCasePage } from "@/lib/precedent/people";
import { formatCreatedAt } from "@/lib/precedent/filter";
import LoadingSkeleton from "../shared/LoadingSkeleton";
import PrecedentCaseModal from "../precedent/PrecedentCaseModal";
import {
  buttonClass,
  errorClass,
  headingClass,
  mutedClass,
  pagerClass,
  panelClass,
  quietButtonClass,
  rowClass,
} from "./ui";

const LABEL = { case: "Case", warning: "Warning", warn: "Warning", ban: "Ban", unban: "Unban" };

export default function PersonCases({ subject, standalone = false }: { subject: CaseSubject; standalone?: boolean }) {
  const { playerUuid, discordId } = subject;
  const [data, setData] = useState<PersonCasePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [reloads, setReloads] = useState(0);
  const wanted = `${playerUuid ?? discordId}:${offset}:${reloads}`;
  const [answered, setAnswered] = useState<string | null>(null);
  const loading = answered !== wanted;
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PrecedentCase | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const participant = useMemo(() => (data ? caseParticipant(data.person) : undefined), [data]);

  useEffect(() => {
    let live = true;
    getPersonCases(playerUuid ? { playerUuid } : { discordId: discordId! }, offset)
      .then((page) => {
        if (live) {
          setData(page);
          setError(null);
        }
      })
      .catch((err) => {
        if (!live) return;
        if (err instanceof AccountApiError && (err.status === 401 || err.status === 403)) setData(null);
        setError(adminErrorMessage(err));
      })
      .finally(() => {
        if (live) setAnswered(wanted);
      });
    return () => {
      live = false;
    };
  }, [playerUuid, discordId, offset, reloads, wanted]);

  async function save(input: CaseInput) {
    setSaving(true);
    setSaveError(null);
    try {
      if (editing) await updateCase(editing.id, input);
      else await createCase(input);
      setOpen(false);
      setOffset(0);
      setReloads((n) => n + 1);
    } catch (err) {
      setSaveError(adminErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {standalone ? (
        <header className="mt-4">
          <Link href="/admin/players?view=discord" className={quietButtonClass}>
            ← All Discord accounts
          </Link>
          <h2 className="mt-2 font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
            {data?.person.discord_username
              ? `@${data.person.discord_username}`
              : (data?.person.name ?? "Discord account")}
          </h2>
          <p className={`mt-1 ${mutedClass}`}>
            Discord ID {discordId}
            {data?.person.player_uuid ? (
              <>
                {" "}
                ·{" "}
                <Link
                  href={`/admin/players/${data.person.player_uuid}?tab=cases`}
                  className="text-[var(--tfmc-accent)] hover:underline"
                >
                  {data.person.minecraft_name ?? "Minecraft profile"} →
                </Link>
              </>
            ) : data ? (
              " · No Minecraft account linked"
            ) : null}
          </p>
          <nav
            aria-label="Person"
            className="mt-5 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)]"
          >
            <span
              aria-current="page"
              className="inline-block border-b-2 border-[var(--tfmc-accent)] px-3 py-2 text-sm font-semibold text-[var(--tfmc-cream)]"
            >
              Cases
            </span>
          </nav>
        </header>
      ) : null}
      <section className={panelClass} aria-label="Cases" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className={headingClass}>Cases</h3>
            <p className={`mt-1 ${mutedClass}`}>Cases, warnings, ban history and staff notices for this account.</p>
          </div>
          {data ? (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setEditing(null);
                setSaveError(null);
                setOpen(true);
              }}
            >
              Log case
            </button>
          ) : null}
        </div>
        {data && !data.person.legacy_names_complete ? (
          <p role="status" className="mt-3 text-sm text-[#e8c48a]">
            Minecraft name history is unavailable. Some older name-only cases may be missing.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className={`mt-3 ${errorClass}`}>
            {error}{" "}
            <button
              type="button"
              className={quietButtonClass}
              disabled={loading}
              onClick={() => setReloads((n) => n + 1)}
            >
              Try again
            </button>
          </p>
        ) : null}
        {loading && !data ? <LoadingSkeleton variant="list" label="Loading cases…" className="mt-4" /> : null}
        {data ? (
          <>
            <p className="mt-4 text-xs text-[var(--tfmc-stone)]">
              {data.total} {data.total === 1 ? "record" : "records"}
            </p>
            {!data.entries.length && !error ? (
              <p className={`mt-3 ${mutedClass}`}>No cases recorded for this account.</p>
            ) : null}
            <ul className={`mt-2 ${rowClass}`}>
              {data.entries.map((row) => (
                <li key={row.id} className="py-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-[var(--tfmc-stone)]">
                    <span className="font-semibold uppercase tracking-wide text-[var(--tfmc-accent)]">
                      {LABEL[row.kind]}
                    </span>
                    <time dateTime={row.created_at ?? undefined}>{formatCreatedAt(row.created_at)}</time>
                    <span>{row.logged_by || "Staff member not recorded"}</span>
                    {row.matched_by === "name" ? <span className="text-[#e8c48a]">Older name match</span> : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold text-[var(--tfmc-cream)]">
                    {row.summary}
                  </p>
                  {row.punishment ? <p className={`mt-2 ${mutedClass}`}>Outcome: {row.punishment}</p> : null}
                  <details className={`mt-2 ${mutedClass}`}>
                    <summary className="cursor-pointer text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
                      Details
                    </summary>
                    {row.rule ? <p className="mt-2">Rule: {row.rule}</p> : null}
                    {row.ruling ? <p className="mt-2 whitespace-pre-wrap break-words">{row.ruling}</p> : null}
                    {row.players.length ? <p className="mt-2">Involved: {row.players.join(", ")}</p> : null}
                    {row.participants?.map((p, i) => (
                      <p key={i} className="mt-2 break-all text-xs text-[var(--tfmc-stone)]">
                        {p.name}: {p.discord_user_id ? `Discord ${p.discord_user_id}` : ""}
                        {p.discord_user_id && p.player_uuid ? " · " : ""}
                        {p.player_uuid ? `Minecraft ${p.player_uuid}` : ""}
                      </p>
                    ))}
                    <p className="mt-2 font-mono text-xs text-[var(--tfmc-stone)]">{row.case_id ?? row.id}</p>
                    {row.case_id ? (
                      <button
                        type="button"
                        className={`mt-2 ${quietButtonClass}`}
                        onClick={() => {
                          setEditing({ ...row, id: row.case_id!, logged_by: row.logged_by ?? "" });
                          setSaveError(null);
                          setOpen(true);
                        }}
                      >
                        Edit case
                      </button>
                    ) : null}
                  </details>
                </li>
              ))}
            </ul>
            {data.total > data.limit ? (
              <div className="mt-4 flex items-center gap-3 text-sm text-[var(--tfmc-stone)]">
                <button
                  type="button"
                  className={pagerClass}
                  disabled={loading || data.offset === 0}
                  onClick={() => setOffset(Math.max(0, data.offset - data.limit))}
                >
                  Previous
                </button>
                <span>
                  Page {Math.floor(data.offset / data.limit) + 1} of {Math.ceil(data.total / data.limit)}
                </span>
                <button
                  type="button"
                  className={pagerClass}
                  disabled={loading || data.offset + data.limit >= data.total}
                  onClick={() => setOffset(data.offset + data.limit)}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
      <PrecedentCaseModal
        open={open}
        initial={editing}
        subject={participant}
        knownPlayers={[]}
        saving={saving}
        error={saveError}
        onClose={() => {
          if (!saving) setOpen(false);
        }}
        onSave={(input) => void save(input)}
      />
    </>
  );
}
