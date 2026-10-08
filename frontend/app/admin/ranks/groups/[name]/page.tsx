import Link from "next/link";
import AdminColumn from "../../../../components/admin/AdminColumn";
import RankGroup from "../../../../components/admin/ranks/RankGroup";

export default async function AdminRankGroupPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const group = decodeURIComponent(name);
  return (
    <AdminColumn>
      <Link href="/admin/ranks" className="mt-4 text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
        ← Ranks
      </Link>
      <RankGroup key={group} name={group} />
    </AdminColumn>
  );
}
