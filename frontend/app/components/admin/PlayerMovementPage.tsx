"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AccountApiError } from "../../../lib/account/api";
import { adminErrorMessage, coreProtectMessage, getPlayer, type PlayerSession } from "../../../lib/admin/api";
import {
  ACTION_PING,
  PLAYER_WINDOW_SECONDS,
  clipStretches,
  describeSpan,
  formatClock,
  formatMoment,
  gapSeconds,
  getPlayerMovement,
  getSessionMovement,
  inspect,
  observationTimes,
  observedBands,
  sessionEndLabel,
  stretches,
  timeByWorld,
  worldLabel,
  type MovementPoint,
  type MovementStatus,
} from "../../../lib/admin/movement";
import { formatDuration } from "../../../lib/admin/time";
import { writeUrl } from "../../../lib/admin/urlState";
import MovementMap, { type MapPin } from "./MovementMap";
import {
  CopyButton,
  InspectBar,
  useLiveMoment,
  PinForm,
  RangeForm,
  Timeline,
  chipClass,
  chipOff,
  chipOn,
  mutedClass,
  useLiveMapId,
  useMinuteClock,
  type Range,
} from "./MovementControls";
import SessionList from "./SessionList";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";

/** What either kind of answer comes down to for drawing. */
type View = {
  key: string;
  since: number;
  until: number;
  completeFrom: number;
  points: MovementPoint[];
  worlds: (string | null)[];
  pingsSince: number | null;
  asOf: number | null;
  coreprotect: MovementStatus;
  session: PlayerSession | null;
};

type Load =
  | { kind: "idle" }
  | { kind: "loading"; previous: View | null }
  | { kind: "ready"; view: View }
  | { kind: "failed"; message: string; previous: View | null }
  | { kind: "gate"; gate: GateKind };

function spanOrLastHour(since: number, until: number): Range {
  if (since && until > since && until - since <= PLAYER_WINDOW_SECONDS) return { from: since, to: until, follow: false };
  const now = Math.floor(Date.now() / 1000);
  return { from: now - 3600, to: now, follow: false };
}

function intParam(value: string | null): number | null {
  if (value === null || !/^-?\d+$/.test(value)) return null;
  return Number(value);
}

function pinParam(value: string | null): MapPin | null {
  const match = value?.match(/^(-?\d+),(-?\d+)$/);
  return match ? { x: Number(match[1]), z: Number(match[2]) } : null;
}

/**
 * One player's movement, session by session or over a chosen range, with the
 * route on the live map, a timeline, and an inspected moment. Everything that
 * picks the view lives in the URL, so a view can be shared as a link.
 */
export default function PlayerMovementPage({ uuid }: { uuid: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const mapId = useLiveMapId();

  const sessionId = search.get("session");
  const from = intParam(search.get("from"));
  const to = intParam(search.get("to"));
  const follow = search.get("follow") === "1";
  const urlAt = intParam(search.get("at"));
  const pin = pinParam(search.get("pin"));
  // A session in the URL wins over a range.
  const mode: "session" | "range" = !sessionId && from !== null && to !== null ? "range" : "session";
  const [tab, setTab] = useState<"session" | "range">(mode);
  const [collapsed, setCollapsed] = useState(false);
  const [followSession, setFollowSession] = useState(false);
  // Following is for one open session: a new selection starts without it.
  const [followedSession, setFollowedSession] = useState(sessionId);
  if (followedSession !== sessionId) {
    setFollowedSession(sessionId);
    setFollowSession(false);
  }

  const update = useCallback(
    (changes: Record<string, string | null>, replace = false) => {
      const next = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      writeUrl(`${pathname}?${next.toString()}`, replace);
    },
    [pathname, search]
  );
  // The inspected moment moves at once and reaches the URL when it rests (see useLiveMoment).
  const { at, move: setCursor, cancel: cancelMoment } = useLiveMoment(urlAt, (time) =>
    update({ at: String(time) }, true)
  );

  const [name, setName] = useState<string | null>(null);
  const [gate, setGate] = useState<GateKind | null>(null);
  useEffect(() => {
    let live = true;
    getPlayer(uuid)
      .then((profile) => live && setName(profile.minecraft_name ?? "Unknown name"))
      .catch((err) => {
        if (!live) return;
        const status = err instanceof AccountApiError ? err.status : 0;
        if (status === 400 || status === 404) setName("Unknown player");
        else setGate(gateKind(err));
      });
    return () => {
      live = false;
    };
  }, [uuid]);

  // The clock only ticks while something follows it.
  const now = useMinuteClock((mode === "range" && follow) || (mode === "session" && followSession));
  const range: Range | null =
    mode === "range" && from !== null && to !== null
      ? follow
        ? { from: now - (to - from), to: now, follow: true }
        : { from, to, follow: false }
      : null;
  // What the camera frames: a new session or range, not a refresh of the same one.
  const viewKey = mode === "session" ? `session:${sessionId}` : follow ? `follow:${(to ?? 0) - (from ?? 0)}` : `range:${from}:${to}`;
  const fetchKey =
    mode === "session"
      ? sessionId
        ? `${viewKey}:${followSession ? now : ""}`
        : null
      : range
        ? `${viewKey}:${range.from}:${range.to}`
        : null;

  const [load, setLoad] = useState<Load>({ kind: "idle" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (fetchKey === null) return;
    let live = true;
    setLoad((prev) => ({ kind: "loading", previous: prev.kind === "ready" ? prev.view : prev.kind === "loading" || prev.kind === "failed" ? prev.previous : null }));
    const request =
      mode === "session"
        ? getSessionMovement(uuid, sessionId!).then((data): View => ({
            key: viewKey,
            since: data.since ?? data.session?.start.time ?? 0,
            until: data.until ?? data.as_of,
            completeFrom: data.complete_from ?? data.since ?? 0,
            points: data.points,
            worlds: data.worlds,
            pingsSince: data.pings_since,
            asOf: data.as_of,
            coreprotect: data.coreprotect,
            session: data.session,
          }))
        : getPlayerMovement(uuid, range!.from, range!.to).then((data): View => ({
            key: viewKey,
            since: data.since,
            until: data.until,
            completeFrom: data.complete_from,
            points: data.points,
            worlds: data.worlds,
            pingsSince: data.pings_since,
            asOf: data.as_of ?? null,
            coreprotect: data.coreprotect,
            session: null,
          }));
    request
      .then((view) => {
        if (!live) return;
        setLoad({ kind: "ready", view });
        // A logout (or a stale session) ends following; nothing more will come.
        if (view.session && view.session.end_kind !== "open") setFollowSession(false);
      })
      .catch((err) => {
        if (!live) return;
        const status = err instanceof AccountApiError ? err.status : 0;
        if (status === 401 || status === 403) return setLoad({ kind: "gate", gate: gateKind(err) });
        setLoad((prev) => ({
          kind: "failed",
          message: adminErrorMessage(err),
          previous: prev.kind === "loading" ? prev.previous : null,
        }));
      });
    return () => {
      live = false;
    };
    // fetchKey captures everything the request depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, uuid, retry]);

  const view = load.kind === "ready" ? load.view : load.kind === "loading" || load.kind === "failed" ? load.previous : null;
  const stale = view !== null && load.kind !== "ready";
  const parts = useMemo(
    () => (view ? stretches(view.points, view.worlds, view.coreprotect.ping_seconds) : []),
    [view]
  );
  const trails = useMemo(() => [{ key: uuid, label: name ?? "Player", stretches: parts }], [uuid, name, parts]);
  const times = useMemo(
    () => observationTimes(parts, view?.completeFrom ?? view?.since ?? 0, view?.until ?? 0),
    [parts, view]
  );

  if (gate) return <StaffGateMessage kind={gate} />;
  if (load.kind === "gate") {
    return load.gate === "forbidden" ? (
      <p className="mt-6 text-[var(--tfmc-mist)]">Movement is for admins and the owner only.</p>
    ) : (
      <StaffGateMessage kind={load.gate} />
    );
  }

  const mapWorld = view?.coreprotect.map_world ?? "TFMC_Map";
  const hold = gapSeconds(view?.coreprotect.ping_seconds);
  const since = view?.since ?? range?.from ?? 0;
  const until = view?.until ?? range?.to ?? 0;
  // Default to the last observation, so a session opens on where it ended.
  const cursor = Math.min(until, Math.max(since, at ?? times[times.length - 1] ?? until));
  const found = inspect(parts, cursor, hold);
  const inWindow = clipStretches(parts, view?.completeFrom ?? since, until);
  const byWorld = [...timeByWorld(inWindow)].filter(([, seconds]) => seconds > 0);
  const observed = byWorld.reduce((sum, [, seconds]) => sum + seconds, 0);
  const notice = view ? coreProtectMessage(view.coreprotect) : null;
  const unknownUntil = view
    ? Math.max(view.completeFrom, view.pingsSince !== null && view.pingsSince > since ? view.pingsSince : since)
    : null;
  const onlyEdges = view !== null && view.points.length > 0 && !view.points.some((p) => p[5] === ACTION_PING);

  const selectSession = (session: PlayerSession, replace: boolean) => {
    cancelMoment();
    update({ session: session.id, from: null, to: null, follow: null, at: null }, replace);
  };
  const applyRange = (next: Range) => {
    cancelMoment();
    update({ session: null, from: String(next.from), to: String(next.to), follow: next.follow ? "1" : null, at: null });
  };

  const shareUrl = () => {
    const params = new URLSearchParams(search.toString());
    if (range) {
      params.set("from", String(range.from));
      params.set("to", String(range.to));
      params.delete("follow");
    }
    params.set("at", String(cursor));
    return `${window.location.origin}${pathname}?${params.toString()}`;
  };

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
            {name ?? "…"} · movement
          </h2>
          <p className={mutedClass}>
            {view?.coreprotect.server_label ? `${view.coreprotect.server_label} · ` : ""}
            Positions are recorded once a minute; lines between them are estimates. Admins only; each view is logged.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${chipClass} ${chipOff} hidden lg:inline-block`} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? "Show panel" : "Hide panel"}
          </button>
          {view ? <CopyButton text={shareUrl()} label="Copy link to this view" /> : null}
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {!collapsed ? (
          <aside className="flex shrink-0 flex-col gap-3 lg:w-80">
            <div className="flex gap-2" role="tablist">
              {(["session", "range"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`${chipClass} ${tab === t ? chipOn : chipOff} flex-1`}
                >
                  {t === "session" ? "Sessions" : "Time range"}
                </button>
              ))}
            </div>
            {tab === "session" ? (
              <SessionList
                uuid={uuid}
                selected={mode === "session" ? sessionId : null}
                autoSelect={mode === "session" && !sessionId}
                onSelect={selectSession}
              />
            ) : (
              <RangeForm
                // Opening the tab on a session starts from that session's span.
                value={range ?? spanOrLastHour(since, until)}
                longest={PLAYER_WINDOW_SECONDS}
                asOf={view?.asOf ?? null}
                onApply={applyRange}
              />
            )}
            <PinForm pin={pin} onChange={(next) => update({ pin: next ? `${next.x},${next.z}` : null }, true)} />
          </aside>
        ) : null}

        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <Heading view={view} mode={mode} followSession={followSession} onFollowSession={setFollowSession} />
          {notice ? <p className="text-sm text-[#e8c48a]">{notice}</p> : null}
          {load.kind === "failed" ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-[#e8a0a0]" role="alert">
                {load.message}
                {load.previous ? " Showing the previous results." : ""}
              </p>
              <button type="button" className={`${chipClass} ${chipOff}`} onClick={() => setRetry((n) => n + 1)}>
                Retry
              </button>
            </div>
          ) : null}
          {load.kind === "loading" ? (
            <p className={mutedClass}>{load.previous ? "Loading… (showing the previous results)" : "Loading…"}</p>
          ) : null}
          <div className={stale ? "opacity-70 transition-opacity" : ""}>
            {mapId ? (
              <MovementMap
                mapId={mapId}
                mapWorld={mapWorld}
                trails={trails}
                since={view?.completeFrom ?? since}
                until={until}
                cursor={cursor}
                hold={hold}
                endpoints
                pin={pin}
                fitKey={load.kind === "ready" && load.view.key === viewKey ? viewKey : null}
                onInspect={setCursor}
                className="h-[60vh] min-h-[22rem] rounded-sm lg:h-[calc(100dvh-24rem)]"
              />
            ) : (
              <div className="h-[60vh] min-h-[22rem]" />
            )}
          </div>
          {view ? (
            <>
              <Timeline
                since={since}
                until={until}
                unknownUntil={unknownUntil}
                unknownLabel={
                  view.completeFrom > since ? "earlier observations omitted" : "before available position observations"
                }
                bands={observedBands(inWindow).map(([a, b]) => ({ from: a, to: b }))}
                cursor={cursor}
                onCursor={setCursor}
              />
              <InspectBar cursor={cursor} since={since} until={until} times={times} onCursor={setCursor}>
                <Readout found={found} cursor={cursor} mapWorld={mapWorld} />
              </InspectBar>
              <div className={`${mutedClass} flex flex-col gap-1`}>
                {!view.points.length ? (
                  <p className="text-[var(--tfmc-cream)]">
                    No observations between {describeSpan(since, until)}.{" "}
                    {mode === "range" ? (
                      <button type="button" className="underline" onClick={() => { setTab("session"); cancelMoment(); update({ from: null, to: null, follow: null, at: null }); }}>
                        Show their latest session
                      </button>
                    ) : null}
                  </p>
                ) : (
                  <p>
                    Estimated observed time in the span shown: {formatDuration(observed).toLowerCase()}
                    {byWorld.length > 1
                      ? ` (${byWorld.map(([world, s]) => `${formatDuration(s).toLowerCase()} in ${worldLabel(world)}`).join(", ")})`
                      : byWorld.length === 1 && byWorld[0][0] !== mapWorld
                        ? `, all in ${worldLabel(byWorld[0][0])}`
                        : ""}
                    .
                  </p>
                )}
                {onlyEdges ? <p>Login and logout locations only; the route is unavailable for this span.</p> : null}
                {view.completeFrom > since ? (
                  <p>Earlier observations omitted: too many to show, so the route starts at {formatMoment(view.completeFrom)}.</p>
                ) : null}
                {view.pingsSince !== null && view.pingsSince > since ? (
                  <p>
                    Before {formatMoment(view.pingsSince)} there are no available position observations, only login and
                    logout places.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      </div>
      <Link href={`/admin/players/${encodeURIComponent(uuid)}`} className="text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
        ← Back to the profile
      </Link>
    </div>
  );
}

function Heading({
  view,
  mode,
  followSession,
  onFollowSession,
}: {
  view: View | null;
  mode: "session" | "range";
  followSession: boolean;
  onFollowSession: (on: boolean) => void;
}) {
  if (!view) return null;
  if (mode === "session" && view.session) {
    const s = view.session;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[var(--tfmc-cream)]">
          Session {describeSpan(s.start.time, view.until)}
          {s.duration_seconds !== null ? ` · ${formatDuration(s.duration_seconds).toLowerCase()}` : ""} ·{" "}
          <span className={s.end_kind === "logout" ? "" : "text-[#e8c48a]"}>{sessionEndLabel(s)}</span>
        </p>
        {s.end_kind === "open" ? (
          <label className="flex min-h-11 items-center gap-2 text-sm text-[var(--tfmc-cream)]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--tfmc-accent)]"
              checked={followSession}
              onChange={(event) => onFollowSession(event.target.checked)}
            />
            Keep up to date{followSession && view.asOf ? ` · updated ${formatClock(view.asOf)}` : ""}
          </label>
        ) : null}
      </div>
    );
  }
  return <p className="text-[var(--tfmc-cream)]">{describeSpan(view.since, view.until)}</p>;
}

function Readout({
  found,
  cursor,
  mapWorld,
}: {
  found: ReturnType<typeof inspect>;
  cursor: number;
  mapWorld: string;
}) {
  const when = `Inspecting ${formatClock(cursor, true)}`;
  const where = (world: string | null) => (world === mapWorld ? "" : ` in ${worldLabel(world)}`);
  switch (found.kind) {
    case "observed": {
      const s = found.sample;
      return (
        <div className="flex flex-wrap items-center gap-3">
          <span>
            {when} · recorded at {s.x}, {s.y}, {s.z}
            {where(found.world)}
          </span>
          {found.world === mapWorld ? <CopyButton text={`/tp ${s.x} ${s.y} ${s.z}`} label="Copy teleport command" /> : null}
        </div>
      );
    }
    case "estimated":
      return (
        <span>
          {when} · estimated between observations at {formatClock(found.before.time, true)} and{" "}
          {formatClock(found.after.time, true)}: near {Math.round(found.x)}, {Math.round(found.z)}
          {where(found.world)}
        </span>
      );
    case "unobserved":
      return (
        <span>
          {when} · position unknown: an unobserved transition from {found.before.x}, {found.before.z} (
          {formatClock(found.before.time, true)}) to {found.after.x}, {found.after.z} ({formatClock(found.after.time, true)})
          {where(found.world)}
        </span>
      );
    case "stale":
      return (
        <span>
          {when} · position unknown; last observed {formatDuration(cursor - found.before.time).toLowerCase()} earlier at{" "}
          {found.before.x}, {found.before.z}
          {where(found.world)}
        </span>
      );
    default:
      return (
        <span>
          {when} · not observed (offline, or not recorded)
          {found.before ? `; last observation ${formatClock(found.before.time, true)}` : ""}.
        </span>
      );
  }
}
