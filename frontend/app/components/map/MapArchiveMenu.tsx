"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { AccessibleMapEntry } from "@/lib/map/api";
import { liveMapHref } from "@/app/lib/map/chronicleDayRoute";
import { archivedChapterMaps } from "@/app/lib/map/archiveMaps";

const panelClass =
  "rounded-lg border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-moss)_35%,var(--tfmc-forest-deep))] shadow-lg";

type MapArchiveMenuProps = {
  maps: AccessibleMapEntry[];
  linkClass: string;
};

export default function MapArchiveMenu({ maps, linkClass }: MapArchiveMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const chapters = archivedChapterMaps(maps);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={linkClass}
      >
        Earlier chapters
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Archived chapters"
          className={`${panelClass} absolute right-0 z-20 mt-1 min-w-48 p-1`}
        >
          {chapters.length === 0 ? (
            <p className="px-2 py-1.5 text-left text-xs text-[var(--tfmc-stone)]">
              No archived chapters yet.
            </p>
          ) : (
            chapters.map((chapter) => (
              <Link
                key={chapter.id}
                role="option"
                href={liveMapHref(chapter.id)}
                onClick={() => setOpen(false)}
                className="block rounded-md px-2 py-1.5 text-left text-sm text-[var(--tfmc-cream)] no-underline hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)]"
              >
                {chapter.display_name.trim() || chapter.id}
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
