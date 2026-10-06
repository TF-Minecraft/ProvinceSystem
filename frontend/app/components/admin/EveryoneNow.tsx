"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { adminErrorMessage, coreProtectMessage } from "../../../lib/admin/api";
import {
  formatAge,
  formatClock,
  gapSeconds,
  getLatestMovement,
  latestPositions,
  playerColour,
  worldLabel,
  type EveryoneMovement as Movement,
  type LatestPosition,
} from "../../../lib/admin/movement";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";
import MovementMap, { type MovementTrail } from "./MovementMap";
import { chipClass, chipOff, inputClass, mutedClass, useLiveMapId } from "./MovementControls";

/** How often the view asks again. Each player's row is at most a ping interval old when it is read. */
export const NOW_REFRESH_MS = 20_000;
/** How often the ages shown tick over between refreshes. */
const AGE_TICK_MS = 5_000;

type Load =
  | { kind: "loading" }
  | { kind: GateKind }
  | { kind: "failed"; message: string }
  | { kind: "ready"; data: Movement; fetchedAt: number; error: string | null };

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Where everyone online is now: each player's newest CoreProtect row, asked
 * for again every NOW_REFRESH_MS while the page is visible. Rows are pings
 * once a minute, so a position can be up to a minute (plus a refresh) old.
 */
export default function EveryoneNow() {
  const mapId = useLiveMapId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [clock, setClock] = useState(nowSeconds);
  const [retry, setRetry] = useState(0);

  const ping = load.kind === "ready" ? load.data.coreprotect.ping_seconds : null;
  const hold = gapSeconds(ping);

  useEffect(() => {
    let live = true;
    // Requests can overlap (a slow one, then the tab coming back): only the latest may answer.
    let latest = 0;
    const ask = () => {
      if (document.hidden) return;
      const mine = ++latest;
      getLatestMovement(nowSeconds() - hold)
        .then((data) => {
          if (live && mine === latest) setLoad({ kind: "ready", data, fetchedAt: nowSeconds(), error: null });
        })
        .catch((err) => {
          if (!live || mine !== latest) return;
          const gate = gateKind(err);
          // A failed refresh keeps the last positions on show, saying so.
          setLoad((prev) =>
            gate !== "error"
              ? { kind: gate }
              : prev.kind === "ready"
                ? { ...prev, error: adminErrorMessage(err) }
                : { kind: "failed", message: adminErrorMessage(err) }
          );
        });
    };
    ask();
    const timer = window.setInterval(ask, NOW_REFRESH_MS);
    // Back on the tab: catch up at once rather than at the next tick.
    const onVisible = () => {
      if (!document.hidden) ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hold, retry]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(nowSeconds()), AGE_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const data = load.kind === "ready" ? load.data : null;
  // The server's clock now: its answer's time plus however long ago that answer came.
  const serverNow =
    load.kind === "ready" ? (load.data.as_of ?? load.fetchedAt) + Math.max(0, clock - load.fetchedAt) : clock;
  const positions = useMemo(
    () => (data ? latestPositions(data, data.as_of ?? data.until, hold) : []),
    [data, hold]
  );
  const trails = useMemo<MovementTrail[]>(
    () =>
      positions.map((p) => ({
        key: p.uuid,
        label: p.name,
        colour: playerColour(p.uuid),
        stretches: [{ world: p.world, samples: [{ time: p.time, x: p.x, y: p.y, z: p.z, action: p.action }] }],
      })),
    [positions]
  );

  if (load.kind === "forbidden") {
    return <p className="mt-6 text-[var(--tfmc-mist)]">Movement is for admins and the owner only.</p>;
  }
  if (load.kind === "signed_out" || load.kind === "unavailable" || load.kind === "error") {
    return <StaffGateMessage kind={load.kind} />;
  }
  if (load.kind === "failed") {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <p className="text-sm text-[#e8a0a0]" role="alert">
          {load.message}
        </p>
        <button type="button" className={`${chipClass} ${chipOff}`} onClick={() => setRetry((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  }

  const mapWorld = data?.coreprotect.map_world ?? "TFMC_Map";
  const notice = data ? coreProtectMessage(data.coreprotect) : null;
  const needle = query.trim().toLowerCase();
  const listed = positions.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  const elsewhere = positions.filter((p) => p.world !== mapWorld).length;
  const where = (p: LatestPosition) =>
    p.world === mapWorld ? `${Math.round(p.x)}, ${Math.round(p.z)}` : worldLabel(p.world);

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className={mutedClass}>
        {data?.coreprotect.server_label ? `${data.coreprotect.server_label} · ` : ""}
        Where everyone online is now: each player&rsquo;s latest recorded position. Positions are recorded once a
        minute, so one can be up to a minute old. Refreshes every {NOW_REFRESH_MS / 1000} seconds; each refresh is
        logged.
      </p>
      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="flex shrink-0 flex-col gap-3 lg:w-80">
          <p className="text-sm text-[var(--tfmc-cream)]" aria-live="polite">
            {data
              ? `${positions.length} ${positions.length === 1 ? "player" : "players"} online · updated ${formatClock(
                  data.as_of ?? data.until,
                  true
                )}`
              : "Loading…"}
          </p>
          {elsewhere ? <p className={mutedClass}>{elsewhere} in another world, listed but not on the map.</p> : null}
          <input
            aria-label="Search players"
            placeholder="Search players"
            className={inputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto" aria-label="Players online">
            {listed.map((p) => (
              <li
                key={p.uuid}
                className="flex min-h-11 items-center gap-2 rounded-sm px-1 py-1 hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]"
                onMouseEnter={() => setHighlight(p.uuid)}
                onMouseLeave={() => setHighlight(null)}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: playerColour(p.uuid) }} />
                <Link
                  href={`/admin/players/${encodeURIComponent(p.uuid)}/movement`}
                  className="truncate text-sm text-[var(--tfmc-cream)] hover:underline"
                  onFocus={() => setHighlight(p.uuid)}
                  onBlur={() => setHighlight(null)}
                >
                  {p.name}
                </Link>
                <span className="ml-auto shrink-0 text-right text-xs text-[var(--tfmc-mist)]">
                  {where(p)} · {formatAge(serverNow - p.time)}
                </span>
              </li>
            ))}
            {data && !positions.length ? <li className={mutedClass}>Nobody is online.</li> : null}
          </ul>
        </aside>
        {/* The map comes first on a phone, above a list that can run long. */}
        <section className="order-first flex min-w-0 flex-1 flex-col gap-3 lg:order-none">
          {notice ? <p className="text-sm text-[#e8c48a]">{notice}</p> : null}
          {load.kind === "ready" && load.error ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-[#e8a0a0]" role="alert">
                {load.error} Showing positions from {formatClock(load.data.as_of ?? load.data.until, true)}.
              </p>
              <button type="button" className={`${chipClass} ${chipOff}`} onClick={() => setRetry((n) => n + 1)}>
                Retry
              </button>
            </div>
          ) : null}
          {mapId ? (
            <MovementMap
              mapId={mapId}
              mapWorld={mapWorld}
              trails={trails}
              since={data?.since ?? clock}
              until={data?.as_of ?? clock}
              cursor={data?.as_of ?? clock}
              hold={hold}
              highlight={highlight}
              fitKey={data ? "now" : null}
              latest
              className="h-[60vh] min-h-[22rem] rounded-sm lg:h-[calc(100dvh-20rem)]"
            />
          ) : (
            <div className="h-[60vh] min-h-[22rem]" />
          )}
        </section>
      </div>
    </div>
  );
}
