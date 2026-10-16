import DatabaseStudio from "../../../components/admin/database/DatabaseStudio";

type Params = Promise<{ id: string }>;

/** Full width under the staff tabs, like the map workspaces. */
export default async function AdminDatabaseStudioPage({ params }: { params: Params }) {
  const { id } = await params;
  return <DatabaseStudio id={id} />;
}
