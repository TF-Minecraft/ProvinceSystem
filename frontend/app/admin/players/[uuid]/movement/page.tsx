import Link from "next/link";
import { Suspense } from "react";
import PlayerMovementPage from "../../../../components/admin/PlayerMovementPage";
import PlayerTabs from "../../../../components/admin/PlayerTabs";

export default async function AdminPlayerMovementPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const id = decodeURIComponent(uuid);
  return (
    <>
      <Link href="/admin/players" className="mt-4 text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
        ← All players
      </Link>
      {/* Only those who may see movement get this far; the page itself refuses everyone else. */}
      <PlayerTabs uuid={id} current="movement" movement />
      {/* The view lives in the URL's query, which needs a Suspense boundary. Keyed so a new player starts afresh. */}
      <Suspense fallback={<p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>}>
        <PlayerMovementPage key={id} uuid={id} />
      </Suspense>
    </>
  );
}
