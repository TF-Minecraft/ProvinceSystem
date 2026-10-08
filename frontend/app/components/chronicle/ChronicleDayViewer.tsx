"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import MapViewer from "../MapViewer";
import MapAccessGate, { type MapAccessGateReason } from "../map/MapAccessGate";
import { mapDisplayName, type MapId } from "../map/types";
import { useAccessibleMaps } from "../../hooks/useAccessibleMaps";
import { useCharacterSessionToken } from "../../hooks/useCharacterSessionToken";
import {
  MapAccessError,
  mapRequiresAuth,
  staffMapAccessReason,
} from "@/lib/map/api";
import {
  fetchChronicleIndex,
  type ChronicleIndex,
} from "../../lib/map/chronicleData";
import {
  chronicleDayHref,
  chronicleDayWalk,
  chronicleStudioHref,
  liveMapHref,
  parseChronicleDayRange,
  type ChronicleDayRange,
} from "../../lib/map/chronicleDayRoute";
import { useChronicleDay } from "../../lib/map/chronicleDayContext";
import { formatChronicleDay } from "../../lib/map/chronicleDayLabel";
import { BackIcon, ChevronIcon } from "../map/shell/MapIcons";
import { chroniclePanelClass } from "./ChroniclePanels";

const bannerLinkClass =
  "text-xs text-[var(--tfmc-accent)] underline-offset-2 hover:underline";

const shellClass =
  "flex min-h-[calc(100dvh-var(--tfmc-header-h))] flex-col items-center justify-center gap-3 bg-[var(--tfmc-forest-deep)] px-6 text-center";

/**
 * What the chronicle index says about the requested day.
 *
 * `unknown-day` is deliberately separate from `error`: a day that was never
 * captured, or that has since been wiped, is a normal answer and must produce
 * a page that says so. Rendering the map anyway would put an empty world under
 * a real date, which reads as "everything vanished on this day" rather than
 * "we have no record of this day".
 */
type DayStatus =
  | { kind: "loading" }
  | { kind: "gated"; reason: MapAccessGateReason }
  | { kind: "error"; message: string }
  | { kind: "unknown-day" }
  | {
      kind: "ready";
      incomplete: boolean;
      staleGeometry: boolean;
      // Carried through so the banner can walk to the neighbouring days without
      // fetching the index a second time.
      days: string[];
    };

/**
 * Everything read out of the index is shape-checked before it is iterated.
 * There is no React error boundary anywhere under `app/`, so a `null` or a
 * bare string where an array is expected would blank the entire page instead
 * of one panel.
 *
 * Note `incomplete_days` is an array of `{ day, missing, invalid }` objects,
 * not an array of day strings — see `ChronicleIncompleteDay` in
 * `chronicleData.ts`.
 */
export function describeChronicleDay(
  index: ChronicleIndex,
  day: string
): DayStatus {
  const days = Array.isArray(index.days) ? index.days : [];
  if (!days.includes(day)) return { kind: "unknown-day" };

  const entries = Array.isArray(index.incomplete_days)
    ? index.incomplete_days
    : [];
  const incomplete = entries.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { day?: unknown }).day === day
  );

  /**
   * Optional field: the backend may not send `stale_geometry_days` at all, and
   * when it does it is a plain array of day strings. Read through a cast
   * rather than the `ChronicleIndex` type so an older backend (field absent)
   * behaves exactly as before.
   */
  const staleDays = (index as { stale_geometry_days?: unknown })
    .stale_geometry_days;
  const staleGeometry = Array.isArray(staleDays) ? staleDays.includes(day) : false;

  return { kind: "ready", incomplete, staleGeometry, days };
}

/**
 * The day bar, and the single most important element on this page: a
 * screenshot of a stored day must carry its date.
 *
 * It sits in the map shell's left column over the search, so it is on screen
 * at every size and nothing has to make room for it: back to the timelapse,
 * the day before, the date, the day after.
 */
function ChronicleDayBar({
  mapId,
  day,
  incomplete,
  staleGeometry,
  range,
  walk,
}: {
  mapId: MapId;
  day: string;
  incomplete: boolean;
  staleGeometry: boolean;
  range: ChronicleDayRange | null;
  walk: ReturnType<typeof chronicleDayWalk>;
}) {
  const stepClass = "map-control h-10 w-10 shrink-0 rounded-full p-0";
  return (
    <div className={`${chroniclePanelClass} p-2`} role="status">
      <div className="flex items-center gap-1.5">
        <Link
          href={chronicleStudioHref(mapId)}
          className={stepClass}
          aria-label="Back to the timelapse"
          title="Back to the timelapse"
        >
          <BackIcon size={18} />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          {walk.total > 0 && walk.position > 0 ? (
            <p className="truncate text-xs text-[var(--tfmc-mist)]">
              Day {walk.position} of {walk.total}
            </p>
          ) : null}
          <p className="truncate font-[family-name:var(--font-fraunces)] text-xl leading-tight text-[var(--tfmc-cream)]">
            {formatChronicleDay(day)}
          </p>
        </div>
        {/* Dimmed rather than dropped at the ends, so the date does not shift
            as the reader steps through the days. */}
        {walk.previous ? (
          <Link
            href={chronicleDayHref(mapId, walk.previous, range)}
            className={stepClass}
            aria-label="Previous day"
            title="Previous day"
          >
            <ChevronIcon size={18} className="rotate-180" />
          </Link>
        ) : (
          <span className={`${stepClass} opacity-40`} aria-hidden>
            <ChevronIcon size={18} className="rotate-180" />
          </span>
        )}
        {walk.next ? (
          <Link
            href={chronicleDayHref(mapId, walk.next, range)}
            className={stepClass}
            aria-label="Next day"
            title="Next day"
          >
            <ChevronIcon size={18} />
          </Link>
        ) : (
          <span className={`${stepClass} opacity-40`} aria-hidden>
            <ChevronIcon size={18} />
          </span>
        )}
      </div>
      {incomplete ? (
        <p className="mt-1.5 px-1 text-xs leading-snug text-[var(--tfmc-accent)]">
          Parts of this day may be missing.
        </p>
      ) : null}
      {staleGeometry ? (
        <p className="mt-1.5 px-1 text-xs leading-snug text-[var(--tfmc-accent)]">
          Borders may not line up on this day.
        </p>
      ) : null}
    </div>
  );
}

function ChronicleDayFallbackLinks({ mapId }: { mapId: MapId }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      <Link href={chronicleStudioHref(mapId)} className={bannerLinkClass}>
        &larr; Back to the timelapse
      </Link>
      <Link href={liveMapHref(mapId)} className={bannerLinkClass}>
        Live map &rarr;
      </Link>
    </div>
  );
}

/**
 * One stored day of a map, explorable with the full live-map interaction set.
 *
 * `MapViewer` takes the day as a **prop**, not from `ChronicleDayContext`, so
 * the data flow stays visible at the call site. The provider wrapped around
 * this component by the route is there for anything deeper that needs the day
 * without a prop chain; it is read here and preferred, with the prop as the
 * guaranteed fallback so a missing provider can never quietly hand `null` to
 * `MapViewer` and render the live map under a historical date.
 */
export default function ChronicleDayViewer({
  mapId,
  day,
}: {
  mapId: MapId;
  day: string;
}) {
  const sessionToken = useCharacterSessionToken();
  const { maps } = useAccessibleMaps();
  const authToken = mapRequiresAuth(mapId, maps) ? sessionToken : null;
  const displayName = mapDisplayName(mapId, maps);

  const contextDay = useChronicleDay();
  const activeDay = contextDay ?? day;

  const [status, setStatus] = useState<DayStatus>({ kind: "loading" });

  /**
   * The timelapse the reader arrived from, if any. Nothing here is trusted —
   * these are query values anyone can type — so a malformed pair simply means
   * previous/next walks every stored day instead.
   */
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const range = useMemo(() => parseChronicleDayRange(from, to), [from, to]);

  const walk = useMemo(
    () =>
      chronicleDayWalk(
        status.kind === "ready" ? status.days : [],
        activeDay,
        range
      ),
    [status, activeDay, range]
  );

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });

    fetchChronicleIndex(mapId, authToken)
      .then((index) => {
        if (cancelled) return;
        // A 200 whose body is not an object at all would otherwise reach
        // `Array.isArray(index.days)` on a null and throw during the effect.
        if (typeof index !== "object" || index === null) {
          setStatus({
            kind: "error",
            message: "The chronicle index came back in an unreadable shape.",
          });
          return;
        }
        setStatus(describeChronicleDay(index, activeDay));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof MapAccessError && err.status === 403) {
          setStatus({ kind: "gated", reason: staffMapAccessReason(err) });
          return;
        }
        setStatus({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Failed to load the chronicle index.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [mapId, authToken, activeDay]);

  if (status.kind === "gated") {
    return (
      <MapAccessGate reason={status.reason} mapDisplayName={displayName} />
    );
  }

  if (status.kind === "loading") {
    return (
      <div className={shellClass}>
        <p className="text-lg font-medium text-[var(--tfmc-cream)]">
          Loading…
        </p>
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className={shellClass}>
        <p className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
          Couldn&rsquo;t load this day
        </p>
        <p className="max-w-md text-sm leading-snug text-[var(--tfmc-accent)]">
          {status.message}
        </p>
        <ChronicleDayFallbackLinks mapId={mapId} />
      </div>
    );
  }

  if (status.kind === "unknown-day") {
    return (
      <div className={shellClass}>
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--tfmc-mist)]">
          {displayName} timelapse
        </p>
        <p className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
          No record of {formatChronicleDay(activeDay)}
        </p>
        <p className="max-w-md text-sm leading-snug text-[var(--tfmc-stone)]">
          Nothing was recorded for this day.
        </p>
        <ChronicleDayFallbackLinks mapId={mapId} />
      </div>
    );
  }

  return (
    <MapViewer
      mapId={mapId}
      day={activeDay}
      dayBar={
        <ChronicleDayBar
          mapId={mapId}
          day={activeDay}
          incomplete={status.incomplete}
          staleGeometry={status.staleGeometry}
          range={range}
          walk={walk}
        />
      }
      dayActions={
        <Link href={liveMapHref(mapId)} className="map-control h-9 px-2.5 text-xs no-underline">
          Live map
        </Link>
      }
    />
  );
}
