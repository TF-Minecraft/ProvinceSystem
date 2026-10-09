import { Hammersmith_One } from "next/font/google";
import { Suspense } from "react";

import AdminColumn from "../../components/admin/AdminColumn";
import RailOverview from "../../components/admin/RailOverview";

// The tube map's lettering: an open font after the Underground's own.
const underground = Hammersmith_One({ weight: "400", subsets: ["latin"], variable: "--font-underground", display: "swap" });

export default function AdminRailPage() {
  // The map style lives in the URL's query, which needs a Suspense boundary.
  return (
    <div className={`${underground.variable} contents`}>
      <Suspense
        fallback={
          <AdminColumn>
            <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
          </AdminColumn>
        }
      >
        <RailOverview />
      </Suspense>
    </div>
  );
}
