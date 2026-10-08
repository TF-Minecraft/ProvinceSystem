import AdminColumn from "../../components/admin/AdminColumn";
import PlayersDirectory from "../../components/admin/PlayersDirectory";
import { parsePlayerListing } from "../../../lib/admin/api";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminPlayersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <AdminColumn>
      <PlayersDirectory
        initialQuery={first(params.q) ?? ""}
        initialListing={parsePlayerListing(first(params.view), first(params.sort), first(params.order))}
        initialPage={Number.parseInt(first(params.page) ?? "1", 10) || 1}
      />
    </AdminColumn>
  );
}
