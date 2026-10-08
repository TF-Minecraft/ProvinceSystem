import Link from "next/link";
import { Suspense } from "react";
import AdminNav from "../../../components/admin/AdminNav";
import PlayerProfile from "../../../components/admin/PlayerProfile";

export default async function AdminPlayerPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const id = decodeURIComponent(uuid);
  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-4xl flex-col px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Staff panel
      </h1>
      <AdminNav current="players" />
      <Link href="/admin/players" className="mt-4 text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
        ← All players
      </Link>
      {/* The tab lives in the URL's query, which needs a Suspense boundary.
          Keyed so moving between players starts afresh, with no earlier player's responses landing. */}
      <Suspense fallback={<p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>}>
        <PlayerProfile key={id} uuid={id} />
      </Suspense>
    </main>
  );
}
