import { notFound } from "next/navigation";

import SiteMap from "../../components/map/SiteMap";
import { parseMapRouteSegment } from "../../lib/map/chronicleDayRoute";

export default async function Page({
  params,
}: {
  params: Promise<{ map: string }>;
}) {
  const mapId = parseMapRouteSegment((await params).map);
  if (!mapId) notFound();

  return <SiteMap mapId={mapId} />;
}
