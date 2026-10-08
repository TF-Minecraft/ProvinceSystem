import { WikiItemText, WikiPage } from "@/app/components/wiki";
import { stations } from "@/app/wiki/data";
import StationGallery from "./StationGallery";

export default function StationsPage() {
  const blurbs = Object.fromEntries(stations.map((station) => [
    station.slug,
    <WikiItemText key={station.slug} text={station.blurb} excludeHref={`/wiki/stations/${station.slug}`} />,
  ]));

  return (
    <WikiPage
      lastModified="2026-09-27"
      title="Crafting Stations"
      intro="Every crafting station and the block that opens it."
      width="lg"
    >
      <h2 id="catalogue" className="sr-only">Station catalogue</h2>
      <StationGallery stations={stations} blurbs={blurbs} />
    </WikiPage>
  );
}
