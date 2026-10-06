import AdminNav from "../../components/admin/AdminNav";
import PlayersDirectory from "../../components/admin/PlayersDirectory";
import { parsePlayerSort } from "../../../lib/admin/api";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminPlayersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-5xl flex-col px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Staff panel
      </h1>
      <AdminNav current="players" />
      <PlayersDirectory
        initialQuery={first(params.q) ?? ""}
        initialSort={parsePlayerSort(first(params.sort))}
        initialPage={Number.parseInt(first(params.page) ?? "1", 10) || 1}
      />
    </main>
  );
}
