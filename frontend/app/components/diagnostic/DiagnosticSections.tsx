import type { Finding } from "@/lib/diagnostic/findings";
import type { RowStatus, Section } from "@/lib/diagnostic/rows";

const MARKS: Record<RowStatus, { mark: string; className: string; label: string }> = {
  pass: { mark: "✓", className: "text-[var(--tfmc-accent)]", label: "OK" },
  warn: { mark: "!", className: "text-[#e8c48a]", label: "Warning" },
  fail: { mark: "✗", className: "text-[#e8a0a0]", label: "Problem" },
  info: { mark: "·", className: "text-[var(--tfmc-mist)]", label: "Info" },
  pending: { mark: "…", className: "text-[var(--tfmc-mist)] animate-pulse", label: "Checking" },
};

const FINDING_STYLES: Record<Finding["level"], string> = {
  fail: "border-[#e8a0a0]/60 bg-[#e8a0a0]/10",
  warn: "border-[#e8c48a]/60 bg-[#e8c48a]/10",
  info: "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_45%,transparent)]",
};

export function FindingList({ items }: { items: Finding[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((f) => (
        <li key={f.title} className={`rounded-sm border px-4 py-3 ${FINDING_STYLES[f.level]}`}>
          <p className="font-semibold text-[var(--tfmc-cream)]">{f.title}</p>
          <p className="mt-0.5 text-sm text-[var(--tfmc-stone)]">{f.fix}</p>
        </li>
      ))}
    </ul>
  );
}

/** One table per section: mark, label, detail. */
export default function DiagnosticSections({
  sections,
  extra,
}: {
  sections: Section[];
  extra?: Record<string, React.ReactNode>;
}) {
  return (
    <div className="flex flex-col gap-8">
      {sections.map((section) =>
        section.rows.length || extra?.[section.title] ? (
          <section key={section.title} aria-label={section.title}>
            <h2 className="border-b border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] pb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-stone)]">
              {section.title}
            </h2>
            <dl className="divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] text-sm">
              {section.rows.map((row) => {
                const m = MARKS[row.status];
                return (
                  <div key={row.label} className="grid grid-cols-[1.25rem_7.5rem_1fr] gap-x-3 py-2 sm:grid-cols-[1.25rem_11rem_1fr]">
                    <span className={`text-center font-bold ${m.className}`} title={m.label} aria-label={m.label}>
                      {m.mark}
                    </span>
                    <dt className="text-[var(--tfmc-mist)]">{row.label}</dt>
                    <dd className="min-w-0 text-[var(--tfmc-cream)] [overflow-wrap:anywhere]">{row.detail}</dd>
                  </div>
                );
              })}
            </dl>
            {extra?.[section.title]}
          </section>
        ) : null,
      )}
    </div>
  );
}
