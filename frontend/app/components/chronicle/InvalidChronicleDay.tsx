import Link from "next/link";

import { mapDisplayName, type MapId } from "../map/types";
import {
  chronicleStudioHref,
  liveMapHref,
} from "../../lib/map/chronicleDayRoute";

const linkClass =
  "text-xs text-[var(--tfmc-accent)] underline-offset-2 hover:underline";

/**
 * What a `[day]` route renders when the URL segment is not an exact
 * `YYYY-MM-DD`. Deliberately a plain, server-rendered state: nothing is
 * fetched, and the offending segment is never echoed back into the page or
 * into a request, so a crafted URL gets a dead end rather than a reflection.
 *
 * A server component on purpose — the route decides this before any client
 * bundle or map engine is involved.
 */
export default function InvalidChronicleDay({ mapId }: { mapId: MapId }) {
  return (
    <div className="flex min-h-[calc(100dvh-var(--tfmc-header-h))] flex-col items-center justify-center gap-3 bg-[var(--tfmc-forest-deep)] px-6 text-center">
      <p className="text-xs font-medium uppercase tracking-widest text-[var(--tfmc-mist)]">
        {mapDisplayName(mapId)} timelapse
      </p>
      <p className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
        Not a valid date
      </p>
      <p className="max-w-md text-sm leading-snug text-[var(--tfmc-stone)]">
        Pick a day from the timelapse instead.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <Link href={chronicleStudioHref(mapId)} className={linkClass}>
          &larr; Back to the timelapse
        </Link>
        <Link href={liveMapHref(mapId)} className={linkClass}>
          Live map &rarr;
        </Link>
      </div>
    </div>
  );
}
