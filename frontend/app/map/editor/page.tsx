import { Suspense } from "react";

import MapEditorPage from "./MapEditorPageClient";
import { MapSkeleton } from "@/app/components/shared/LoadingSkeleton";

export default function Page() {
  return (
    <div className="overflow-x-hidden">
      <Suspense fallback={<MapSkeleton label="Loading map editor…" />}>
        <MapEditorPage />
      </Suspense>
    </div>
  );
}
