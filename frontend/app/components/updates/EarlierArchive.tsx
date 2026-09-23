"use client";

import { useState } from "react";

import { loadPublishedNotes } from "@/lib/patchnotes/api";
import type { WeekNotes } from "@/lib/patchnotes/notes";

import { WeekArchiveList } from "./WeekArchiveList";

const detailsClass =
  "rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_35%,transparent)]";

const PAGE_SIZE = 12;

export default function EarlierArchive({ before }: { before: string }) {
  const [open, setOpen] = useState(false);
  const [weeks, setWeeks] = useState<WeekNotes[]>([]);
  const [cursor, setCursor] = useState(before);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function load(from: string) {
    setLoading(true);
    setError(false);
    const notes = await loadPublishedNotes({ limit: PAGE_SIZE, before: from });
    setLoading(false);
    if (!notes.ok) {
      setError(true);
      return;
    }
    setWeeks((current) => [...current, ...notes.weeks]);
    setHasMore(notes.hasMore);
    const oldest = notes.weeks.at(-1);
    if (oldest) setCursor(oldest.week);
  }

  return (
    <details
      className={`${detailsClass} mt-12`}
      onToggle={(event) => {
        const isOpen = event.currentTarget.open;
        setOpen(isOpen);
        if (isOpen && weeks.length === 0 && !loading) {
          void load(cursor);
        }
      }}
    >
      <summary className="cursor-pointer px-4 py-3 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
        Earlier
      </summary>
      {open ? (
        <div className="border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] px-4 pb-4">
          {weeks.length > 0 ? <WeekArchiveList weeks={weeks} /> : null}
          {loading ? <p className="mt-4 text-sm text-[var(--tfmc-stone)]">Loading…</p> : null}
          {error ? (
            <p className="mt-4 text-sm text-[var(--tfmc-stone)]">Earlier weeks are unavailable right now.</p>
          ) : null}
          {hasMore && !loading && weeks.length > 0 ? (
            <button
              type="button"
              className="mt-4 text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
              onClick={() => void load(cursor)}
            >
              Show older
            </button>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
