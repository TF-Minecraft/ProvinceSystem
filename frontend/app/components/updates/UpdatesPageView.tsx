import Link from "next/link";

import EarlierArchive from "@/app/components/updates/EarlierArchive";
import StaffTestPreview from "@/app/components/updates/StaffTestPreview";
import { WeekArticle, WeekSections } from "@/app/components/updates/WeekArchiveList";
import type { WeekNotes } from "@/lib/patchnotes/notes";

export default function UpdatesPageView({
  weeks,
  unavailable = false,
  hasMore = false,
}: {
  weeks: readonly WeekNotes[];
  unavailable?: boolean;
  hasMore?: boolean;
}) {
  const oldest = weeks.at(-1)?.week;

  return (
    <main className="mx-auto min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-3xl px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-4xl text-[var(--tfmc-cream)]">Updates</h1>
      <p className="mt-2 text-[var(--tfmc-mist)]">
        Scroll through the weeks. Each week also has its own page. Technical notes stay folded.
      </p>
      <StaffTestPreview />

      {unavailable ? (
        <p className="mt-10 text-[var(--tfmc-stone)]">Patch notes are unavailable right now.</p>
      ) : weeks.length > 0 ? (
        <div className="mt-10 [&>article:first-child]:mt-0 [&>article:first-child]:border-t-0 [&>article:first-child]:pt-0">
          {weeks.map((notes) => (
            <WeekArticle key={notes.week} notes={notes} />
          ))}
          {hasMore && oldest ? <EarlierArchive key={oldest} before={oldest} /> : null}
        </div>
      ) : (
        <p className="mt-10 text-[var(--tfmc-stone)]">Nothing has been published yet.</p>
      )}
    </main>
  );
}

export function WeekPageView({
  notes,
  unavailable = false,
}: {
  notes: WeekNotes | null;
  unavailable?: boolean;
}) {
  return (
    <main className="mx-auto min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-3xl px-6 py-16">
      <Link href="/updates" className="text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline">
        All updates
      </Link>
      {unavailable ? (
        <p className="mt-10 text-[var(--tfmc-stone)]">Patch notes are unavailable right now.</p>
      ) : notes ? (
        <>
          <h1 className="mt-6 font-[family-name:var(--font-fraunces)] text-4xl text-[var(--tfmc-cream)]">{notes.label}</h1>
          <WeekSections bullets={notes.bullets} />
        </>
      ) : null}
    </main>
  );
}
