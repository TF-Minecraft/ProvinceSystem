import { arrangeNote, SECTION_LABELS, type PublicBullet } from "@/lib/patchnotes/notes";

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

export function TechnicalSection({ bullets }: { bullets: readonly PublicBullet[] }) {
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

export function WeekSections({ bullets }: { bullets: readonly PublicBullet[] }) {
  const note = arrangeNote(bullets);
  return (
    <>
      <VisibleSection title="Highlights" bullets={note.highlights} />
      {note.topics.map((topic) => (
        <VisibleSection key={topic.id} title={topic.label} bullets={topic.bullets} />
      ))}
      <VisibleSection title="Bug fixes" bullets={note.fixes} />
      <TechnicalSection bullets={note.technical} />
    </>
  );
}
