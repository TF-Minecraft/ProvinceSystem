import AdminColumn from "../../components/admin/AdminColumn";
import DatabaseList from "../../components/admin/database/DatabaseList";

export default function AdminDatabasePage() {
  return (
    <AdminColumn>
      <DatabaseList />
    </AdminColumn>
  );
}
