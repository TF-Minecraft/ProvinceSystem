import AdminNav from "../../components/admin/AdminNav";
import RanksOverview from "../../components/admin/ranks/RanksOverview";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminRanksPage({ searchParams }: { searchParams: SearchParams }) {
  const { q } = await searchParams;
  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-5xl flex-col px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Staff panel
      </h1>
      <AdminNav current="ranks" />
      <RanksOverview initialQuery={(Array.isArray(q) ? q[0] : q) ?? ""} />
    </main>
  );
}
