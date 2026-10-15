import AdminColumn from "../../components/admin/AdminColumn";
import CommandsOverview from "../../components/admin/commands/CommandsOverview";
import { parseCommandsState } from "@/lib/admin/commands";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminCommandsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  return (
    <AdminColumn>
      <CommandsOverview initialState={parseCommandsState(params)} />
    </AdminColumn>
  );
}
