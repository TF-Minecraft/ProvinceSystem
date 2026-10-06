"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";
import MovementMap, { type MapPin, type MovementTrail } from "./MovementMap";
import {
  CopyButton,
  InspectBar,
  PinForm,
  RangeForm,
  Timeline,
  chipClass,
  chipOff,
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
  | { kind: "ready"; data: Movement };

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
      return "unobserved transition";
    case "stale":
      return `${place(found.before.x, found.before.z, found.world)} · ${formatDuration(moment - found.before.time).toLowerCase()} before`;
    default:
      return "not observed";
  }
}

/** Every player's movement over a range on one map, compared at one inspected moment. */
export default function EveryoneMovement() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const mapId = useLiveMapId();

  const [opened] = useState(() => Math.floor(Date.now() / 1000));
  const from = intParam(search.get("from")) ?? opened - 3600;
  const to = intParam(search.get("to")) ?? opened;
  const follow = search.get("follow") === "1";
  const at = intParam(search.get("at"));
  const pin = pinParam(search.get("pin"));
  const chosen = useMemo(() => new Set((search.get("players") ?? "").split(",").filter(Boolean)), [search]);
  const [onlyChosen, setOnlyChosen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);

  const update = useCallback(
    (changes: Record<string, string | null>, replace = false) => {
      const next = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      const url = `${pathname}?${next.toString()}`;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [pathname, router, search]
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
      .then((data) => live && setLoad({ kind: "ready", data }))
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
    () => observationTimes(drawn.flatMap((t) => clipStretches(t.stretches, since, until))),
    [drawn, since, until]
  );

  if (load.kind === "forbidden") {
    return <p className="mt-6 text-[var(--tfmc-mist)]">Movement is for admins and the owner only.</p>;
  }
  if (load.kind === "signed_out" || load.kind === "unavailable" || load.kind === "error") {
    return <StaffGateMessage kind={load.kind} />;
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
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={mutedClass}>
          {data?.coreprotect.server_label ? `${data.coreprotect.server_label} · ` : ""}
          Everyone online over a range of up to 24 hours. Positions are recorded once a minute; lines between them are
          estimates. Each view is logged.
        </p>
        {data ? <CopyButton text={shareUrl()} label="Copy link to this view" /> : null}
      </div>
      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="flex shrink-0 flex-col gap-3 lg:w-80">
          <RangeForm
            value={range}
            longest={EVERYONE_WINDOW_SECONDS}
            asOf={data?.as_of ?? null}
            onApply={(next) =>
              update({ from: String(next.from), to: String(next.to), follow: next.follow ? "1" : null, at: null })
            }
          />
          <div className="flex flex-col gap-2 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-3">
            <input
              aria-label="Search players"
              placeholder="Search players"
              className={inputClass}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--tfmc-cream)]">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--tfmc-accent)]"
                  checked={onlyChosen}
                  disabled={!chosen.size}
                  onChange={(e) => setOnlyChosen(e.target.checked)}
                />
                Only selected ({chosen.size})
              </label>
              {chosen.size ? (
                <button type="button" className="text-[var(--tfmc-stone)] underline" onClick={() => update({ players: null }, true)}>
                  Clear selection
                </button>
              ) : null}
            </div>
            <ul className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto" aria-label="Players in this range">
              {listed.map((trail) => (
                <li
                  key={trail.key}
                  className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]"
                  onMouseEnter={() => setHighlight(trail.key)}
                  onMouseLeave={() => setHighlight(null)}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${trail.label}`}
                    className="h-4 w-4 shrink-0 accent-[var(--tfmc-accent)]"
                    checked={chosen.has(trail.key)}
                    onChange={() => toggle(trail.key)}
                  />
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
              {data && !all.length ? <li className={mutedClass}>Nobody was observed in this range.</li> : null}
            </ul>
          </div>
          <PinForm pin={pin} onChange={(next) => update({ pin: next ? `${next.x},${next.z}` : null }, true)} />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col gap-3">
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
          <div className={load.kind !== "ready" && data ? "opacity-70" : ""}>
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
                fitKey={load.kind === "ready" ? viewKey : null}
                onInspect={(time) => update({ at: String(time) }, true)}
                className="h-[60vh] min-h-[22rem] rounded-sm lg:h-[calc(100dvh-24rem)]"
              />
            ) : (
              <div className="h-[60vh] min-h-[22rem]" />
            )}
          </div>
          {data ? (
            <>
              <Timeline
                since={since}
                until={until}
                unknownUntil={unknownUntil}
                unknownLabel={completeFrom > since ? "earlier observations omitted" : "before available position observations"}
                bands={bands}
                cursor={moment}
                onCursor={(time) => update({ at: String(time) }, true)}
              />
              <InspectBar cursor={moment} since={since} until={until} times={times} onCursor={(time) => update({ at: String(time) }, true)}>
                Inspecting {formatClock(moment, true)} · {seenNow} of {drawn.length} players observed or estimated at this
                moment. Positions in the list are as of this moment.
              </InspectBar>
              {completeFrom > since ? (
                <p className={mutedClass}>
                  Earlier observations omitted: too many to show, so the range starts at {formatMoment(completeFrom)}.
                </p>
              ) : null}
              {data.pings_since !== null && data.pings_since > since ? (
                <p className={mutedClass}>Before {formatMoment(data.pings_since)} there are no available position observations.</p>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
