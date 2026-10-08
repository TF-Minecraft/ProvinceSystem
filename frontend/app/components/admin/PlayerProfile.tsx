"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AccountApiError } from "../../../lib/account/api";
import {
  adminErrorMessage,
  coreProtectMessage,
  getAdminMe,
  getPlayer,
  getPlayerSessions,
  canManage,
  roleLabel,
  type AdminAccount,
  type AdminMe,
  type PlayerProfile as Profile,
  type PlayerSession,
} from "../../../lib/admin/api";
import { formatLocal } from "../../../lib/skins/formatTime";
import { formatAgo, formatDate, formatEpoch } from "../../../lib/admin/time";
import { groupByDay, sessionRow } from "../../../lib/admin/sessionDays";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";
import PlayerTabs, { profileTab } from "./PlayerTabs";
import AccountActions from "./AccountActions";
import PlayerActivity from "./PlayerActivity";
import {
  Retry,
  dayHeadingClass,
  dividerClass,
  headingClass,
  moreClass,
  mutedClass,
  panelClass,
  type Failure,
} from "./profileParts";

type Load = { kind: "loading" } | { kind: GateKind } | { kind: "failed"; message: string } | { kind: "ready"; profile: Profile };

export default function PlayerProfile({ uuid }: { uuid: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [me, setMe] = useState<AdminMe | null>(null);
  const tab = profileTab(useSearchParams().get("tab"));
  // Tabs open once stay mounted (hidden), so going back keeps their pages, filters and scroll.
  const [opened, setOpened] = useState<Set<string>>(() => new Set([tab]));
  if (!opened.has(tab)) setOpened(new Set(opened).add(tab));
  // Movement is for admins and the owner; mods see the profile without it.
  const movement = me?.capabilities.includes("view_player_movement") ?? false;

  useEffect(() => {
    let live = true;
    getAdminMe()
      .then((value) => live && setMe(value))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const loadProfile = useCallback(() => {
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

  useEffect(() => loadProfile(), [loadProfile]);

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
        <p className="mt-2 text-sm">
          <Link href={`/admin/ranks/players/${profile.uuid}`} className="text-[var(--tfmc-accent)] underline-offset-2 hover:underline">
            In-game ranks and permissions →
          </Link>
        </p>
        {notice ? (
          <p className="mt-3 text-sm text-[#e8c48a]" role="status">
            {notice}
          </p>
        ) : null}
      </header>

      <PlayerTabs uuid={profile.uuid} current={tab} movement={movement} />

      {opened.has("activity") ? (
        <div hidden={tab !== "activity"}>
          <PlayerActivity uuid={profile.uuid} />
        </div>
      ) : null}
      {opened.has("sessions") ? (
        <div hidden={tab !== "sessions"}>
          <Sessions uuid={profile.uuid} movement={movement} />
        </div>
      ) : null}

      <section hidden={tab !== "discord"} className={panelClass} aria-label="Discord and website">
        <h3 className={headingClass}>Discord and website</h3>
        {profile.discord ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-[var(--tfmc-stone)]">Discord</dt>
            <dd className="text-[var(--tfmc-cream)]">
              {profile.discord.discord_username ? (
                `@${profile.discord.discord_username}`
              ) : (
                <span className="text-[var(--tfmc-mist)]">
                  Not known yet · ID {profile.discord.discord_user_id}
                </span>
              )}
            </dd>
            <dt className="text-[var(--tfmc-stone)]">Server nickname</dt>
            <dd className="text-[var(--tfmc-cream)]">
              {profile.discord.discord_nickname ?? <span className="text-[var(--tfmc-mist)]">None known</span>}
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
        ) : null}
        {me && profile.discord && profile.account && canManage(me, websiteAccount(profile)) ? (
          <AccountActions me={me} account={websiteAccount(profile)} onChanged={async () => {
            loadProfile();
          }} />
        ) : null}
        {profile.discord ? null : <p className={`mt-3 ${mutedClass}`}>Not linked to Discord.</p>}
      </section>

      <section hidden={tab !== "characters"} className={panelClass} aria-label="Characters">
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

    </>
  );
}

/** The profile's website account in the shape the account actions use. */
function websiteAccount(profile: Profile): AdminAccount {
  const account = profile.account!;
  return {
    user_id: account.user_id,
    discord_user_id: profile.discord!.discord_user_id,
    discord_username: profile.discord!.discord_username,
    discord_global_name: account.discord_global_name,
    avatar_url: account.avatar_url,
    role: account.role,
    minecraft_name: profile.minecraft_name,
    created_at: account.created_at,
    last_login_at: account.last_login_at,
  };
}

function SessionItem({ session, day, uuid, movement }: { session: PlayerSession; day: string; uuid: string; movement: boolean }) {
  const row = sessionRow(session);
  const spoken = `${day}, ${row.start} to ${row.end}${row.duration ? `, ${row.duration}` : ""}${row.note ? `. ${row.note}` : ""}`;
  const body = (
    <>
      <span className="sr-only">{spoken}</span>
      <span aria-hidden="true">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[var(--tfmc-cream)]">
            {row.start} → {row.end}
          </span>
          {row.duration ? <span className="shrink-0 text-right text-[var(--tfmc-mist)]">{row.duration}</span> : null}
        </span>
        {row.note ? (
          <span className={`block text-xs ${session.end_kind === "open" ? "text-[var(--tfmc-accent)]" : "text-[#e8c48a]"}`}>
            {row.note}
          </span>
        ) : null}
      </span>
    </>
  );
  if (!movement) return <div className="py-2">{body}</div>;
  return (
    <Link
      href={`/admin/players/${encodeURIComponent(uuid)}/movement?session=${encodeURIComponent(session.id)}`}
      className="-mx-2 block rounded-sm px-2 py-2 hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)]"
    >
      {body}
    </Link>
  );
}

function Sessions({ uuid, movement }: { uuid: string; movement: boolean }) {
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

  const days = groupByDay(rows, Date.now() / 1000);

  return (
    <section className={panelClass} aria-label="Sessions">
      <h3 className={headingClass}>Sessions</h3>
      {state === "loading" ? <p className={`mt-3 ${mutedClass}`}>Loading…</p> : null}
      {state !== "loading" && !rows.length && !failure ? <p className={`mt-3 ${mutedClass}`}>No sessions recorded.</p> : null}
      {days.length ? (
        <div className="mt-3 space-y-4">
          {days.map((day) => (
            <div key={day.key}>
              <h4 className={dayHeadingClass}>{day.label}</h4>
              <ul aria-label={day.label} className={`mt-1 text-sm ${dividerClass}`}>
                {day.sessions.map((session) => (
                  <li key={session.id}>
                    <SessionItem session={session} day={day.label} uuid={uuid} movement={movement} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
      {failure ? (
        <Retry failure={failure} busy={state !== "ready"} onRetry={() => void fetchPage(failure.before)} />
      ) : next ? (
        <button type="button" className={moreClass} disabled={state !== "ready"} onClick={() => void fetchPage(next)}>
          {state === "more" ? "Loading…" : "Load more sessions"}
        </button>
      ) : rows.length && historyStart && state === "ready" ? (
        // The oldest session row CoreProtect still holds for anyone, not this player's first session.
        <p className="mt-3 text-xs text-[var(--tfmc-stone)]">Server session history starts {formatDate(historyStart)}.</p>
      ) : null}
    </section>
  );
}
