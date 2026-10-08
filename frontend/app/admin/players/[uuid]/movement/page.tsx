import Link from "next/link";
import { Suspense } from "react";
import AdminColumn from "../../../../components/admin/AdminColumn";
import PlayerMovementPage from "../../../../components/admin/PlayerMovementPage";
import PlayerTabs from "../../../../components/admin/PlayerTabs";

export default async function AdminPlayerMovementPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const id = decodeURIComponent(uuid);
  return (
    <>
      <AdminColumn>
        <Link href="/admin/players" className="mt-4 text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
          ← All players
        </Link>
        {/* Only those who may see movement get this far; the page itself refuses everyone else. */}
        <PlayerTabs uuid={id} current="movement" movement />
      </AdminColumn>
      {/* The view lives in the URL's query, which needs a Suspense boundary. Keyed so a new player starts afresh.
          Outside the column: the map's workspace takes the frame's full width. */}
      <Suspense
        fallback={
          <AdminColumn>
            <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
          </AdminColumn>
        }
      >
        <PlayerMovementPage key={id} uuid={id} />
      </Suspense>
    </>
  );
}
