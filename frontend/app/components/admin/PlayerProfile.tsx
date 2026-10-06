"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountApiError } from "../../../lib/account/api";
import {
  adminErrorMessage,
  coreProtectMessage,
  getPlayer,
  getPlayerActivity,
  getPlayerSessions,
  roleLabel,
  type ActivityEntry,
  type PlayerProfile as Profile,
  type PlayerSession,
  type WorldPoint,
} from "../../../lib/admin/api";
import { formatLocal } from "../../../lib/skins/formatTime";
import { formatAgo, formatDuration, formatEpoch } from "../../../lib/admin/time";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";

const panelClass =
  "mt-6 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_28%,transparent)] p-5";
const headingClass = "font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]";
const moreClass =
  "mt-3 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] px-3 py-1.5 text-sm text-[var(--tfmc-cream)] hover:border-[var(--tfmc-accent)] disabled:opacity-40";
const mutedClass = "text-sm text-[var(--tfmc-mist)]";
const errorClass = "mt-3 text-sm text-[#e8a0a0]";

export const KIND_LABELS: Record<string, string> = {
  block: "Blocks",
  click: "Clicks",
  kill: "Kills",
  spawn: "Spawns",
  container: "Containers",
  item: "Items",
  entity: "Entities",
  sign: "Signs",
  skill: "Skills",
  command: "Commands",
  session: "Logins",
  chat: "Chat",
};

type Load = { kind: "loading" } | { kind: GateKind } | { kind: "failed"; message: string } | { kind: "ready"; profile: Profile };

export default function PlayerProfile({ uuid }: { uuid: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    getPlayer(uuid)
      .then((profile) => live && setLoad({ kind: "ready", profile }))
      .catch((err) => {
        if (!live) return;
        const status = err instanceof AccountApiError ? err.status : 0;
        setLoad(status === 400 || status === 404 ? { kind: "failed", message: adminErrorMessage(err) } : { kind: gateKind(err) });
      });
    return () => {
      live = false;
    };
  }, [uuid]);

  if (load.kind === "loading") return <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>;
  if (load.kind === "failed") {
    return (
      <p className="mt-6 text-[var(--tfmc-mist)]" role="alert">
        {load.message}
      </p>
    );
  }
  if (load.kind !== "ready") return <StaffGateMessage kind={load.kind} />;

  const { profile } = load;
  const notice = coreProtectMessage(profile.coreprotect);
  const label = profile.coreprotect.server_label;

  return (
    <>
      <header className="mt-6">
        <h2 className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
          {profile.minecraft_name ?? "Unknown name"}
        </h2>
        <p className="mt-1 font-mono text-xs text-[var(--tfmc-stone)]">{profile.uuid}</p>
        <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
          {profile.online ? "Seen just now" : `Last seen ${formatAgo(profile.last_seen).toLowerCase()}`}
          {profile.first_seen ? ` · first seen ${formatEpoch(profile.first_seen)}` : ""}
          {label ? ` · ${label}` : ""}
        </p>
        {profile.past_names.length ? (
          <p className="mt-1 text-sm text-[var(--tfmc-stone)]">
            Previously {profile.past_names.map((n) => n.name).join(", ")}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 text-sm text-[#e8c48a]" role="status">
            {notice}
          </p>
        ) : null}
      </header>

      <section className={panelClass} aria-label="Discord and website">
        <h3 className={headingClass}>Discord and website</h3>
        {profile.discord ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-[var(--tfmc-stone)]">Discord</dt>
            <dd className="text-[var(--tfmc-cream)]">
              {profile.discord.discord_username ? `@${profile.discord.discord_username}` : profile.discord.discord_user_id}
            </dd>
            <dt className="text-[var(--tfmc-stone)]">Linked</dt>
            <dd className="text-[var(--tfmc-mist)]">{formatLocal(profile.discord.linked_at)}</dd>
            {profile.discord.left_guild_at ? (
              <>
                <dt className="text-[var(--tfmc-stone)]">Left Discord</dt>
                <dd className="text-[#e8c48a]">
                  {formatLocal(profile.discord.left_guild_at)}
                  {profile.discord.grace_until ? ` (link kept until ${formatLocal(profile.discord.grace_until)})` : ""}
                </dd>
              </>
            ) : null}
            <dt className="text-[var(--tfmc-stone)]">Website</dt>
            <dd className="text-[var(--tfmc-mist)]">
              {profile.account
                ? `${roleLabel(profile.account.role)} · last signed in ${formatLocal(profile.account.last_login_at)}`
                : "Hasn’t signed in"}
            </dd>
          </dl>
        ) : (
          <p className={`mt-3 ${mutedClass}`}>Not linked to Discord.</p>
        )}
      </section>

      <section className={panelClass} aria-label="Characters">
        <h3 className={headingClass}>Characters</h3>
        {profile.characters.length ? (
          <ul className="mt-3 space-y-1 text-sm">
            {profile.characters.map((c) => (
              <li key={`${c.realm_id}:${c.character_id}`} className="text-[var(--tfmc-cream)]">
                {c.name}
                <span className="text-[var(--tfmc-stone)]">
                  {[c.race, c.class, c.status, c.realm_id !== "main" ? c.realm_id : null].filter(Boolean).map((v) => ` · ${v}`)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-3 ${mutedClass}`}>No characters.</p>
        )}
      </section>

      <Sessions uuid={profile.uuid} />
      <Activity uuid={profile.uuid} />
    </>
  );
}

function place(point: WorldPoint | null): string {
  if (!point) return "";
  return `${point.world ?? "?"} ${point.x}, ${point.y}, ${point.z}`;
}

const END_LABELS: Record<PlayerSession["end_kind"], string> = {
  logout: "Logged out",
  open: "Still playing",
  last_observed: "No logout recorded",
  unknown: "No logout recorded",
};

function Sessions({ uuid }: { uuid: string }) {
  const [rows, setRows] = useState<PlayerSession[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [historyStart, setHistoryStart] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "more">("loading");
  const [failure, setFailure] = useState<Failure | null>(null);

  const fetchPage = useCallback(
    async (before: string | null) => {
      setState(before ? "more" : "loading");
      setFailure(null);
      try {
        const page = await getPlayerSessions(uuid, before);
        const notice = coreProtectMessage(page.coreprotect);
        // An unavailable page has no cursor: keep what is shown so the same page can be retried.
        if (notice) {
          setFailure({ message: notice, before });
          return;
        }
        setRows((old) => (before ? [...old, ...page.sessions] : page.sessions));
        setNext(page.next);
        if (page.history_start !== undefined) setHistoryStart(page.history_start ?? null);
      } catch (err) {
        setFailure({ message: adminErrorMessage(err), before });
      } finally {
        setState("ready");
      }
    },
    [uuid]
  );

  useEffect(() => {
    void fetchPage(null);
  }, [fetchPage]);

  return (
    <section className={panelClass} aria-label="Sessions">
      <h3 className={headingClass}>Sessions</h3>
      {historyStart ? (
        <p className="mt-1 text-xs text-[var(--tfmc-stone)]">Session records go back to {formatEpoch(historyStart)}.</p>
      ) : null}
      {state === "loading" ? <p className={`mt-3 ${mutedClass}`}>Loading…</p> : null}
      {state !== "loading" && !rows.length && !failure ? <p className={`mt-3 ${mutedClass}`}>No sessions recorded.</p> : null}
      {rows.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-[var(--tfmc-stone)]">
              <tr>
                <th scope="col" className="py-2 pr-3 font-semibold">Joined</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Length</th>
                <th scope="col" className="py-2 font-semibold">Ended</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]">
              {rows.map((s, index) => (
                <tr key={`${s.start.time}:${index}`}>
                  <td className="py-2 pr-3 text-[var(--tfmc-cream)]" title={place(s.start)}>
                    {formatEpoch(s.start.time)}
                  </td>
                  <td className="py-2 pr-3 text-[var(--tfmc-mist)]">
                    {s.end_kind === "last_observed" && s.duration_seconds !== null ? "At least " : ""}
                    {formatDuration(s.duration_seconds)}
                  </td>
                  <td className="py-2 text-[var(--tfmc-mist)]" title={place(s.end)}>
                    {END_LABELS[s.end_kind]}
                    {s.end_kind === "last_observed" && s.end ? (
                      <span className="text-[var(--tfmc-stone)]"> · last seen {formatEpoch(s.end.time)}</span>
                    ) : s.end_kind === "logout" && s.end ? (
                      <span className="text-[var(--tfmc-stone)]"> · {formatEpoch(s.end.time)}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {failure ? (
        <Retry failure={failure} busy={state !== "ready"} onRetry={() => void fetchPage(failure.before)} />
      ) : next ? (
        <button type="button" className={moreClass} disabled={state !== "ready"} onClick={() => void fetchPage(next)}>
          {state === "more" ? "Loading…" : "Load more sessions"}
        </button>
      ) : null}
    </section>
  );
}

type Failure = { message: string; before: string | null };

function Retry({ failure, busy, onRetry }: { failure: Failure; busy: boolean; onRetry: () => void }) {
  return (
    <div>
      <p className={errorClass} role="alert">
        {failure.message}
      </p>
      <button type="button" className={moreClass} disabled={busy} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function describe(entry: ActivityEntry) {
  const amount = entry.amount && entry.amount > 1 ? `${entry.amount} × ` : "";
  const cut = entry.truncated ? <span className="text-[var(--tfmc-stone)]"> (cut short)</span> : null;
  if (entry.kind === "chat") {
    return (
      <>
        said <q className="break-words text-[var(--tfmc-cream)]">{entry.message}</q>
        {cut}
      </>
    );
  }
  return (
    <>
      {entry.verb}{" "}
      {entry.victim?.uuid ? (
        <Link
          href={`/admin/players/${entry.victim.uuid}`}
          className="font-semibold text-[var(--tfmc-cream)] underline-offset-2 hover:text-[var(--tfmc-accent)] hover:underline"
        >
          {entry.target}
        </Link>
      ) : entry.target ? (
        <span className="break-words font-semibold text-[var(--tfmc-cream)]">
          {amount}
          {entry.target}
        </span>
      ) : null}
      {cut}
    </>
  );
}

function Activity({ uuid }: { uuid: string }) {
  const [kinds, setKinds] = useState<string[]>([]);
  // Until the server says which kinds this viewer may filter by, offer only the ones everyone may.
  const [available, setAvailable] = useState<string[]>(Object.keys(KIND_LABELS).filter((kind) => kind !== "chat"));
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [searchedTo, setSearchedTo] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "more">("loading");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [showsMessages, setShowsMessages] = useState(false);
  const request = useRef(0);

  const fetchPage = useCallback(
    async (before: string | null) => {
      const id = ++request.current;
      setState(before ? "more" : "loading");
      setFailure(null);
      try {
        const page = await getPlayerActivity(uuid, { before, kinds: kinds.length ? kinds : undefined });
        if (id !== request.current) return;
        if (page.kinds.length) setAvailable(page.kinds);
        setShowsMessages(page.shows_messages);
        const notice = coreProtectMessage(page.coreprotect);
        if (notice) {
          setFailure({ message: notice, before });
          return;
        }
        setEntries((old) => (before ? [...old, ...page.entries] : page.entries));
        setNext(page.next);
        setSearchedTo(page.searched_to);
      } catch (err) {
        if (id === request.current) setFailure({ message: adminErrorMessage(err), before });
      } finally {
        if (id === request.current) setState("ready");
      }
    },
    [uuid, kinds]
  );

  useEffect(() => {
    void fetchPage(null);
  }, [fetchPage]);

  function choose(next: string[]) {
    // The old filter's rows and cursor must not be paged into the new one.
    setNext(null);
    setSearchedTo(null);
    setEntries([]);
    setFailure(null);
    setKinds(next);
  }

  function toggle(kind: string) {
    choose(kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]);
  }

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
      active
        ? "border-[var(--tfmc-accent)] bg-[var(--tfmc-accent)] font-semibold text-[var(--tfmc-forest-deep)]"
        : "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
    }`;

  return (
    <section className={panelClass} aria-label="Recent activity">
      <h3 className={headingClass}>Recent activity</h3>
      <p className="mt-1 text-xs text-[var(--tfmc-stone)]">
        {showsMessages
          ? "From CoreProtect, including chat and whole commands. Your views of these are logged. Sign text is not shown."
          : "From CoreProtect. Chat, command arguments and sign text are not shown."}
      </p>
      <div role="group" aria-label="Show" className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={!kinds.length} className={chip(!kinds.length)} onClick={() => choose([])}>
          All
        </button>
        {available.map((kind) => (
          <button key={kind} type="button" aria-pressed={kinds.includes(kind)} className={chip(kinds.includes(kind))} onClick={() => toggle(kind)}>
            {KIND_LABELS[kind] ?? kind}
          </button>
        ))}
      </div>
      {state === "loading" ? <p className={`mt-3 ${mutedClass}`}>Loading…</p> : null}
      {state !== "loading" && !entries.length && !failure ? (
        <p className={`mt-3 ${mutedClass}`}>{searchedTo ? "Nothing yet." : "No activity recorded."}</p>
      ) : null}
      {entries.length ? (
        <ul className="mt-3 divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
              <span className="min-w-0 text-[var(--tfmc-mist)]">
                {describe(entry)}
                {entry.rolled_back ? <span className="ml-2 text-xs text-[#e8c48a]">{entry.rolled_back}</span> : null}
              </span>
              <span className="whitespace-nowrap text-xs text-[var(--tfmc-stone)]">
                {entry.world ? `${place({ ...entry })} · ` : ""}
                {formatEpoch(entry.time)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {searchedTo && next && !failure ? (
        <p className="mt-3 text-xs text-[var(--tfmc-stone)]">Searched back to {formatEpoch(searchedTo)}.</p>
      ) : null}
      {failure ? (
        <Retry failure={failure} busy={state !== "ready"} onRetry={() => void fetchPage(failure.before)} />
      ) : next ? (
        <button type="button" className={moreClass} disabled={state !== "ready"} onClick={() => void fetchPage(next)}>
          {state === "more" ? "Loading…" : searchedTo ? "Search further back" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}
