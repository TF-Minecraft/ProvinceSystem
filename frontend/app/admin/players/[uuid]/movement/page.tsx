import { Suspense } from "react";
import AdminColumn from "../../../../components/admin/AdminColumn";
import PlayerMovementPage from "../../../../components/admin/PlayerMovementPage";

/** Under the player's frame (layout.tsx). Only those who may see movement get this far; the page refuses everyone else. */
export default async function AdminPlayerMovementPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const id = decodeURIComponent(uuid);
  return (
    // The view lives in the URL's query, which needs a Suspense boundary.
    // Outside the column: the map's workspace takes the frame's full width.
    <Suspense
      fallback={
        <AdminColumn>
          <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
        </AdminColumn>
      }
    >
      <PlayerMovementPage uuid={id} />
    </Suspense>
  );
}
