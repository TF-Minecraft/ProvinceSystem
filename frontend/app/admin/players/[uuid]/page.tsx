import { Suspense } from "react";
import AdminColumn from "../../../components/admin/AdminColumn";
import PlayerProfile from "../../../components/admin/PlayerProfile";

/** Under the player's frame (layout.tsx): the profile's tabs bar Movement. */
export default function AdminPlayerPage() {
  return (
    <AdminColumn>
      {/* The tab lives in the URL's query, which needs a Suspense boundary. */}
      <Suspense fallback={<p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>}>
        <PlayerProfile />
      </Suspense>
    </AdminColumn>
  );
}
