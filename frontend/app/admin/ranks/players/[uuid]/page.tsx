import Link from "next/link";
import AdminNav from "../../../../components/admin/AdminNav";
import RankPlayer from "../../../../components/admin/ranks/RankPlayer";

export default async function AdminRankPlayerPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const id = decodeURIComponent(uuid);
  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-4xl flex-col px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Staff panel
      </h1>
      <AdminNav current="ranks" />
      <Link href="/admin/ranks" className="mt-4 text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
        ← Ranks
      </Link>
      {/* Keyed so moving between players starts afresh. */}
      <RankPlayer key={id} uuid={id} />
    </main>
  );
}
