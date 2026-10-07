import Link from "next/link";
import AdminNav from "../../../../components/admin/AdminNav";
import RankGroup from "../../../../components/admin/ranks/RankGroup";

export default async function AdminRankGroupPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const group = decodeURIComponent(name);
  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-4xl flex-col px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Staff panel
      </h1>
      <AdminNav current="ranks" />
      <Link href="/admin/ranks" className="mt-4 text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
        ← Ranks
      </Link>
      <RankGroup key={group} name={group} />
    </main>
  );
}
