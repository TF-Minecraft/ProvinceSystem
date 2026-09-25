"use client";

import { useState } from "react";

import { loadPublishedNotes } from "@/lib/patchnotes/api";
import type { WeekNotes } from "@/lib/patchnotes/notes";

import { WeekArticle } from "./WeekArchiveList";

const PAGE_SIZE = 8;

export default function EarlierArchive({ before }: { before: string }) {
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
    <div className="mt-12">
      {weeks.map((notes) => (
        <WeekArticle key={notes.week} notes={notes} />
      ))}
      {loading ? <p className="mt-8 text-sm text-[var(--tfmc-stone)]">Loading…</p> : null}
      {error ? <p className="mt-8 text-sm text-[var(--tfmc-stone)]">Older weeks are unavailable right now.</p> : null}
      {hasMore && !loading ? (
        <button
          type="button"
          className="mt-8 text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
          onClick={() => void load(cursor)}
        >
          Show older
        </button>
      ) : null}
    </div>
  );
}
