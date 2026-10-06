"use client";

import { useEffect, useMemo, useState } from "react";

import { AccountApiError } from "../../../lib/account/api";
import { adminErrorMessage, coreProtectMessage } from "../../../lib/admin/api";
import {
  PLAYER_PRESETS,
  distanceTravelled,
  getPlayerMovement,
  positionAt,
  stretches,
  timeByWorld,
  worldLabel,
  type PlayerMovement as Movement,
} from "../../../lib/admin/movement";
import { formatDuration, formatEpoch } from "../../../lib/admin/time";
import MovementMap from "./MovementMap";
import { TimeSlider, WindowControls, useLiveMapId, useMovementWindow } from "./MovementControls";

const mutedClass = "text-sm text-[var(--tfmc-mist)]";

type Load =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; data: Movement };

/**
 * A player's path over a window of time, on the live map: once-a-minute
 * pings joined into lines, with a slider for where they were at a moment.
 * Admins and the owner only (each view is audited); others see nothing.
 */
export default function PlayerMovement({ uuid, name }: { uuid: string; name: string }) {
  const mapId = useLiveMapId();
  const { win, change, since, until } = useMovementWindow({ duration: 3600, end: null });
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [cursor, setCursor] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let live = true;
    setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    getPlayerMovement(uuid, since, until)
      .then((data) => live && setLoad({ kind: "ready", data }))
      .catch((err) => {
        if (!live) return;
        const forbidden = err instanceof AccountApiError && err.status === 403;
        setLoad(forbidden ? { kind: "forbidden" } : { kind: "failed", message: adminErrorMessage(err) });
      });
    return () => {
      live = false;
    };
  }, [uuid, since, until]);

  // A new window starts the marker on its newest moment.
  useEffect(() => setCursor(null), [win]);

  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);

  const data = load.kind === "ready" ? load.data : null;
  const parts = useMemo(
    () => (data ? stretches(data.points, data.worlds, data.coreprotect.ping_seconds) : []),
    [data]
  );
  const trails = useMemo(() => [{ key: uuid, label: name, stretches: parts }], [uuid, name, parts]);

  if (load.kind === "forbidden") return null;

  const notice = data ? coreProtectMessage(data.coreprotect) : null;
  const mapWorld = data?.coreprotect.map_world ?? "TFMC_Map";
  // A window cut short starts where the answer is complete.
  const shownSince = data ? data.complete_from : since;
  const shownUntil = data?.until ?? until;
  const at = positionAt(parts, cursor ?? shownUntil);
  const byWorld = timeByWorld(parts);
  const elsewhere = [...byWorld].filter(([world, seconds]) => world !== mapWorld && seconds > 0);
  const seen = [...byWorld.values()].reduce((a, b) => a + b, 0);

  return (
    <section
      className={
        expanded
          ? "fixed inset-0 z-50 flex flex-col gap-3 bg-[var(--tfmc-forest-deep)] p-4"
          : "mt-6 flex flex-col gap-3 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_28%,transparent)] p-5"
      }
      aria-label="Movement"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">Movement</h3>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
        >
          {expanded ? "Close full screen" : "Full screen"}
        </button>
      </div>
      <WindowControls presets={PLAYER_PRESETS} win={win} onChange={change} busy={load.kind === "loading"} />
      {load.kind === "failed" ? (
        <p className="text-sm text-[#e8a0a0]" role="alert">
          {load.message}
        </p>
      ) : null}
      {notice ? <p className={mutedClass}>{notice}</p> : null}
      {mapId ? (
        <MovementMap
          mapId={mapId}
          mapWorld={mapWorld}
          trails={trails}
          since={shownSince}
          until={shownUntil}
          cursor={cursor ?? shownUntil}
          className={expanded ? "min-h-0 flex-1 rounded-sm" : "h-[28rem] rounded-sm"}
        />
      ) : (
        <div className={expanded ? "flex-1" : "h-[28rem]"} />
      )}
      <TimeSlider since={shownSince} until={shownUntil} cursor={cursor} onChange={setCursor} />
      {data ? (
        <div className={`${mutedClass} flex flex-col gap-1`}>
          <p>
            {at
              ? at.world === mapWorld
                ? at.exact
                  ? `Seen at ${Math.round(at.x)}, ${Math.round(at.z)}.`
                  : `Between pings, near ${Math.round(at.x)}, ${Math.round(at.z)} (a straight-line guess).`
                : `In ${worldLabel(at.world)}.`
              : "Not seen at that moment: offline, or between sightings."}
          </p>
          {parts.length ? (
            <p>
              Seen for about {formatDuration(seen)} in this window, about{" "}
              {Math.round(distanceTravelled(parts)).toLocaleString()} blocks walked or ridden
              {elsewhere.length
                ? `; about ${elsewhere.map(([world, seconds]) => `${formatDuration(seconds)} in ${worldLabel(world)}`).join(", ")}`
                : ""}
              . Dashed lines are movement nobody saw: too fast to have walked, perhaps a teleport.
            </p>
          ) : (
            <p>No positions logged in this window.</p>
          )}
          {data.pings_since !== null && data.pings_since > shownSince ? (
            <p>Positions are logged once a minute only since {formatEpoch(data.pings_since)}; before that, only logins and logouts.</p>
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
