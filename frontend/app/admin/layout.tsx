import AdminNav from "../components/admin/AdminNav";

/**
 * One frame for every staff page: the same width and padding throughout, so the
 * title and tabs stay put from tab to tab. The map pages fill it; the rest keep
 * to a reading column (AdminColumn) on its left edge.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="staff-panel relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-[110rem] flex-col px-4 py-10 sm:px-6">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Staff panel
      </h1>
      <AdminNav />
      {children}
    </main>
  );
}
