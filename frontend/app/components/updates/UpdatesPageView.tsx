import Link from "next/link";

import StaffTestPreview from "@/app/components/updates/StaffTestPreview";
import { WeekSections } from "@/app/components/updates/WeekArchiveList";
import type { WeekNotes } from "@/lib/patchnotes/notes";

const weekButtonClass =
  "inline-flex w-full items-center justify-start rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-transparent px-6 py-4 text-left text-sm font-semibold tracking-wide text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]";

export default function UpdatesPageView({
  weeks,
  unavailable = false,
}: {
  weeks: readonly { week: string; label: string }[];
  unavailable?: boolean;
}) {
  return (
    <main className="mx-auto min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-3xl px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-4xl text-[var(--tfmc-cream)]">Updates</h1>
      <p className="mt-2 text-[var(--tfmc-mist)]">Each week that has notes has its own page.</p>
      <StaffTestPreview />

      {unavailable ? (
        <p className="mt-10 text-[var(--tfmc-stone)]">Patch notes are unavailable right now.</p>
      ) : weeks.length > 0 ? (
        <nav className="mt-10 flex flex-col gap-3" aria-label="Patch notes by week">
          {weeks.map((notes) => (
            <Link key={notes.week} href={`/updates/${notes.week}`} className={weekButtonClass}>
              {notes.label}
            </Link>
          ))}
        </nav>
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
      <Link href="/updates" className={weekButtonClass}>
        All updates
      </Link>
      {unavailable ? (
        <p className="mt-10 text-[var(--tfmc-stone)]">Patch notes are unavailable right now.</p>
      ) : notes ? (
        <>
          <h1 className="mt-8 font-[family-name:var(--font-fraunces)] text-4xl text-[var(--tfmc-cream)]">{notes.label}</h1>
          <WeekSections bullets={notes.bullets} />
        </>
      ) : null}
    </main>
  );
}
