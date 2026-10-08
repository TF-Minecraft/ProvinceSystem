import AdminColumn from "../../components/admin/AdminColumn";
import RanksOverview from "../../components/admin/ranks/RanksOverview";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminRanksPage({ searchParams }: { searchParams: SearchParams }) {
  const { q } = await searchParams;
  return (
    <AdminColumn>
      <RanksOverview initialQuery={(Array.isArray(q) ? q[0] : q) ?? ""} />
    </AdminColumn>
  );
}
