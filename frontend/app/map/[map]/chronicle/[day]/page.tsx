import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MapEngineProvider } from "../../../../core/MapEngineContext";
import ChronicleDayViewer from "../../../../components/chronicle/ChronicleDayViewer";
import { ChronicleDayProvider } from "../../../../lib/map/chronicleDayContext";
import { isValidChronicleDay, parseMapRouteSegment } from "../../../../lib/map/chronicleDayRoute";
import InvalidChronicleDay from "../../../../components/chronicle/InvalidChronicleDay";
import { MapSkeleton } from "@/app/components/shared/LoadingSkeleton";

export default async function Page({ params }: { params: Promise<{ map: string; day: string }> }) {
  const { map, day } = await params;
  const mapId = parseMapRouteSegment(map);
  if (!mapId) notFound();

  if (!isValidChronicleDay(day)) {
    return <InvalidChronicleDay mapId={mapId} />;
  }

  return (
    <MapEngineProvider>
      <ChronicleDayProvider day={day}>
        <Suspense fallback={<MapSkeleton label="Loading this day…" />}>
          {/*
            Keyed by day so a params-only navigation remounts instead of
            re-rendering. The banner date is derived during render while
            data resets happen in effects, which run after paint.
          */}
          <ChronicleDayViewer key={day} mapId={mapId} day={day} />
        </Suspense>
      </ChronicleDayProvider>
    </MapEngineProvider>
  );
}
