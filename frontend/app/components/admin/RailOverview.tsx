"use client";

import { useEffect, useMemo, useState } from "react";

import { adminErrorMessage } from "../../../lib/admin/api";
import { formatMoment } from "../../../lib/admin/movement";
import {
  blocks,
  boundsOfPoints,
  getRailNetwork,
  lineColour,
  statusMessage,
  type RailNetwork,
} from "../../../lib/admin/rail";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";
import RailMap, { pointFocus, type RailFocus } from "./RailMap";
import { chipClass, chipOff, mutedClass, useLiveMapId } from "./MovementControls";

type Load =
  | { kind: "loading" }
  | { kind: GateKind }
  | { kind: "failed"; message: string }
  | { kind: "ready"; data: RailNetwork };

const rowClass =
  "flex min-h-11 w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-sm text-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]";

/** The rail network as the server last saved it, on the live map, with its lines, stops and breaks listed. */
export default function RailOverview() {
  const mapId = useLiveMapId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [focus, setFocus] = useState<RailFocus | null>(null);

  useEffect(() => {
    if (!mapId) return;
    let live = true;
    getRailNetwork(mapId)
      .then((data) => {
        if (live) setLoad({ kind: "ready", data });
      })
      .catch((err) => {
        if (!live) return;
        const gate = gateKind(err);
        setLoad(gate !== "error" ? { kind: gate } : { kind: "failed", message: adminErrorMessage(err) });
      });
    return () => {
      live = false;
    };
  }, [mapId, retry]);

  const data = load.kind === "ready" ? load.data : null;
  const problems = useMemo(
    () =>
      data
        ? data.tracks.flatMap((track) =>
            [
              ...track.broken.map((s) => ({ ...s, kind: "Broken" as const })),
              ...track.damaged.map((s) => ({ ...s, kind: "Damaged" as const })),
            ].map((s) => ({ ...s, track: track.id, line: track.line }))
          )
        : [],
    [data]
  );

  if (load.kind === "forbidden") {
    return <p className="mt-6 text-[var(--tfmc-mist)]">The rail map is for admins and the owner only.</p>;
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
  if (!data) return <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>;

  const notice = statusMessage(data.status);
  if (notice) return <p className="mt-6 text-sm text-[#e8c48a]">{notice}</p>;

  const lineById = new Map(data.lines.map((l) => [l.id, l]));
  const focusLine = (id: number) => {
    const line = lineById.get(id);
    const points = data.tracks.filter((t) => t.line === id).flatMap((t) => t.points);
    const bounds = boundsOfPoints(points, 120);
    if (line && bounds) setFocus({ key: `line:${id}:${Date.now()}`, bounds });
  };

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className={mutedClass}>
        The tracks as VehicleFramework last saved them
        {data.updated_at ? `, at ${formatMoment(data.updated_at)}` : ""}. A stop is a settlement whose provinces a
        track crosses; it sits where the track comes closest to the settlement.
      </p>
      {data.unreadable_files ? (
        <p className="text-sm text-[#e8c48a]">
          {data.unreadable_files} track {data.unreadable_files === 1 ? "file" : "files"} couldn’t be read, probably
          mid-save. Reload in a moment.
        </p>
      ) : null}
      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="flex shrink-0 flex-col gap-4 lg:max-h-[calc(100dvh-20rem)] lg:w-80 lg:overflow-y-auto">
          {problems.length ? (
            <section aria-label="Broken and damaged track">
              <h2 className="mb-1 text-sm font-semibold text-[#ff8a80]">Needs repair</h2>
              <ul className="flex flex-col gap-0.5">
                {problems.map((p, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={rowClass}
                      onClick={() => setFocus(pointFocus(`problem:${i}:${Date.now()}`, p.points[0]))}
                      onMouseEnter={() => setHighlight(p.line)}
                      onMouseLeave={() => setHighlight(null)}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: p.kind === "Broken" ? "#ff4d4d" : "#ffb547" }}
                      />
                      <span className="truncate">
                        {p.kind}: {blocks(p.to - p.from)}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-[var(--tfmc-mist)]">
                        {Math.round(p.points[0][0])}, {Math.round(p.points[0][1])}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className={mutedClass}>No broken or damaged track.</p>
          )}
          {data.lines.map((line) => {
            const stops = data.stops.filter((s) => s.line === line.id);
            return (
              <section
                key={line.id}
                aria-label={line.name}
                onMouseEnter={() => setHighlight(line.id)}
                onMouseLeave={() => setHighlight(null)}
              >
                <button type="button" className={`${rowClass} font-semibold`} onClick={() => focusLine(line.id)}>
                  <span className="h-1.5 w-6 shrink-0 rounded-full" style={{ background: lineColour(line) }} />
                  <span className="truncate">{line.name}</span>
                  <span className="ml-auto shrink-0 text-xs font-normal text-[var(--tfmc-mist)]">
                    {blocks(line.length)}
                  </span>
                </button>
                {stops.length ? (
                  <ul className="ml-3 flex flex-col gap-0.5 border-l border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] pl-2">
                    {stops.map((stop) => (
                      <li key={`${stop.name}:${stop.track}`}>
                        <button
                          type="button"
                          className={rowClass}
                          onClick={() => setFocus(pointFocus(`stop:${stop.name}:${Date.now()}`, stop.at))}
                        >
                          <span className="truncate">{stop.name}</span>
                          <span className="ml-auto shrink-0 text-xs text-[var(--tfmc-mist)]">
                            {stop.kind === "faction_capital" ? "capital · " : ""}
                            {Math.round(stop.at[0])}, {Math.round(stop.at[1])}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </aside>
        {/* The map comes first on a phone. */}
        <section className="order-first min-w-0 flex-1 lg:order-none">
          {mapId ? (
            <RailMap
              mapId={mapId}
              network={data}
              highlight={highlight}
              focus={focus}
              className="h-[60vh] min-h-[22rem] rounded-sm lg:h-[calc(100dvh-20rem)]"
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
