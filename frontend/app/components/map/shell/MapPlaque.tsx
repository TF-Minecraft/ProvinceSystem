import type { ReactNode } from "react";
import { mapFrameClass } from "../ui";

type MapPlaqueProps = {
  /** Small caps over the name, e.g. "Archived chapter". */
  eyebrow?: string;
  mapDisplayName: string;
  /** Icon buttons beside the name: history, archive, edit titles. */
  actions?: ReactNode;
  search?: ReactNode;
  /** The desktop selection drawer supplies its frame. */
  docked?: boolean;
};

/**
 * The map's name plate with the search box under it, top left. On a phone it
 * is one slim row, search and actions: the search box already names the map
 * ("Search Vardera"), and the screen has little height to spare.
 */
export default function MapPlaque({ eyebrow, mapDisplayName, actions, search, docked = false }: MapPlaqueProps) {
  return (
    <div
      className={`relative ${mapFrameClass} flex flex-wrap items-center gap-2 p-2 md:gap-0 ${
        docked ? "md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none" : "md:p-3"
      }`}
    >
      <div className="hidden min-w-0 flex-1 px-0.5 md:block">
        {eyebrow ? <p className="text-xs text-[var(--tfmc-mist)]">{eyebrow}</p> : null}
        <h1 className="truncate font-[family-name:var(--font-fraunces)] text-2xl leading-tight text-[var(--tfmc-cream)]">
          {mapDisplayName}
        </h1>
      </div>
      {actions ? <div className="order-2 flex shrink-0 items-center gap-1.5 md:order-none">{actions}</div> : null}
      {search ? <div className="order-1 min-w-0 flex-1 md:order-none md:mt-2.5 md:basis-full">{search}</div> : null}
    </div>
  );
}
