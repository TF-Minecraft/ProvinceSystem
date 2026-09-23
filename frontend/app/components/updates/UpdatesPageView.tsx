import {
  groupBullets,
  SECTION_LABELS,
  type PublicBullet,
  type SectionName,
  type WeekNotes,
} from "@/lib/patchnotes/notes";

const detailsClass =
  "rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_35%,transparent)]";

function BulletList({ bullets }: { bullets: readonly PublicBullet[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--tfmc-stone)]">
      {bullets.map((bullet) => (
        <li key={bullet.id}>{bullet.body}</li>
      ))}
    </ul>
  );
}

function VisibleSection({ title, bullets }: { title: string; bullets: readonly PublicBullet[] }) {
  if (bullets.length === 0) return null;
  return (
    <section className="mt-6">
      <h3 className="font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]">{title}</h3>
      <BulletList bullets={bullets} />
    </section>
  );
}

function TechnicalSection({ bullets }: { bullets: readonly PublicBullet[] }) {
  if (bullets.length === 0) return null;
  return (
    <details className={`${detailsClass} mt-6`}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--tfmc-cream)]">
        {SECTION_LABELS.technical} ({bullets.length})
      </summary>
      <div className="border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] px-4 py-3">
        <BulletList bullets={bullets} />
      </div>
    </details>
  );
}

function WeekSections({ bullets }: { bullets: readonly PublicBullet[] }) {
  const groups = groupBullets(bullets);
  const visible: SectionName[] = ["new", "fixed", "adjusted"];
  return (
    <>
      {visible.map((section) => (
        <VisibleSection key={section} title={SECTION_LABELS[section]} bullets={groups[section]} />
      ))}
      <TechnicalSection bullets={groups.technical} />
    </>
  );
}

function WeekArticle({ notes }: { notes: WeekNotes }) {
  return (
    <article>
      <h2 className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">{notes.label}</h2>
      <WeekSections bullets={notes.bullets} />
    </article>
  );
}

export default function UpdatesPageView({
  weeks,
  unavailable = false,
}: {
  weeks: readonly WeekNotes[];
  unavailable?: boolean;
}) {
  const [current, ...earlier] = weeks;

  return (
    <main className="mx-auto min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-3xl px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-4xl text-[var(--tfmc-cream)]">Updates</h1>
      <p className="mt-2 text-[var(--tfmc-mist)]">What changed on TFMC. Technical notes stay folded.</p>

      {unavailable ? (
        <p className="mt-10 text-[var(--tfmc-stone)]">Patch notes are unavailable right now.</p>
      ) : current ? (
        <div className="mt-10">
          <WeekArticle notes={current} />
          {earlier.length > 0 ? (
            <section className="mt-12">
              <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">Earlier</h2>
              <div className="mt-4 space-y-3">
                {earlier.map((notes) => (
                  <details key={notes.week} className={detailsClass}>
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--tfmc-cream)]">
                      {notes.label}
                    </summary>
                    <div className="border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] px-4 pb-4">
                      <WeekSections bullets={notes.bullets} />
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <p className="mt-10 text-[var(--tfmc-stone)]">Nothing has been published yet.</p>
      )}
    </main>
  );
}
