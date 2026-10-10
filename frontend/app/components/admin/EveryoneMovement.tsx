"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { adminErrorMessage, coreProtectMessage } from "../../../lib/admin/api";
import {
  EVERYONE_WINDOW_SECONDS,
  clipStretches,
  formatClock,
  formatMoment,
  gapSeconds,
  getEveryoneMovement,
  inspect,
  observationTimes,
  observedBands,
  playerColour,
  stretches,
  worldLabel,
  type EveryoneMovement as Movement,
  type Inspection,
} from "../../../lib/admin/movement";
import { formatDuration } from "../../../lib/admin/time";
import { writeUrl } from "../../../lib/admin/urlState";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";
import EveryoneNow from "./EveryoneNow";
import AdminColumn from "./AdminColumn";
import MapWorkspace, { mapFrameClass } from "./MapWorkspace";
import MovementMap, { type MapPin, type MovementTrail } from "./MovementMap";
import {
  CopyButton,
  EVERYONE_STRIP_HEIGHT,
  InspectBar,
  useLiveMoment,
  PinForm,
  RangeForm,
  Timeline,
  chipClass,
  chipOff,
  chipOn,
  inputClass,
  mutedClass,
  useLiveMapId,
  useMinuteClock,
  type Range,
} from "./MovementControls";

type Load =
  | { kind: "loading"; previous: Movement | null }
  | { kind: GateKind }
  | { kind: "failed"; message: string; previous: Movement | null }
  | { kind: "ready"; data: Movement; key: string };

function intParam(value: string | null): number | null {
  return value !== null && /^-?\d+$/.test(value) ? Number(value) : null;
}

function pinParam(value: string | null): MapPin | null {
  const match = value?.match(/^(-?\d+),(-?\d+)$/);
  return match ? { x: Number(match[1]), z: Number(match[2]) } : null;
}

/** Where a player was at the inspected moment, with how it is known. */
function whereText(found: Inspection, moment: number, mapWorld: string): string {
  const place = (x: number, z: number, world: string | null) =>
    world === mapWorld ? `${Math.round(x)}, ${Math.round(z)}` : worldLabel(world);
  switch (found.kind) {
    case "observed":
      return place(found.sample.x, found.sample.z, found.world);
    case "estimated":
      return `≈ ${place(found.x, found.z, found.world)}`;
    case "unobserved":
      return "unknown";
    case "stale":
      return `${place(found.before.x, found.before.z, found.world)} · ${formatDuration(moment - found.before.time).toLowerCase()} before`;
    default:
      return "not seen";
  }
}

/**
 * The everyone view: where players are now (the default), or their movement
 * over a range. A link with a range (from, to or follow) opens the range.
 */
export default function EveryoneMovement() {
  const pathname = usePathname();
  const search = useSearchParams();
  const ranged = search.get("view") === "range" || ["from", "to", "follow"].some((key) => search.has(key));
  const tab = (on: boolean) => `${chipClass} ${on ? chipOn : chipOff}`;
  // Shown at the top of either view's panel.
  const viewSwitch = (
    <div className="flex gap-2" role="group" aria-label="Movement view">
        <button type="button" className={tab(!ranged)} aria-pressed={!ranged} onClick={() => writeUrl(pathname, false)}>
          Now
        </button>
        <button
          type="button"
          className={tab(ranged)}
          aria-pressed={ranged}
          onClick={() => writeUrl(`${pathname}?view=range`, false)}
        >
          Time range
      </button>
    </div>
  );
  return ranged ? <EveryoneRange viewSwitch={viewSwitch} /> : <EveryoneNow viewSwitch={viewSwitch} />;
}

/** Every player's movement over a range on one map, compared at one inspected moment. */
function EveryoneRange({ viewSwitch }: { viewSwitch: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const mapId = useLiveMapId();

  const [opened] = useState(() => Math.floor(Date.now() / 1000));
  const from = intParam(search.get("from")) ?? opened - 3600;
  const to = intParam(search.get("to")) ?? opened;
  const follow = search.get("follow") === "1";
  // What the inspected moment belongs to: a moment being moved does not carry over to another range.
  const momentView = `range:${from}:${to}:${follow}`;
  const urlAt = intParam(search.get("at"));
  const pin = pinParam(search.get("pin"));
  const chosen = useMemo(() => new Set((search.get("players") ?? "").split(",").filter(Boolean)), [search]);
  const onlyChosen = search.get("only") === "1";
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);

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
  const { at, move: setMoment, cancel: cancelMoment } = useLiveMoment(urlAt, momentView, (time) =>
    update({ at: String(time) }, true)
  );

  const now = useMinuteClock(follow);
  const range: Range = follow ? { from: now - (to - from), to: now, follow: true } : { from, to, follow: false };
  const viewKey = follow ? `follow:${to - from}` : `range:${from}:${to}`;

  const [load, setLoad] = useState<Load>({ kind: "loading", previous: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setLoad((prev) => ({
      kind: "loading",
      previous: prev.kind === "ready" ? prev.data : prev.kind === "loading" || prev.kind === "failed" ? prev.previous : null,
    }));
    getEveryoneMovement(range.from, range.to)
      .then((data) => live && setLoad({ kind: "ready", data, key: viewKey }))
      .catch((err) => {
        if (!live) return;
        const gate = gateKind(err);
        setLoad((prev) =>
          gate === "error"
            ? { kind: "failed", message: adminErrorMessage(err), previous: prev.kind === "loading" ? prev.previous : null }
            : { kind: gate }
        );
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, retry]);

  const data = load.kind === "ready" ? load.data : load.kind === "loading" || load.kind === "failed" ? load.previous : null;
  const all = useMemo<MovementTrail[]>(
    () =>
      data
        ? data.players.map((player) => ({
            key: player.uuid,
            label: player.minecraft_name,
            colour: playerColour(player.uuid),
            stretches: stretches(player.points, data.worlds, data.coreprotect.ping_seconds),
          }))
        : [],
    [data]
  );
  const drawn = useMemo(
    () => (onlyChosen && chosen.size ? all.filter((t) => chosen.has(t.key)) : all),
    [all, chosen, onlyChosen]
  );
  const since = data?.since ?? range.from;
  const until = data?.until ?? range.to;
  const times = useMemo(
    () => observationTimes(drawn.flatMap((t) => t.stretches), data?.complete_from ?? since, until),
    [drawn, data, since, until]
  );

  if (load.kind === "forbidden") {
    return (
      <AdminColumn>
        <p className="mt-6 text-[var(--tfmc-mist)]">Movement is for admins and the owner only.</p>
      </AdminColumn>
    );
  }
  if (load.kind === "signed_out" || load.kind === "unavailable" || load.kind === "error") {
    return (
      <AdminColumn>
        <StaffGateMessage kind={load.kind} />
      </AdminColumn>
    );
  }

  const mapWorld = data?.coreprotect.map_world ?? "TFMC_Map";
  const hold = gapSeconds(data?.coreprotect.ping_seconds);
  const completeFrom = data?.complete_from ?? since;
  const moment = Math.min(until, Math.max(since, at ?? until));
  const notice = data ? coreProtectMessage(data.coreprotect) : null;
  const unknownUntil = data
    ? Math.max(completeFrom, data.pings_since !== null && data.pings_since > since ? data.pings_since : since)
    : null;
  // A row per player while few enough to tell apart; otherwise when anyone was observed.
  const perPlayer = drawn.length <= 8;
  const bands = drawn.flatMap((t, row) =>
    observedBands(clipStretches(t.stretches, completeFrom, until)).map(([a, b]) =>
      perPlayer ? { from: a, to: b, colour: t.colour, row } : { from: a, to: b }
    )
  );
  const needle = query.trim().toLowerCase();
  const listed = all.filter((t) => !needle || t.label.toLowerCase().includes(needle));
  const seenNow = drawn.filter((t) => inspect(t.stretches, moment, hold).kind !== "none").length;

  const toggle = (key: string) => {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update({ players: next.size ? [...next].join(",") : null }, true);
  };
  const playerHref = (uuid: string) => {
    const params = new URLSearchParams({ from: String(range.from), to: String(range.to), at: String(moment) });
    if (pin) params.set("pin", `${pin.x},${pin.z}`);
    return `/admin/players/${encodeURIComponent(uuid)}/movement?${params.toString()}`;
  };
  const shareUrl = () => {
    const params = new URLSearchParams(search.toString());
    params.set("from", String(range.from));
    params.set("to", String(range.to));
    params.delete("follow");
    params.set("at", String(moment));
    return `${window.location.origin}${pathname}?${params.toString()}`;
  };

  return (
    <MapWorkspace
      stripHeight={EVERYONE_STRIP_HEIGHT}
      panel={
        <>
          {viewSwitch}
          <p className={mutedClass}>Lines between positions are estimates. Views are logged.</p>
          <CopyButton text={shareUrl()} label="Copy link to this view" />
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
          <div className="border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-3">
            <RangeForm
              value={range}
              longest={EVERYONE_WINDOW_SECONDS}
              asOf={data?.as_of ?? null}
              onApply={(next) => {
                cancelMoment();
                update({ from: String(next.from), to: String(next.to), follow: next.follow ? "1" : null, at: null });
              }}
            />
          </div>
          <PinForm pin={pin} onChange={(next) => update({ pin: next ? `${next.x},${next.z}` : null }, true)} />
        </>
      }
      map={
        <div className={`h-full ${load.kind !== "ready" && data ? "opacity-70" : ""}`}>
          {mapId ? (
            <MovementMap
              mapId={mapId}
              mapWorld={mapWorld}
              trails={drawn}
              since={completeFrom}
              until={until}
              cursor={moment}
              hold={hold}
              highlight={highlight}
              pin={pin}
              fitKey={load.kind === "ready" && load.key === viewKey ? viewKey : null}
              onInspect={setMoment}
              className={mapFrameClass}
            />
          ) : null}
        </div>
      }
      strip={
        data ? (
          <Timeline
            since={since}
            until={until}
            unknownUntil={unknownUntil}
            unknownLabel={completeFrom > since ? "too many to show" : "login and logout locations only"}
            bands={bands}
            cursor={moment}
            onCursor={setMoment}
          />
        ) : null
      }
      inspector={
        <>
          {/* Shown while loading too, saying so, so nothing below it moves when the answer comes. */}
          <InspectBar cursor={moment} since={since} until={until} times={times} onCursor={setMoment}>
            {load.kind === "loading"
              ? data
                ? "Loading… showing the previous results"
                : "Loading…"
              : data
                ? `${formatClock(moment, true)} · ${seenNow} of ${drawn.length} players seen or estimated`
                : "Nothing to show."}
          </InspectBar>
          {data && completeFrom > since ? (
            <p className={mutedClass}>
              Too many positions to show; the range starts at {formatMoment(completeFrom)}.
            </p>
          ) : null}
          {data && data.pings_since !== null && data.pings_since > since ? (
            <p className={mutedClass}>Before {formatMoment(data.pings_since)}, only login and logout locations.</p>
          ) : null}
          <div className="flex flex-col gap-2 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-3">
            <input
              aria-label="Search players"
              placeholder="Search players"
              className={inputClass}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--tfmc-cream)]">
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--tfmc-accent)]"
                  checked={onlyChosen}
                  disabled={!chosen.size}
                  onChange={(e) => update({ only: e.target.checked ? "1" : null }, true)}
                />
                Only selected ({chosen.size})
              </label>
              {chosen.size ? (
                <button type="button" className="text-[var(--tfmc-stone)] underline" onClick={() => update({ players: null, only: null }, true)}>
                  Clear selection
                </button>
              ) : null}
            </div>
            {/* Its own scroll on a phone; on wider screens the whole column scrolls. */}
            <ul className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto lg:max-h-none lg:overflow-visible" aria-label="Players in this range">
              {listed.map((trail) => (
                <li
                  key={trail.key}
                  className="flex items-center gap-2 rounded-sm py-1 pr-1 hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]"
                  onMouseEnter={() => setHighlight(trail.key)}
                  onMouseLeave={() => setHighlight(null)}
                >
                  {/* A 44 px tall target around a small box, which lines up with the boxes above. */}
                  <label className="-my-1 flex h-11 w-7 shrink-0 cursor-pointer items-center">
                    <input
                      type="checkbox"
                      aria-label={`Select ${trail.label}`}
                      className="h-4 w-4 accent-[var(--tfmc-accent)]"
                      checked={chosen.has(trail.key)}
                      onChange={() => toggle(trail.key)}
                    />
                  </label>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: trail.colour }} />
                  <Link
                    href={playerHref(trail.key)}
                    className="truncate text-sm text-[var(--tfmc-cream)] hover:underline"
                    onFocus={() => setHighlight(trail.key)}
                    onBlur={() => setHighlight(null)}
                  >
                    {trail.label}
                  </Link>
                  <span className="ml-auto shrink-0 text-right text-xs text-[var(--tfmc-mist)]">
                    {whereText(inspect(trail.stretches, moment, hold), moment, mapWorld)}
                  </span>
                </li>
              ))}
              {data && !all.length ? <li className={mutedClass}>Nobody was seen in this range.</li> : null}
            </ul>
          </div>
        </>
      }
    />
  );
}
