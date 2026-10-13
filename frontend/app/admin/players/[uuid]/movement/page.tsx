import { Suspense } from "react";
import { MapWorkspaceSkeleton } from "../../../../components/admin/MapWorkspace";
import PlayerMovementPage from "../../../../components/admin/PlayerMovementPage";

/** Under the player's frame (layout.tsx). Only those who may see movement get this far; the page refuses everyone else. */
export default async function AdminPlayerMovementPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const id = decodeURIComponent(uuid);
  return (
    // The view lives in the URL's query, which needs a Suspense boundary.
    // Outside the column: the map's workspace takes the frame's full width.
    <Suspense fallback={<MapWorkspaceSkeleton above="8.5rem" />}>
      <PlayerMovementPage uuid={id} />
    </Suspense>
  );
}
