import { notFound } from "next/navigation";

import ChronicleStaffConsole from "../../../../components/chronicle/ChronicleStaffConsole";
import { parseMapRouteSegment } from "../../../../lib/map/chronicleDayRoute";

export default async function Page({ params }: { params: Promise<{ map: string }> }) {
  const mapId = parseMapRouteSegment((await params).map);
  if (!mapId) notFound();

  return <ChronicleStaffConsole mapId={mapId} />;
}
