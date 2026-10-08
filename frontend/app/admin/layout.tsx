import AdminNav from "../components/admin/AdminNav";

/**
 * One frame for every staff page. The title and tabs share one row, centred at
 * the width of AdminColumn, so they stay put from tab to tab.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="staff-panel relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] w-full max-w-[110rem] flex-col px-4 pb-10 sm:px-6">
      {/* Opaque and pinned under the site header on wider screens, so the tabs stay in reach down a long list. */}
      <header className="z-30 -mx-4 bg-[var(--tfmc-forest-deep)] px-4 pt-6 sm:-mx-6 sm:px-6 md:sticky md:top-[var(--tfmc-header-h)]">
        <div className="mx-auto flex max-w-[72rem] flex-wrap items-end gap-x-8 gap-y-1 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)]">
          <h1 className="pb-2 font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)] sm:text-3xl">
            Staff panel
          </h1>
          <AdminNav />
        </div>
      </header>
      {children}
    </main>
  );
}
