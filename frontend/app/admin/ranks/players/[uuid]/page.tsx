import Link from "next/link";
import AdminColumn from "../../../../components/admin/AdminColumn";
import RankPlayer from "../../../../components/admin/ranks/RankPlayer";

export default async function AdminRankPlayerPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const id = decodeURIComponent(uuid);
  return (
    <AdminColumn>
      <Link href="/admin/ranks" className="mt-4 text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
        ← Ranks
      </Link>
      {/* Keyed so moving between players starts afresh. */}
      <RankPlayer key={id} uuid={id} />
    </AdminColumn>
  );
}
