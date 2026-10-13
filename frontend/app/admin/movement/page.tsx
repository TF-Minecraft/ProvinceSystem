import { Suspense } from "react";
import { MapWorkspaceSkeleton } from "../../components/admin/MapWorkspace";
import EveryoneMovement from "../../components/admin/EveryoneMovement";

export default function AdminMovementPage() {
  // The view lives in the URL's query, which needs a Suspense boundary.
  return (
    <Suspense fallback={<MapWorkspaceSkeleton />}>
      <EveryoneMovement />
    </Suspense>
  );
}
