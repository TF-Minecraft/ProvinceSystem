import EarlierArchive from "@/app/components/updates/EarlierArchive";
import StaffTestPreview from "@/app/components/updates/StaffTestPreview";
import { WeekArchiveList, WeekSections } from "@/app/components/updates/WeekArchiveList";
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
  const [current, ...earlier] = weeks;

  return (
    <main className="mx-auto min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-3xl px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-4xl text-[var(--tfmc-cream)]">Updates</h1>
      <p className="mt-2 text-[var(--tfmc-mist)]">What changed on TFMC. Technical notes stay folded.</p>
      <StaffTestPreview />

      {unavailable ? (
        <p className="mt-10 text-[var(--tfmc-stone)]">Patch notes are unavailable right now.</p>
      ) : current ? (
        <div className="mt-10">
          <article>
            <h2 className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">{current.label}</h2>
            <WeekSections bullets={current.bullets} />
          </article>
          {earlier.length > 0 ? (
            <section className="mt-12">
              <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">Earlier</h2>
              <WeekArchiveList weeks={earlier} />
            </section>
          ) : hasMore ? (
            <EarlierArchive key={current.week} before={current.week} />
          ) : null}
        </div>
      ) : (
        <p className="mt-10 text-[var(--tfmc-stone)]">Nothing has been published yet.</p>
      )}
    </main>
  );
}
