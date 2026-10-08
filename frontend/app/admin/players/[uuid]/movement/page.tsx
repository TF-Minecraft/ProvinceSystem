import Link from "next/link";
import { Suspense } from "react";
import AdminNav from "../../../../components/admin/AdminNav";
import PlayerMovementPage from "../../../../components/admin/PlayerMovementPage";
import PlayerTabs from "../../../../components/admin/PlayerTabs";

export default async function AdminPlayerMovementPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const id = decodeURIComponent(uuid);
  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-[110rem] flex-col px-4 py-10 sm:px-6">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Staff panel
      </h1>
      <AdminNav current="players" />
      <Link href="/admin/players" className="mt-4 text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
        ← All players
      </Link>
      {/* Only those who may see movement get this far; the page itself refuses everyone else. */}
      <PlayerTabs uuid={id} current="movement" movement />
      {/* The view lives in the URL's query, which needs a Suspense boundary. Keyed so a new player starts afresh. */}
      <Suspense fallback={<p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>}>
        <PlayerMovementPage key={id} uuid={id} />
      </Suspense>
    </main>
  );
}
