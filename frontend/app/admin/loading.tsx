import AdminColumn from "@/app/components/admin/AdminColumn";
import LoadingSkeleton from "@/app/components/shared/LoadingSkeleton";

export default function Loading() {
  return (
    <AdminColumn>
      <LoadingSkeleton variant="table" label="Loading staff panel…" className="mt-6" />
    </AdminColumn>
  );
}
