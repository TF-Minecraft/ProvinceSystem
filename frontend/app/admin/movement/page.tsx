import { Suspense } from "react";
import AdminColumn from "../../components/admin/AdminColumn";
import EveryoneMovement from "../../components/admin/EveryoneMovement";

export default function AdminMovementPage() {
  // The view lives in the URL's query, which needs a Suspense boundary.
  return (
    <Suspense
        fallback={
          <AdminColumn>
            <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
          </AdminColumn>
        }
      >
      <EveryoneMovement />
    </Suspense>
  );
}
