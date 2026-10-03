import type { ReactNode } from "react";

type MapPlaqueProps = {
  /** Small caps over the name, e.g. "World map". */
  eyebrow: string;
  mapDisplayName: string;
  /** Icon buttons beside the name: history, archive, edit titles. */
  actions?: ReactNode;
  search?: ReactNode;
};

/** The map's name plate with the search box under it, top left. */
export default function MapPlaque({
  eyebrow,
  mapDisplayName,
  actions,
  search,
}: MapPlaqueProps) {
  return (
    <div className="map-frame p-2.5 md:p-3">
      <div className="flex items-center justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <p className="text-xs text-[var(--tfmc-mist)]">
            {eyebrow}
          </p>
          <h1 className="truncate font-[family-name:var(--font-fraunces)] text-lg leading-tight text-[var(--tfmc-cream)] md:text-2xl">
            {mapDisplayName}
          </h1>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
      {search ? <div className="mt-2 md:mt-2.5">{search}</div> : null}
    </div>
  );
}
