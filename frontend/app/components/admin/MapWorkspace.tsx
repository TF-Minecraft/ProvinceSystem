import type { CSSProperties, ReactNode } from "react";

type Props = {
  /** Left: what to show (view, range, filters) and notices. */
  panel: ReactNode;
  /** The map, filling a square frame. */
  map: ReactNode;
  /** Under the map, at its width: the timeline. */
  strip?: ReactNode;
  /** Right: who or what is shown, and details of the inspected moment. */
  inspector?: ReactNode;
  /** Height the strip needs, taken from the map's side so map and strip fit together (a CSS length). */
  stripHeight?: string;
  /** Height of anything between the staff tabs and the workspace (a CSS length). */
  above?: string;
  /** Below lg, the map before the panel rather than after it. */
  mapFirst?: boolean;
};

/** For the map itself: filling its square, framed. */
export const mapFrameClass = "h-full w-full rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)]";

const asideClass = "flex min-w-0 flex-col gap-3";
// Each column scrolls on its own when taller than the map, with room for focus rings at the edge.
const lgScroll = "lg:max-h-[var(--map-h)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1";
const xlScroll = "xl:max-h-[var(--map-h)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1";

/**
 * The staff map pages' layout. On wide screens: a panel, the largest square
 * map the window's height allows with its strip under it, and an inspector,
 * centred together; from lg to xl the inspector moves under the panel. Below
 * lg everything stacks: panel, map and strip, inspector. The map's side never depends on what the
 * panels hold, so selecting something never resizes it.
 */
export default function MapWorkspace({ panel, map, strip, inspector, stripHeight = "0px", above = "0px", mapFirst = false }: Props) {
  // The site header, the staff title and tabs (69px), this workspace's top margin and the page's bottom padding.
  const style = {
    "--map-h": `max(26rem, calc(100dvh - var(--tfmc-header-h) - 69px - 2.75rem - ${above}))`,
    "--map-w": `calc(var(--map-h) - ${stripHeight})`,
  } as CSSProperties;
  return (
    <div
      style={style}
      className="mt-5 flex flex-col gap-6 lg:grid lg:grid-cols-[18rem_minmax(0,var(--map-w))] lg:items-start lg:justify-center xl:grid-cols-[18rem_minmax(0,var(--map-w))_18rem]"
    >
      {/* One scrolling column on lg; below lg and from xl its two panels are laid out on their own. */}
      <div className={`contents lg:col-start-1 lg:row-start-1 lg:flex lg:flex-col lg:gap-6 ${lgScroll} xl:contents`}>
        <aside className={`${asideClass} order-1 lg:order-none xl:col-start-1 xl:row-start-1 ${xlScroll}`}>{panel}</aside>
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
