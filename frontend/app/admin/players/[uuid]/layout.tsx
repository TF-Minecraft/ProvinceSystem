import { Suspense } from "react";
import AdminColumn from "../../../components/admin/AdminColumn";
import PlayerFrame from "../../../components/admin/PlayerFrame";

/** The player's name, details and tabs stay mounted between the profile and the movement page. */
export default async function AdminPlayerLayout({
  params,
  children,
}: {
  params: Promise<{ uuid: string }>;
  children: React.ReactNode;
}) {
  const { uuid } = await params;
  const id = decodeURIComponent(uuid);
  return (
    // The current tab lives partly in the URL's query, which needs a Suspense boundary.
    // Keyed so moving between players starts afresh, with no earlier player's responses landing.
    <Suspense
      fallback={
        <AdminColumn>
          <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
        </AdminColumn>
      }
    >
      <PlayerFrame key={id} uuid={id}>
        {children}
      </PlayerFrame>
    </Suspense>
  );
}
