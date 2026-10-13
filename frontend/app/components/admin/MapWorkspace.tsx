import type { CSSProperties, ReactNode } from "react";
import LoadingSkeleton, { Skeleton } from "@/app/components/shared/LoadingSkeleton";

type Props = {
  /** Left: what to show (view, range, filters) and notices. */
  panel: ReactNode;
  /** The map, filling a square frame. */
  map: ReactNode;
  /** Under the map, at its width: the timeline. Fits in STRIP_ROOM. */
  strip?: ReactNode;
  /** Right: who or what is shown, and details of the inspected moment. */
  inspector?: ReactNode;
  /** Height of anything between the staff tabs and the workspace (a CSS length). */
  above?: string;
  /** Below lg, the map before the panel rather than after it. */
  mapFirst?: boolean;
};

/** For the map itself: filling its square, framed. */
export const mapFrameClass =
  "h-full w-full rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)]";

/**
 * Room under every staff map for a timeline (up to eight rows of bands, its labels and its key),
 * kept whether or not the page has one, so the map is one size across the staff tabs.
 */
const STRIP_ROOM = "9rem";

const asideClass = "flex min-w-0 flex-col gap-3";
// Each column scrolls on its own when taller than the map, with room for focus rings at the edge.
const lgScroll = "lg:max-h-[var(--map-h)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1";
const xlScroll = "xl:max-h-[var(--map-h)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1";

/** Keep the staff map's square and side panels in place during its first load. */
export function MapWorkspaceSkeleton({ above, mapFirst }: { above?: string; mapFirst?: boolean }) {
  const panel = (
    <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
      <Skeleton className="h-10 w-40 max-w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
  return (
    <MapWorkspace
      above={above}
      mapFirst={mapFirst}
      panel={panel}
      inspector={panel}
      map={<LoadingSkeleton variant="map" className={`${mapFrameClass} overflow-hidden`} />}
      strip={
        <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-40" />
        </div>
      }
    />
  );
}

/**
 * The staff map pages' layout. On wide screens: a panel, the largest square
 * map the window's height allows with its strip under it, and an inspector,
 * centred together; from lg to xl the inspector moves under the panel. Below
 * lg everything stacks: panel, map and strip, inspector. The map's side never depends on what the
 * panels hold, so selecting something never resizes it.
 */
export default function MapWorkspace({ panel, map, strip, inspector, above = "0px", mapFirst = false }: Props) {
  // The site header, the staff title and tabs (69px), this workspace's top margin and the page's bottom padding.
  const style = {
    "--map-h": `max(26rem, calc(100dvh - var(--tfmc-header-h) - 69px - 2.75rem - ${above}))`,
    "--map-w": `calc(var(--map-h) - ${STRIP_ROOM})`,
  } as CSSProperties;
  return (
    <div
      style={style}
      className="mt-5 flex flex-col gap-6 lg:grid lg:grid-cols-[18rem_minmax(0,var(--map-w))] lg:items-start lg:justify-center xl:grid-cols-[18rem_minmax(0,var(--map-w))_18rem]"
    >
      {/* One scrolling column on lg; below lg and from xl its two panels are laid out on their own. */}
      <div className={`contents lg:col-start-1 lg:row-start-1 lg:flex lg:flex-col lg:gap-6 ${lgScroll} xl:contents`}>
        <aside className={`${asideClass} order-1 lg:order-none xl:col-start-1 xl:row-start-1 ${xlScroll}`}>
          {panel}
        </aside>
        {inspector ? (
          <aside className={`${asideClass} order-3 lg:order-none xl:col-start-3 xl:row-start-1 ${xlScroll}`}>
            {inspector}
          </aside>
        ) : null}
      </div>
      <section
        className={`flex min-w-0 flex-col gap-3 lg:order-none lg:col-start-2 lg:row-start-1 ${mapFirst ? "order-first" : "order-2"}`}
      >
        {/* Clipped, or the map's own content could stretch the square taller than it is wide. */}
        <div className="aspect-square w-full min-h-0 overflow-hidden">{map}</div>
        {strip}
      </section>
    </div>
  );
}
