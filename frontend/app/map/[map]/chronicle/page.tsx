import { notFound } from "next/navigation";

import ChronicleStudio from "../../../components/chronicle/ChronicleStudio";
import { parseMapRouteSegment } from "../../../lib/map/chronicleDayRoute";

export default async function Page({ params }: { params: Promise<{ map: string }> }) {
  const mapId = parseMapRouteSegment((await params).map);
  if (!mapId) notFound();

  return <ChronicleStudio mapId={mapId} />;
}
