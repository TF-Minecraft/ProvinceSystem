import { Suspense } from "react";
import EveryoneMovement from "../../components/admin/EveryoneMovement";

export default function AdminMovementPage() {
  // The view lives in the URL's query, which needs a Suspense boundary.
  return (
    <Suspense fallback={<p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>}>
      <EveryoneMovement />
    </Suspense>
  );
}
