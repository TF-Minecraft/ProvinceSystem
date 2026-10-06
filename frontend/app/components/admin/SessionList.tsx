"use client";

import { useCallback, useEffect, useState } from "react";

import {
  adminErrorMessage,
  coreProtectMessage,
  getPlayerSessions,
  type PlayerSession,
} from "../../../lib/admin/api";
import { formatDuration } from "../../../lib/admin/time";
import { formatDay, sessionEndLabel, sessionSpanLabel, worldLabel } from "../../../lib/admin/movement";
import { chipClass, chipOff, mutedClass } from "./MovementControls";

type State = {
  sessions: PlayerSession[];
  next: string | null;
  busy: boolean;
  error: string | null;
};

/**
 * A player's sessions, newest first, a page at a time. Picking one shows its
 * route. With nothing picked, the newest is picked once the list arrives.
 */
export default function SessionList({
  uuid,
  selected,
  autoSelect,
  onSelect,
}: {
  uuid: string;
  selected: string | null;
  autoSelect: boolean;
  onSelect: (session: PlayerSession, replace: boolean) => void;
}) {
  const [state, setState] = useState<State>({ sessions: [], next: null, busy: true, error: null });

  const load = useCallback(
    (before: string | null) => {
      setState((s) => ({ ...s, busy: true, error: null }));
      return getPlayerSessions(uuid, before)
        .then((page) => {
          const problem = coreProtectMessage(page.coreprotect);
          setState((s) => ({
            sessions: before ? [...s.sessions, ...page.sessions] : page.sessions,
            next: page.next,
            busy: false,
            error: problem,
          }));
          return page.sessions;
        })
        .catch((err) => {
          setState((s) => ({ ...s, busy: false, error: adminErrorMessage(err) }));
          return [] as PlayerSession[];
        });
    },
    [uuid]
  );

  useEffect(() => {
    let live = true;
    void load(null).then((sessions) => {
      if (live && autoSelect && sessions[0]) onSelect(sessions[0], true);
    });
    return () => {
      live = false;
    };
    // Only on first load: picking the newest must not repeat when the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return (
    <div className="flex flex-col gap-2">
      {state.error ? (
        <p className="text-sm text-[#e8a0a0]" role="alert">
          {state.error}
        </p>
      ) : null}
      <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1 lg:max-h-[calc(100dvh-26rem)]" aria-label="Sessions">
        {state.sessions.map((session) => {
          const active = session.id === selected;
          return (
            <li key={session.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(session, false)}
                className={`flex w-full flex-col items-start gap-0.5 rounded-sm border px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_12%,transparent)]"
                    : "border-transparent hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]"
                }`}
              >
                <span className="flex w-full justify-between gap-2 text-[var(--tfmc-cream)]">
                  <span>
                    {formatDay(session.start.time)} · {sessionSpanLabel(session)}
                  </span>
                  <span className="shrink-0 text-[var(--tfmc-mist)]">
                    {session.duration_seconds !== null ? formatDuration(session.duration_seconds) : ""}
                  </span>
                </span>
                <span className={session.end_kind === "logout" ? "text-[var(--tfmc-mist)]" : "text-[#e8c48a]"}>
                  {sessionEndLabel(session)}
                </span>
                <span className="text-xs text-[var(--tfmc-stone)]">
                  Logged in at {session.start.x}, {session.start.z}
                  {session.start.world && !session.start.world.match(/_(nether|the_end)$/)
                    ? ""
                    : ` in ${worldLabel(session.start.world)}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!state.busy && !state.sessions.length && !state.error ? (
        <p className={mutedClass}>No sessions recorded.</p>
      ) : null}
      {state.busy ? <p className={mutedClass}>Loading sessions…</p> : null}
      {state.next && !state.busy ? (
        <button type="button" className={`${chipClass} ${chipOff}`} onClick={() => void load(state.next)}>
          Load older sessions
        </button>
      ) : null}
    </div>
  );
}
