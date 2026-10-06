"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { adminErrorMessage, coreProtectMessage } from "../../../lib/admin/api";
import {
  EVERYONE_PRESETS,
  gapSeconds,
  getEveryoneMovement,
  playerColour,
  positionAt,
  stretches,
  worldLabel,
  type EveryoneMovement as Movement,
} from "../../../lib/admin/movement";
import { formatEpoch } from "../../../lib/admin/time";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";
import MovementMap, { type MovementTrail } from "./MovementMap";
import { TimeSlider, WindowControls, useLiveMapId, useMovementWindow } from "./MovementControls";

const mutedClass = "text-sm text-[var(--tfmc-mist)]";

type Load =
  | { kind: "loading" }
  | { kind: GateKind }
  | { kind: "failed"; message: string }
  | { kind: "ready"; data: Movement };

/** Every player's path over a window of time on one map, with a slider for where everyone was at a moment. */
export default function EveryoneMovement() {
  const mapId = useLiveMapId();
  const { win, change, since, until } = useMovementWindow({ duration: 3600, end: null });
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [cursor, setCursor] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    getEveryoneMovement(since, until)
      .then((data) => live && setLoad({ kind: "ready", data }))
      .catch((err) => {
        if (!live) return;
        const gate = gateKind(err);
        setLoad(gate === "error" ? { kind: "failed", message: adminErrorMessage(err) } : { kind: gate });
      });
    return () => {
      live = false;
    };
  }, [since, until]);

  useEffect(() => setCursor(null), [win]);

  const data = load.kind === "ready" ? load.data : null;
  const trails = useMemo<MovementTrail[]>(
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

  if (load.kind === "forbidden") {
    return <p className="mt-6 text-[var(--tfmc-mist)]">Movement is for admins and the owner only.</p>;
  }
  if (load.kind !== "loading" && load.kind !== "ready" && load.kind !== "failed") {
    return <StaffGateMessage kind={load.kind} />;
  }

  const mapWorld = data?.coreprotect.map_world ?? "TFMC_Map";
  // A window cut short starts where the answer is complete.
  const shownSince = data ? data.complete_from : since;
  const shownUntil = data?.until ?? until;
  const moment = cursor ?? shownUntil;
  const hold = gapSeconds(data?.coreprotect.ping_seconds);
  const notice = data ? coreProtectMessage(data.coreprotect) : null;

  return (
    <section className="mt-6 flex flex-col gap-3" aria-label="Everyone's movement">
      <WindowControls presets={EVERYONE_PRESETS} win={win} onChange={change} busy={load.kind === "loading"} />
      {load.kind === "failed" ? (
        <p className="text-sm text-[#e8a0a0]" role="alert">
          {load.message}
        </p>
      ) : null}
      {notice ? <p className={mutedClass}>{notice}</p> : null}
      <div className="flex flex-col gap-3 lg:flex-row">
        {mapId ? (
          <MovementMap
            mapId={mapId}
            mapWorld={mapWorld}
            trails={trails}
            since={shownSince}
            until={shownUntil}
            cursor={moment}
            hold={hold}
            highlight={highlight}
            className="h-[70vh] flex-1 rounded-sm"
          />
        ) : (
          <div className="h-[70vh] flex-1" />
        )}
        <ul className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto lg:w-60" aria-label="Players in this window">
          {trails.map((trail) => {
            const at = positionAt(trail.stretches, moment, hold);
            return (
              <li key={trail.key}>
                <Link
                  href={`/admin/players/${encodeURIComponent(trail.key)}`}
                  onMouseEnter={() => setHighlight(trail.key)}
                  onMouseLeave={() => setHighlight(null)}
                  onFocus={() => setHighlight(trail.key)}
                  onBlur={() => setHighlight(null)}
                  className="flex items-center gap-2 rounded-sm px-2 py-1 text-sm text-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: trail.colour }} />
                  <span className="truncate">{trail.label}</span>
                  <span className="ml-auto shrink-0 text-xs text-[var(--tfmc-mist)]">
                    {at ? (at.world === mapWorld ? `${Math.round(at.x)}, ${Math.round(at.z)}` : worldLabel(at.world)) : "not seen"}
                  </span>
                </Link>
              </li>
            );
          })}
          {data && !trails.length ? <li className={mutedClass}>Nobody was online in this window.</li> : null}
        </ul>
      </div>
      <TimeSlider since={shownSince} until={shownUntil} cursor={cursor} onChange={setCursor} />
      {data ? (
        <div className={`${mutedClass} flex flex-col gap-1`}>
          <p>
            Positions are logged once a minute; lines between them are guesses, and dashed lines are movement nobody
            saw (too fast to have walked, perhaps a teleport).
          </p>
          {data.pings_since !== null && data.pings_since > shownSince ? (
            <p>Positions are logged only since {formatEpoch(data.pings_since)}.</p>
          ) : null}
          {data.complete_from > data.since ? (
            <p>
              This window has too many points to show, so it starts at {formatEpoch(data.complete_from)}. Choose a
              shorter one to see earlier.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
