"use client";

import Link from "next/link";

import type { AccessibleMapEntry } from "@/lib/map/api";
import { liveMapHref } from "@/app/lib/map/chronicleDayRoute";
import { archivedChapterMaps } from "@/app/lib/map/archiveMaps";
import { ChevronIcon } from "./shell/MapIcons";

type MapArchiveMenuProps = {
  maps: AccessibleMapEntry[];
  linkClass: string;
};

export default function MapArchiveMenu({ maps, linkClass }: MapArchiveMenuProps) {
  const chapters = archivedChapterMaps(maps);

  return (
    <nav aria-label="Earlier chapters" className="space-y-2 text-left">
      <h3 className="text-xs font-semibold text-[var(--tfmc-mist)]">Earlier chapters</h3>
      {chapters.length === 0 ? (
        <p className="text-xs text-[var(--tfmc-stone)]">No archived chapters yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {chapters.map((chapter) => (
            <li key={chapter.id}>
              <Link
                href={liveMapHref(chapter.id)}
                className={`${linkClass} flex w-full justify-between gap-3 text-left`}
              >
                {chapter.display_name.trim() || chapter.id}
                <ChevronIcon size={14} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
